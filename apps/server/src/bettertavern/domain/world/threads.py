"""线索的修改清单：世界状态 agent 记下、解开、合并线索，写下导演定下的答案
（docs/agent-runtime.md 第 7 节“线索与伏笔”）。

和 WorldDraft 一样在内存里的一份副本上逐项执行、当场检查，不合规就抛 DraftError；
给模型看的编号是 t1、t2……，只在这一次运行里有效。

- 线索要少而大：没解开的最多 MAX_OPEN_THREADS 条，满了先解开或合并旧的才能记新的；
  每回合最多新记 MAX_NEW_THREADS 条（合并出来的那一条也算）。
- 答案是导演定下的真相（来自隐藏备注），只给导演看；原文移出上下文以后答案还在。

收尾时算出每一行改之前和改之后的样子（RowChange，target 是 thread），和实体、事实的改动
一起写入、一起记进 state_patches，回退时倒着写回：这一回合新记的线索删掉，这一回合解开或
合并掉的变回没解开，答案也改回原来的。
"""

from __future__ import annotations

import dataclasses
import re
import uuid
from collections.abc import Callable, Iterable, Sequence

from .draft import DraftError
from .records import RowChange, ThreadRecord

THREAD_KINDS = ("mystery", "promise", "foreshadow")
MAX_NEW_THREADS = 2  # 每回合最多新记几条
MAX_OPEN_THREADS = 15  # 没解开的最多几条
THREAD_CHARS = 160
ANSWER_CHARS = 200

_THREAD_REF = re.compile(r"^t(\d+)$")


def _clean(text: str, limit: int = THREAD_CHARS) -> str:
    return " ".join(str(text or "").split())[:limit]


class ThreadDraft:
    def __init__(
        self,
        threads: Iterable[ThreadRecord],
        *,
        seq: int,
        turn_id: str,
        new_id: Callable[[], str] = lambda: str(uuid.uuid4()),
    ) -> None:
        self._original = {t.id: t for t in threads if t.status == "open"}
        self._threads = dict(self._original)
        self._seq = seq
        self._turn_id = turn_id
        self._new_id = new_id
        self._refs = list(self._original)
        self._order: dict[str, None] = {}
        self._created = 0

    # ---- 读 ----------------------------------------------------------------------------
    @property
    def open_threads(self) -> list[ThreadRecord]:
        """还没解开的线索，按记下的回合从早到晚。"""
        live = [t for t in self._threads.values() if t.status == "open"]
        return sorted(live, key=lambda t: (t.opened_seq, self._refs.index(t.id)))

    def ref(self, thread_id: str) -> str:
        return f"t{self._refs.index(thread_id) + 1}"

    def label(self, ref: str) -> str | None:
        match = _THREAD_REF.match(ref)
        if match is None:
            return None
        index = int(match.group(1)) - 1
        if not 0 <= index < len(self._refs):
            return None
        return self._threads[self._refs[index]].text[:40]

    def resolve(self, ref: str) -> ThreadRecord:
        """编号对应的、还没解开的线索。"""
        match = _THREAD_REF.match(ref.strip())
        index = int(match.group(1)) - 1 if match else -1
        if not 0 <= index < len(self._refs):
            raise DraftError("unknown_thread", ref=ref[:20])
        thread = self._threads[self._refs[index]]
        if thread.status != "open":
            raise DraftError("thread_closed", ref=ref[:20])
        return thread

    # ---- 改 ----------------------------------------------------------------------------
    def open(
        self, kind: str, text: str, entity_ids: Sequence[str], *, answer: str = ""
    ) -> ThreadRecord:
        record = self._new_thread(kind, text, entity_ids, answer)
        if len(self.open_threads) >= MAX_OPEN_THREADS:
            raise DraftError("too_many_open_threads", limit=MAX_OPEN_THREADS)
        return self._add(record)

    def close(self, ref: str) -> ThreadRecord:
        current = self.resolve(ref)
        return self._put(dataclasses.replace(current, status="closed", closed_seq=self._seq))

    def update(
        self, ref: str, *, text: str | None = None, answer: str | None = None
    ) -> ThreadRecord:
        """改一条没解开的线索的说法，或者写下（改写）导演定下的答案。"""
        current = self.resolve(ref)
        changes: dict[str, str] = {}
        if text is not None:
            value = _clean(text)
            if not value:
                raise DraftError("empty_thread")
            changes["text"] = value
        if answer is not None:
            changes["answer"] = _clean(answer, ANSWER_CHARS)
        return self._put(dataclasses.replace(current, **changes))

    def merge(
        self,
        refs: Sequence[str],
        *,
        kind: str,
        text: str,
        entity_ids: Sequence[str],
        answer: str = "",
    ) -> ThreadRecord:
        """几条说同一件事的线索合成一条新的：旧的标为 merged，指向新的那一条。
        新的那一条记在这一回合，答案不给就沿用旧线索里的。"""
        olds = [self.resolve(r) for r in dict.fromkeys(refs)]
        if len(olds) < 2:
            raise DraftError("merge_needs_two")
        merged_answer = answer or " ".join(t.answer for t in olds if t.answer)
        about = [*entity_ids, *(i for t in olds for i in t.entity_ids)]
        record = self._new_thread(kind, text, about, merged_answer, ignore={t.id for t in olds})
        for old in olds:
            self._put(
                dataclasses.replace(
                    old, status="merged", closed_seq=self._seq, merged_into=record.id
                )
            )
        return self._add(record)

    # ---- 收尾 --------------------------------------------------------------------------
    def changes(self) -> list[RowChange]:
        """按第一次改到的顺序；这一回合记下又解开的线索算一次新建（解开的样子）。
        合并时新的那一条排在被合并的几条后面，回退时倒着写回，先删新的再恢复旧的。"""
        out: list[RowChange] = []
        for thread_id in self._order:
            before = self._original.get(thread_id)
            after = self._threads[thread_id]
            if before != after:
                out.append(
                    RowChange("thread", before.to_json() if before else None, after.to_json())
                )
        return out

    # ---- 内部 --------------------------------------------------------------------------
    def _new_thread(
        self,
        kind: str,
        text: str,
        entity_ids: Sequence[str],
        answer: str,
        *,
        ignore: set[str] | None = None,
    ) -> ThreadRecord:
        """检查并建一条新线索（还没放进清单）；ignore 里的线索不算重复（合并时被合掉的）。"""
        if kind not in THREAD_KINDS:
            raise DraftError("bad_thread_kind", kind=kind[:20], allowed=", ".join(THREAD_KINDS))
        value = _clean(text)
        if not value:
            raise DraftError("empty_thread")
        if self._created >= MAX_NEW_THREADS:
            raise DraftError("too_many_threads", limit=MAX_NEW_THREADS)
        for existing in self.open_threads:
            if existing.text == value and existing.id not in (ignore or ()):
                raise DraftError("duplicate_thread", ref=self.ref(existing.id))
        return ThreadRecord(
            id=self._new_id(),
            kind=kind,
            text=value,
            entity_ids=tuple(dict.fromkeys(entity_ids)),
            status="open",
            opened_seq=self._seq,
            source_turn_id=self._turn_id,
            answer=_clean(answer, ANSWER_CHARS),
        )

    def _add(self, record: ThreadRecord) -> ThreadRecord:
        self._threads[record.id] = record
        self._refs.append(record.id)
        self._order.setdefault(record.id, None)
        self._created += 1
        return record

    def _put(self, record: ThreadRecord) -> ThreadRecord:
        self._threads[record.id] = record
        self._order.setdefault(record.id, None)
        return record
