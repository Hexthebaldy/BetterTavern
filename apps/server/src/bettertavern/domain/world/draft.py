"""世界状态 agent 的修改清单：在内存里的一份世界副本上逐项执行修改
（docs/agent-runtime.md 第 4 节）。

- 每个修改操作执行时就检查：名字在不在、编号对不对、类型对不对、会不会违反一致性规则。不合规就抛
  DraftError（带代码和参数，给模型看的说明由 runtime 按语言取），合规的立刻作用到副本上。
- 给模型看的是短编号：实体 e1、e2……，事实 f1、f2……，只在这一次运行里有效，新建的接着往后编。
  参数里也可以直接写名字或别名，只要能唯一对上一个实体。
- 收尾（finish）时更新涉及实体的 last_seen_seq，把在另一个回合再次出现的铅笔实体改成钢笔，
  对整个世界再检查一遍（只看这次新出现的问题），然后算出每一行改之前和改之后的样子（RowChange），
  由服务层在一个事务里写入，并记进 state_patches。
"""

from __future__ import annotations

import dataclasses
import re
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .invariants import Issue, new_issues
from .mentions import find_named
from .names import clean_display_name, normalize_name
from .plan import REL_HELD_BY, REL_LOCATED_IN, REL_MEMBER_OF
from .records import EntityRecord, FactRecord, LinkRecord, RowChange, Target, WorldRecords

KINDS = ("character", "item", "location", "organization")
# 每类实体能改的状态（entities.data 里的键）
DETAIL_KEYS: Mapping[str, tuple[str, ...]] = {
    "character": ("goal", "attitude", "speech_style", "condition"),
    "item": ("condition",),
    "location": ("condition",),
    "organization": ("stance", "condition"),
}
REL_PART_OF = "part_of"
REL_KNOWS_OF = "knows_of"
# link 能建的关系：关系名 → (起点的类型, 终点的类型)。位置和持有只能用 move 改
LINK_RULES: Mapping[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    REL_MEMBER_OF: (("character",), ("organization",)),
    REL_PART_OF: (("location",), ("location",)),
    REL_KNOWS_OF: (("character",), KINDS),
}
PLACE_RELS = (REL_LOCATED_IN, REL_HELD_BY)

MAX_NEW_ENTITIES = 3  # 每回合最多新建几个实体
MAX_ALIASES = 6
SUMMARY_CHARS = 400
DETAIL_CHARS = 160
FACT_CHARS = 200
DIGEST_CHARS = 120
CLOCK_CHARS = 60

_ENTITY_REF = re.compile(r"^e(\d+)$")
_FACT_REF = re.compile(r"^f(\d+)$")


class DraftError(Exception):
    """一个修改操作不合规。code 和 params 用来取给模型看的说明。"""

    def __init__(self, code: str, **params: Any) -> None:
        super().__init__(code)
        self.code = code
        self.params = params


class DraftIssues(DraftError):
    """收尾时整个世界检查出了新问题。"""

    def __init__(self, issues: Sequence[Issue]) -> None:
        super().__init__("world_issues")
        self.issues = tuple(issues)


@dataclass(frozen=True)
class DraftResult:
    changes: tuple[RowChange, ...]
    digest: str  # 这一回合的一句话摘要
    entity_ids: tuple[str, ...]  # 这一回合涉及的实体
    scene_ended: bool
    outline_reason: str = ""  # 大纲要改的原因；不用改时为空


def _clean(text: Any, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


class WorldDraft:
    def __init__(
        self,
        world: WorldRecords,
        *,
        seq: int,
        turn_id: str,
        new_id: Callable[[], str] = lambda: str(uuid.uuid4()),
    ) -> None:
        self._before = world
        self._seq = seq
        self._turn_id = turn_id
        self._new_id = new_id
        self._original_entities = {e.id: e for e in world.entities}
        self._original_links = {lk.key: lk for lk in world.links}
        self._original_facts = {f.id: f for f in world.facts}
        self._entities = dict(self._original_entities)
        self._links = dict(self._original_links)
        self._facts = dict(self._original_facts)
        # 第一次改到的顺序：算 RowChange 时按它排，结果是确定的
        self._order: dict[tuple[Target, Any], None] = {}
        self._created: list[str] = []
        self._entity_refs = [e.id for e in world.entities]
        self._fact_refs = [f.id for f in world.facts]
        self.result: DraftResult | None = None
        worlds = [e for e in world.entities if e.kind == "world"]
        heroes = [e for e in world.entities if e.is_protagonist and not e.retired]
        if len(worlds) != 1 or len(heroes) != 1:
            raise ValueError("a world needs exactly one world entity and one protagonist")
        self._world_id = worlds[0].id
        self._hero_id = heroes[0].id

    # ---- 读 ----------------------------------------------------------------------------
    @property
    def seq(self) -> int:
        return self._seq

    def ref(self, entity_id: str) -> str:
        return f"e{self._entity_refs.index(entity_id) + 1}"

    def fact_ref(self, fact_id: str) -> str:
        return f"f{self._fact_refs.index(fact_id) + 1}"

    def label(self, ref: str) -> str | None:
        """编号对应什么：实体给名字，事实给开头 40 个字；没有这个编号时返回 None。"""
        entity = _ENTITY_REF.match(ref)
        if entity:
            index = int(entity.group(1)) - 1
            if 0 <= index < len(self._entity_refs):
                return self._entities[self._entity_refs[index]].name
            return None
        fact = _FACT_REF.match(ref)
        if fact:
            index = int(fact.group(1)) - 1
            if 0 <= index < len(self._fact_refs):
                return self._facts[self._fact_refs[index]].text[:40]
        return None

    def entity(self, entity_id: str) -> EntityRecord:
        return self._entities[entity_id]

    @property
    def entities(self) -> list[EntityRecord]:
        return [self._entities[i] for i in self._entity_refs]

    @property
    def links(self) -> list[LinkRecord]:
        return list(self._links.values())

    @property
    def facts(self) -> list[FactRecord]:
        """有效的事实（被推翻的不算），按编号顺序。"""
        return [f for i in self._fact_refs if (f := self._facts[i]).status == "active"]

    @property
    def world(self) -> EntityRecord:
        return self._entities[self._world_id]

    @property
    def protagonist(self) -> EntityRecord:
        return self._entities[self._hero_id]

    def snapshot(self) -> WorldRecords:
        return WorldRecords(
            entities=tuple(self.entities),
            links=tuple(self._links.values()),
            facts=tuple(self._facts[i] for i in self._fact_refs),
        )

    def place_of(self, entity_id: str) -> tuple[str, EntityRecord] | None:
        """在哪里（located_in）或在谁手里（held_by）。"""
        for link in self._links.values():
            if link.src_id == entity_id and link.rel in PLACE_RELS:
                return link.rel, self._entities[link.dst_id]
        return None

    def sources(self, dst_id: str, rel: str) -> list[EntityRecord]:
        return [
            self._entities[lk.src_id]
            for lk in self._links.values()
            if lk.dst_id == dst_id and lk.rel == rel
        ]

    def find(self, name: str) -> list[EntityRecord]:
        """名字或别名里包含 name 的实体（包括已退场的），完全相同的排在前面。"""
        return find_named((e for e in self.entities if e.kind != "world"), name)

    def resolve(self, text: str, *, active: bool = True) -> EntityRecord:
        """把参数里的编号或名字换成实体。active 为真时不接受已退场的。"""
        text = str(text or "").strip()
        match = _ENTITY_REF.match(text)
        if match:
            index = int(match.group(1)) - 1
            if not 0 <= index < len(self._entity_refs):
                raise DraftError("unknown_entity", ref=text)
            entity = self._entities[self._entity_refs[index]]
        else:
            key = normalize_name(text)
            candidates = [
                e
                for e in self.entities
                if e.kind != "world"
                and key
                and (key == e.name_norm or key in (normalize_name(a) for a in e.aliases))
            ]
            living = [e for e in candidates if not e.retired]
            if len(living) == 1:
                candidates = living
            if not candidates:
                raise DraftError("unknown_entity", ref=text)
            if len(candidates) > 1:
                refs = ", ".join(f"{self.ref(e.id)} {e.name}" for e in candidates)
                raise DraftError("ambiguous_entity", ref=text, candidates=refs)
            entity = candidates[0]
        if entity.kind == "world":
            raise DraftError("unknown_entity", ref=text)
        if active and entity.retired:
            raise DraftError("retired_entity", name=entity.name)
        return entity

    def resolve_fact(self, text: str) -> FactRecord:
        match = _FACT_REF.match(str(text or "").strip())
        if not match:
            raise DraftError("unknown_fact", ref=text)
        index = int(match.group(1)) - 1
        if not 0 <= index < len(self._fact_refs):
            raise DraftError("unknown_fact", ref=text)
        fact = self._facts[self._fact_refs[index]]
        if fact.status != "active":
            raise DraftError("retracted_fact", ref=text)
        return fact

    # ---- 改 ----------------------------------------------------------------------------
    def create_entity(
        self,
        *,
        kind: str,
        name: str,
        summary: str = "",
        aliases: Iterable[str] = (),
        details: Mapping[str, Any] | None = None,
    ) -> EntityRecord:
        self._check_open()
        if kind not in KINDS:
            raise DraftError("bad_kind", kind=kind)
        display = clean_display_name(name)
        norm = normalize_name(display)
        if not norm:
            raise DraftError("empty_name")
        taken = next(
            (
                e
                for e in self._entities.values()
                if e.kind == kind and e.name_norm == norm and not e.retired
            ),
            None,
        )
        if taken is not None:
            raise DraftError("name_taken", name=display, ref=self.ref(taken.id))
        if len(self._created) >= MAX_NEW_ENTITIES:
            raise DraftError("too_many_new", limit=MAX_NEW_ENTITIES)
        record = EntityRecord(
            id=self._new_id(),
            kind=kind,
            name=display,
            name_norm=norm,
            aliases=self._merge_aliases(display, (), aliases),
            summary=_clean(summary, SUMMARY_CHARS),
            data=self._merge_details(kind, {}, details or {}),
            canon="sketch",
            first_seq=self._seq,
            last_seen_seq=self._seq,
        )
        self._created.append(record.id)
        self._entity_refs.append(record.id)
        self._put_entity(record)
        return record

    def update_entity(
        self,
        entity: str,
        *,
        summary: str | None = None,
        aliases: Iterable[str] = (),
        details: Mapping[str, Any] | None = None,
    ) -> EntityRecord:
        self._check_open()
        current = self.resolve(entity)
        changes: dict[str, Any] = {}
        if summary is not None and _clean(summary, SUMMARY_CHARS) != current.summary:
            # 钢笔实体的长期描述不能改；变化写进状态或事实
            if current.canon != "sketch":
                raise DraftError("canon_summary", name=current.name)
            changes["summary"] = _clean(summary, SUMMARY_CHARS)
        if aliases:
            changes["aliases"] = self._merge_aliases(current.name, current.aliases, aliases)
        if details:
            changes["data"] = self._merge_details(current.kind, current.data, details)
        record = dataclasses.replace(current, **changes)
        self._put_entity(record)
        return record

    def retire_entity(self, entity: str) -> EntityRecord:
        self._check_open()
        current = self.resolve(entity)
        if current.is_protagonist:
            raise DraftError("protected_entity", name=current.name)
        scene = self._scene()
        if scene.get("location") == current.id:
            raise DraftError("retire_scene_location", name=current.name)
        present = [p for p in scene.get("present") or () if p != current.id]
        if present != list(scene.get("present") or ()):
            self._put_scene({**scene, "present": present})
        record = dataclasses.replace(current, retired=True)
        self._put_entity(record)
        return record

    def move(self, entity: str, to: str) -> tuple[str, EntityRecord, EntityRecord]:
        """某人或某物到某地，或某物到某人手里。返回 (关系, 移动的实体, 目的地)。"""
        self._check_open()
        thing = self.resolve(entity)
        if thing.is_protagonist:
            raise DraftError("move_protagonist")
        if thing.kind not in ("character", "item"):
            raise DraftError("cannot_move", name=thing.name)
        target = self.resolve(to)
        if target.id == thing.id:
            raise DraftError("self_link", name=thing.name)
        if target.kind == "location":
            rel = REL_LOCATED_IN
        elif target.kind == "character" and thing.kind == "item":
            rel = REL_HELD_BY
        else:
            raise DraftError("bad_destination", name=thing.name, target=target.name)
        self._set_place(thing.id, rel, target.id)
        if thing.kind == "character":
            # 离开了场景所在的地方，就不再在场
            scene = self._scene()
            present = list(scene.get("present") or ())
            if thing.id in present and scene.get("location") != target.id:
                self._put_scene({**scene, "present": [p for p in present if p != thing.id]})
        return rel, thing, target

    def link(self, src: str, rel: str, dst: str) -> LinkRecord:
        self._check_open()
        if rel in PLACE_RELS:
            raise DraftError("use_move", rel=rel)
        rule = LINK_RULES.get(rel)
        if rule is None:
            raise DraftError("bad_relation", rel=rel, allowed=", ".join(LINK_RULES))
        a = self.resolve(src)
        b = self.resolve(dst)
        if a.id == b.id:
            raise DraftError("self_link", name=a.name)
        if a.kind not in rule[0] or b.kind not in rule[1]:
            raise DraftError("bad_link_kinds", rel=rel, src=a.name, dst=b.name)
        record = LinkRecord(a.id, rel, b.id, since_seq=self._seq)
        if record.key not in self._links:
            self._put_link(record.key, record)
        return self._links[record.key]

    def unlink(self, src: str, rel: str, dst: str) -> LinkRecord:
        self._check_open()
        a = self.resolve(src, active=False)
        b = self.resolve(dst, active=False)
        key = (a.id, rel, b.id)
        record = self._links.get(key)
        if record is None:
            raise DraftError("unknown_link", src=a.name, rel=rel, dst=b.name)
        self._put_link(key, None)
        return record

    def add_fact(
        self,
        text: str,
        *,
        about: Iterable[str] = (),
        secret: bool = False,
        known_by: Iterable[str] = (),
    ) -> FactRecord:
        self._check_open()
        body = _clean(text, FACT_CHARS)
        if not body:
            raise DraftError("empty_fact")
        entity_ids = tuple(dict.fromkeys(self.resolve(a, active=False).id for a in about))
        knowers: tuple[str, ...] = ()
        if secret:
            people = [self.resolve(k, active=False) for k in known_by]
            for person in people:
                if person.kind != "character":
                    raise DraftError("not_character", name=person.name)
            knowers = tuple(dict.fromkeys(p.id for p in people))
        record = FactRecord(
            id=self._new_id(),
            text=body,
            entity_ids=entity_ids,
            visibility="secret" if secret else "public",
            known_by=knowers,
            created_seq=self._seq,
            source_turn_id=self._turn_id,
        )
        self._fact_refs.append(record.id)
        self._put_fact(record)
        return record

    def retract_fact(self, fact: str, *, replaced_by: str | None = None) -> FactRecord:
        """推翻一条事实：不删，标为 superseded，记下从第几回合起不再成立。"""
        self._check_open()
        current = self.resolve_fact(fact)
        newer = self.resolve_fact(replaced_by) if replaced_by else None
        if newer is not None and newer.id == current.id:
            raise DraftError("self_replace", ref=fact)
        record = dataclasses.replace(
            current,
            status="superseded",
            superseded_seq=self._seq,
            superseded_by=newer.id if newer is not None else None,
        )
        self._put_fact(record)
        return record

    def share_fact(self, fact: str, people: Iterable[str]) -> FactRecord:
        """让更多人物知道一条秘密；主角知道以后，这条事实对玩家可见。"""
        self._check_open()
        current = self.resolve_fact(fact)
        if current.visibility != "secret":
            raise DraftError("fact_public", ref=fact)
        added: list[str] = []
        for text in people:
            person = self.resolve(text, active=False)
            if person.kind != "character":
                raise DraftError("not_character", name=person.name)
            added.append(person.id)
        record = dataclasses.replace(
            current, known_by=tuple(dict.fromkeys([*current.known_by, *added]))
        )
        self._put_fact(record)
        return record

    def set_scene(
        self,
        *,
        location: str | None = None,
        present: Sequence[str] | None = None,
        goal: str | None = None,
    ) -> Mapping[str, Any]:
        """当前场景：地点、在场人物、主角当前的目标。

        换地点时主角跟着过去；present 不给时，在场的是已经在新地点的人物。给了 present 时以它为准：
        名单里的人物移到场景地点，原来在这个地点、但不在名单里的人物不再算在这里。
        """
        self._check_open()
        scene = self._scene()
        hero = self.protagonist
        location_id = scene.get("location")
        if location is not None:
            place = self.resolve(location)
            if place.kind != "location":
                raise DraftError("not_location", name=place.name)
            location_id = place.id
            self._set_place(hero.id, REL_LOCATED_IN, place.id)
        people: list[str] | None = None
        if present is not None:
            people = []
            for text in present:
                person = self.resolve(text)
                if person.kind != "character":
                    raise DraftError("not_character", name=person.name)
                if not person.is_protagonist and person.id not in people:
                    people.append(person.id)
        elif location is not None:
            people = [
                e.id
                for e in self.sources(str(location_id), REL_LOCATED_IN)
                if e.kind == "character" and not e.is_protagonist and not e.retired
            ]
        new_scene = dict(scene)
        if location is not None:
            new_scene["location"] = location_id
        if people is not None:
            new_scene["present"] = people
            if location_id:
                for person_id in people:
                    self._set_place(person_id, REL_LOCATED_IN, str(location_id))
                if present is not None:
                    for other in self.sources(str(location_id), REL_LOCATED_IN):
                        if (
                            other.kind == "character"
                            and not other.is_protagonist
                            and other.id not in people
                        ):
                            self._put_link((other.id, REL_LOCATED_IN, str(location_id)), None)
        if goal is not None:
            new_scene["goal"] = _clean(goal, DETAIL_CHARS)
        self._put_scene(new_scene)
        return new_scene

    def set_clock(self, time: str) -> str:
        self._check_open()
        value = _clean(time, CLOCK_CHARS)
        if not value:
            raise DraftError("empty_clock")
        world = self.world
        self._put_entity(dataclasses.replace(world, data={**world.data, "clock": value}))
        return value

    # ---- 收尾 --------------------------------------------------------------------------
    def finish(
        self,
        *,
        digest: str,
        entities: Iterable[str],
        scene_ended: bool,
        extra: Sequence[RowChange] = (),
        outline_reason: str = "",
    ) -> DraftResult:
        """extra：同一回合别的修改清单算出的改动（线索，threads.py），排在最后一起写入；
        outline_reason：大纲要改的原因（docs/agent-runtime.md 第 4 节），不用改时为空。"""
        self._check_open()
        summary = _clean(digest, DIGEST_CHARS)
        if not summary:
            raise DraftError("empty_digest")
        involved = list(dict.fromkeys(self.resolve(e, active=False).id for e in entities))
        issues = new_issues(self._before, self.snapshot())
        if issues:
            raise DraftIssues(issues)
        for entity_id in self._seen(involved):
            current = self._entities[entity_id]
            promoted = current.canon == "sketch" and current.first_seq < self._seq
            record = dataclasses.replace(
                current,
                last_seen_seq=max(current.last_seen_seq, self._seq),
                canon="canon" if promoted else current.canon,
            )
            if record != current:
                self._put_entity(record)
        self.result = DraftResult(
            changes=(*self._changes(), *extra),
            digest=summary,
            entity_ids=tuple(involved),
            scene_ended=bool(scene_ended),
            outline_reason=_clean(outline_reason, DIGEST_CHARS),
        )
        return self.result

    # ---- 内部 --------------------------------------------------------------------------
    def _check_open(self) -> None:
        if self.result is not None:
            raise DraftError("already_committed")

    def _scene(self) -> dict[str, Any]:
        return dict(self.world.data.get("scene") or {})

    def _put_scene(self, scene: Mapping[str, Any]) -> None:
        world = self.world
        self._put_entity(dataclasses.replace(world, data={**world.data, "scene": dict(scene)}))

    def _put_entity(self, record: EntityRecord) -> None:
        self._entities[record.id] = record
        self._order.setdefault(("entity", record.id), None)

    def _put_link(self, key: tuple[str, str, str], record: LinkRecord | None) -> None:
        if record is None:
            self._links.pop(key, None)
        else:
            self._links[key] = record
        self._order.setdefault(("link", key), None)

    def _put_fact(self, record: FactRecord) -> None:
        self._facts[record.id] = record
        self._order.setdefault(("fact", record.id), None)

    def _set_place(self, entity_id: str, rel: str, target_id: str) -> None:
        """一个人或物同一时刻只在一处：去掉原来的位置或持有者，再加新的。"""
        key = (entity_id, rel, target_id)
        for link in list(self._links.values()):
            if link.src_id == entity_id and link.rel in PLACE_RELS and link.key != key:
                self._put_link(link.key, None)
        if key not in self._links:
            self._put_link(key, LinkRecord(entity_id, rel, target_id, since_seq=self._seq))

    def _merge_aliases(
        self, name: str, current: Iterable[str], extra: Iterable[str]
    ) -> tuple[str, ...]:
        own = normalize_name(name)
        seen: set[str] = set()
        result: list[str] = []
        for alias in [*current, *extra]:
            display = clean_display_name(str(alias))
            norm = normalize_name(display)
            if norm and norm != own and norm not in seen:
                seen.add(norm)
                result.append(display)
        return tuple(result[:MAX_ALIASES])

    def _merge_details(
        self, kind: str, current: Mapping[str, Any], details: Mapping[str, Any]
    ) -> dict[str, Any]:
        allowed = DETAIL_KEYS.get(kind, ())
        data = dict(current)
        for key, value in details.items():
            if key not in allowed:
                raise DraftError("bad_detail", key=key, allowed=", ".join(allowed) or "-")
            text = _clean(value, DETAIL_CHARS)
            if text:
                data[key] = text
            else:
                data.pop(key, None)
        return data

    def _seen(self, involved: Sequence[str]) -> list[str]:
        """这一回合出现过的实体：收尾时点名的、被改过的、关系变了的两端、新事实涉及的。"""
        seen: dict[str, None] = dict.fromkeys(involved)
        for target, key in self._order:
            if target == "entity":
                seen.setdefault(key, None)
            elif target == "link":
                seen.setdefault(key[0], None)
                seen.setdefault(key[2], None)
            elif target == "fact" and key not in self._original_facts:
                for entity_id in self._facts[key].entity_ids:
                    seen.setdefault(entity_id, None)
        return [i for i in seen if i in self._entities and i != self._world_id]

    def _changes(self) -> list[RowChange]:
        entities: list[RowChange] = []
        links: list[RowChange] = []
        facts: list[RowChange] = []
        for target, key in self._order:
            if target == "entity":
                before = self._original_entities.get(key)
                after = self._entities[key]
                if before is not None and after != before:
                    after = dataclasses.replace(after, rev=before.rev + 1)
                    self._entities[key] = after
                if after != before:
                    entities.append(
                        RowChange("entity", before.to_json() if before else None, after.to_json())
                    )
            elif target == "link":
                before_link = self._original_links.get(key)
                after_link = self._links.get(key)
                if before_link != after_link:
                    links.append(
                        RowChange(
                            "link",
                            before_link.to_json() if before_link else None,
                            after_link.to_json() if after_link else None,
                        )
                    )
            else:
                before_fact = self._original_facts.get(key)
                after_fact = self._facts[key]
                if before_fact != after_fact:
                    facts.append(
                        RowChange(
                            "fact",
                            before_fact.to_json() if before_fact else None,
                            after_fact.to_json(),
                        )
                    )
        # 写入时先建实体，再改关系和事实；撤销时倒过来
        return entities + links + facts
