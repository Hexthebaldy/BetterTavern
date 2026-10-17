"""M0 go/no-go：导演输出协议的合规率。

在真实模型上连续跑 N 个回合（默认 200），统计：
- 无需修复就合规的比例（解析阶段 ok）；
- 含修复后合规的比例（ok + 解析器抢救 + OptionsRepair 补齐，不含默认选项和失败）；
- 用了默认选项、失败的回合数；首 token 延迟；用量与缓存命中。

出口标准（docs/README.md 第 3 节）：200 回合里无需修复的合规率不低于 95%，含修复不低于 99.5%。

用法（在 apps/server 下）：

    DEEPSEEK_API_KEY=sk-... uv run python -m evals.director_compliance \\
        --provider deepseek --model deepseek-flash

    HF_TOKEN=hf_... uv run python -m evals.director_compliance \\
        --provider huggingface --model Qwen/Qwen3-32B:fastest --api-key-env HF_TOKEN

    uv run python -m evals.director_compliance --provider custom_openai \\
        --base-url http://localhost:11434/v1 --allow-private --model qwen3 --api-key-env OLLAMA_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import yaml

from bettertavern.domain.story.options import fallback_options
from bettertavern.providers import (
    HOT_PATH,
    Capabilities,
    ChatRequest,
    Done,
    Message,
    ProviderAdapter,
    ProviderError,
    ReasoningConfig,
    ResolvedCredential,
    Secret,
    TextDelta,
    UsageEvent,
    default_registry,
    resolve_capabilities,
    stream_with_retry,
)
from bettertavern.providers.capabilities import load_rules
from bettertavern.providers.transport import EndpointPolicy, build_http_client
from bettertavern.runtime.agents.options_repair import repair_options
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.director_parser import DirectorStreamParser, ParseStage
from bettertavern.runtime.protocol.repair import NarrativeMissing, finalize_director_output

EVALS_ROOT = Path(__file__).resolve().parent
DEFAULT_SCENARIO = EVALS_ROOT / "datasets" / "m0" / "tavern.yaml"
DEFAULT_OUT_DIR = EVALS_ROOT / "reports"
DEFAULT_API_KEY_ENV = {"deepseek": "DEEPSEEK_API_KEY", "huggingface": "HF_TOKEN"}
GO_TURNS = 200
GO_NO_REPAIR = 0.95
GO_WITH_REPAIR = 0.995
CONTINUE_ACTION = "我稍作停顿，留意周围的动静。"


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    world: str
    protagonist: dict[str, str]
    characters: list[dict[str, str]]
    style: str
    length: str  # short / medium / long
    opening: str
    actions: list[str]


def load_scenario(path: Path) -> Scenario:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Scenario(
        id=data["id"],
        title=data["title"],
        world=data["world"],
        protagonist=dict(data["protagonist"]),
        characters=[dict(c) for c in data.get("characters") or []],
        style=data.get("style", ""),
        length=data.get("length")
        if data.get("length") in ("short", "medium", "long")
        else "medium",
        opening=data["opening"],
        actions=list(data.get("actions") or []),
    )


@dataclass
class EvalConfig:
    provider: str
    model: str
    api_key: str
    base_url: str | None = None
    turns: int = GO_TURNS
    history_turns: int = 12
    max_tokens: int = 1024
    temperature: float | None = 0.9
    thinking: bool = False
    seed: int = 7
    free_action_ratio: float = 0.15
    allow_private: bool = False
    proxy: str | None = None
    scenario_path: Path = DEFAULT_SCENARIO


@dataclass
class TurnRecord:
    index: int
    action: str
    stage: str
    repairs: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    error: str | None = None
    ttft_ms: int | None = None
    total_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    finish_reason: str | None = None
    narrative_chars: int = 0
    options: list[str] = field(default_factory=list)


def percentile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(round(q * (len(ordered) - 1)), len(ordered) - 1)
    return ordered[index]


def summarize(records: Sequence[TurnRecord]) -> dict[str, Any]:
    total = len(records)
    counts = Counter(r.stage for r in records)
    ok = counts[ParseStage.OK.value]
    compliant = ok + counts[ParseStage.SALVAGED.value] + counts[ParseStage.REPAIRED.value]
    no_repair = ok / total if total else 0.0
    with_repair = compliant / total if total else 0.0
    ttfts = [r.ttft_ms for r in records if r.ttft_ms is not None]
    prompt = sum(r.prompt_tokens for r in records)
    cached = sum(r.cached_tokens for r in records)
    if total < GO_TURNS:
        verdict = f"样本不足：出口标准要求至少 {GO_TURNS} 回合"
    elif no_repair >= GO_NO_REPAIR and with_repair >= GO_WITH_REPAIR:
        verdict = "go"
    else:
        verdict = "no-go"
    repairs = Counter(reason for r in records for reason in r.repairs)
    return {
        "turns": total,
        "stages": dict(counts),
        "compliance_no_repair": round(no_repair, 4),
        "compliance_with_repair": round(with_repair, 4),
        "verdict": verdict,
        "ttft_ms_p50": percentile(ttfts, 0.5),
        "ttft_ms_p95": percentile(ttfts, 0.95),
        "avg_narrative_chars": (
            round(statistics.mean(r.narrative_chars for r in records if r.narrative_chars), 1)
            if any(r.narrative_chars for r in records)
            else 0
        ),
        "prompt_tokens": prompt,
        "completion_tokens": sum(r.completion_tokens for r in records),
        "cache_hit_ratio": round(cached / prompt, 4) if prompt else None,
        "top_repairs": repairs.most_common(10),
        "errors": dict(Counter(r.error.split(":")[0] for r in records if r.error)),
    }


class DirectorEval:
    def __init__(
        self,
        config: EvalConfig,
        adapter: ProviderAdapter,
        caps: Capabilities,
        *,
        prompts: PromptLibrary | None = None,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self.config = config
        self.adapter = adapter
        self.caps = caps
        self.prompts = prompts or PromptLibrary("zh")
        self.scenario = load_scenario(config.scenario_path)
        self.cred = ResolvedCredential(
            credential_id="eval",
            provider=config.provider,
            api_key=Secret(config.api_key),
            base_url=config.base_url,
        )
        self.rng = random.Random(config.seed)
        self.clock = clock
        self.history: list[tuple[str, str]] = []
        self.system = self.prompts.render(
            "director.system",
            protagonist=self.scenario.protagonist,
            world=self.scenario.world,
            characters=self.scenario.characters,
            style=self.scenario.style,
            length=self.scenario.length,
        )

    def messages(self, action: str) -> list[Message]:
        messages = [Message(role="system", content=self.system.text)]
        for past_action, narrative in self.history[-self.config.history_turns :]:
            messages.append(Message(role="user", content=self.turn_prompt(past_action)))
            # 历史里导演回合只保留叙述部分，选项不带
            messages.append(
                Message(role="assistant", content=f"<narrative>\n{narrative}\n</narrative>")
            )
        messages.append(Message(role="user", content=self.turn_prompt(action)))
        return messages

    def turn_prompt(self, action: str) -> str:
        return self.prompts.render("director.turn", action=sanitize_for_fence(action)).text

    def request(self, action: str) -> ChatRequest:
        reasoning = None
        if self.caps.reasoning.control != "none":
            reasoning = ReasoningConfig(enabled=self.config.thinking)
        return ChatRequest(
            messages=self.messages(action),
            model=self.config.model,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            reasoning=reasoning,
        )

    async def turn(self, index: int, action: str) -> TurnRecord:
        record = TurnRecord(index=index, action=action, stage=ParseStage.FAILED.value)
        parser = DirectorStreamParser()
        request = self.request(action)
        started = self.clock()
        try:
            async for event in stream_with_retry(
                lambda: self.adapter.stream(request, self.cred, self.caps), HOT_PATH
            ):
                if isinstance(event, TextDelta):
                    if record.ttft_ms is None:
                        record.ttft_ms = int((self.clock() - started) * 1000)
                    parser.feed(event.text)
                elif isinstance(event, UsageEvent):
                    record.prompt_tokens = event.usage.prompt
                    record.completion_tokens = event.usage.completion
                    record.cached_tokens = event.usage.cached
                elif isinstance(event, Done):
                    record.finish_reason = event.finish_reason
        except ProviderError as error:
            record.error = f"{error.error_class.value}: {error.message[:200]}"
            record.total_ms = int((self.clock() - started) * 1000)
            return record
        _, parse = parser.finish()

        async def repair(narrative: str, existing: Sequence[str]) -> Sequence[str]:
            return await repair_options(
                self.adapter,
                self.cred,
                self.caps,
                model=self.config.model,
                prompts=self.prompts,
                narrative=narrative,
                existing=existing,
            )

        try:
            outcome = await finalize_director_output(
                parse, repair=repair, fallback=fallback_options("zh")
            )
        except NarrativeMissing:
            record.error = "narrative_missing: 没有叙述"
            record.repairs = list(parse.repairs)
            record.total_ms = int((self.clock() - started) * 1000)
            return record
        record.stage = outcome.stage.value
        record.repairs = list(outcome.repairs)
        record.notes = list(outcome.notes)
        record.narrative_chars = len(outcome.narrative)
        record.options = list(outcome.options)
        record.total_ms = int((self.clock() - started) * 1000)
        self.history.append((action, outcome.narrative))
        return record

    def next_action(self, record: TurnRecord, index: int) -> str:
        if not record.options:
            return CONTINUE_ACTION
        if self.scenario.actions and self.rng.random() < self.config.free_action_ratio:
            return self.scenario.actions[index % len(self.scenario.actions)]
        return self.rng.choice(record.options)

    async def run(self, on_turn: Callable[[TurnRecord], None] | None = None) -> list[TurnRecord]:
        records: list[TurnRecord] = []
        action = self.scenario.opening
        for index in range(self.config.turns):
            record = await self.turn(index, action)
            records.append(record)
            if on_turn is not None:
                on_turn(record)
            action = self.next_action(record, index)
        return records


async def run_eval(
    config: EvalConfig,
    *,
    client: httpx.AsyncClient | None = None,
    on_turn: Callable[[TurnRecord], None] | None = None,
) -> dict[str, Any]:
    registry = default_registry()
    owns_client = client is None
    http = client or build_http_client(
        EndpointPolicy(allow_private=config.allow_private), proxy=config.proxy
    )
    try:
        adapter = registry.create_adapter(config.provider, http)
        caps = resolve_capabilities(config.provider, config.model, load_rules())
        evaluation = DirectorEval(config, adapter, caps)
        records = await evaluation.run(on_turn)
    finally:
        if owns_client:
            await http.aclose()
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "provider": config.provider,
        "model": config.model,
        "scenario": evaluation.scenario.id,
        "prompt_versions": {
            "director.system": evaluation.prompts.version("director.system"),
            "director.turn": evaluation.prompts.version("director.turn"),
            "options_repair": evaluation.prompts.version("options_repair"),
        },
        "config": {
            "turns": config.turns,
            "history_turns": config.history_turns,
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
            "thinking": config.thinking,
            "seed": config.seed,
        },
        "summary": summarize(records),
        "turns": [asdict(r) for r in records],
    }


def _print_summary(report: dict[str, Any]) -> None:
    s = report["summary"]
    print()
    print(f"模型：{report['provider']} / {report['model']}    回合：{s['turns']}")
    print(f"各阶段：{s['stages']}")
    print(f"无需修复的合规率：{s['compliance_no_repair']:.2%}（出口标准 ≥ {GO_NO_REPAIR:.0%}）")
    print(f"含修复的合规率：  {s['compliance_with_repair']:.2%}（出口标准 ≥ {GO_WITH_REPAIR:.1%}）")
    print(f"首 token 延迟 p50 / p95：{s['ttft_ms_p50']} / {s['ttft_ms_p95']} 毫秒")
    if s["cache_hit_ratio"] is not None:
        print(f"前缀缓存命中率：{s['cache_hit_ratio']:.2%}")
    if s["top_repairs"]:
        print("最常见的修补：")
        for reason, count in s["top_repairs"]:
            print(f"  {count:>4}  {reason}")
    if s["errors"]:
        print(f"错误：{s['errors']}")
    print(f"结论：{s['verdict']}")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="M0：导演输出协议合规率评测")
    parser.add_argument(
        "--provider", required=True, choices=["deepseek", "huggingface", "custom_openai"]
    )
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url", help="自定义端点必填；DeepSeek / HF 可不填")
    parser.add_argument("--api-key-env", help="从哪个环境变量读密钥（默认按厂商）")
    parser.add_argument("--turns", type=int, default=GO_TURNS)
    parser.add_argument("--history-turns", type=int, default=12)
    parser.add_argument("--max-tokens", type=int, default=1024)
    parser.add_argument("--temperature", type=float, default=0.9)
    parser.add_argument("--thinking", action="store_true", help="打开思考（默认关闭）")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--allow-private", action="store_true", help="允许 http 和内网地址")
    parser.add_argument("--proxy", default=os.environ.get("OUTBOUND_PROXY"))
    parser.add_argument("--scenario", type=Path, default=DEFAULT_SCENARIO)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    env_name = args.api_key_env or DEFAULT_API_KEY_ENV.get(args.provider)
    api_key = os.environ.get(env_name or "", "")
    if not api_key and args.provider != "custom_openai":
        print(f"请在环境变量 {env_name} 里提供密钥", file=sys.stderr)
        return 2
    if args.provider == "custom_openai" and not args.base_url:
        print("自定义端点需要 --base-url", file=sys.stderr)
        return 2
    config = EvalConfig(
        provider=args.provider,
        model=args.model,
        api_key=api_key,
        base_url=args.base_url,
        turns=args.turns,
        history_turns=args.history_turns,
        max_tokens=args.max_tokens,
        temperature=args.temperature,
        thinking=args.thinking,
        seed=args.seed,
        allow_private=args.allow_private,
        proxy=args.proxy,
        scenario_path=args.scenario,
    )

    def progress(record: TurnRecord) -> None:
        mark = {"ok": ".", "salvaged": "s", "repaired": "r", "fallback": "F"}.get(record.stage, "X")
        print(mark, end="" if (record.index + 1) % 50 else "\n", flush=True)

    report = asyncio.run(run_eval(config, on_turn=progress))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    safe_model = args.model.replace("/", "_").replace(":", "_")
    path = args.out_dir / f"{stamp}-{args.provider}-{safe_model}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    _print_summary(report)
    print(f"完整报告：{path}")
    return 0 if report["summary"]["verdict"] == "go" else 1


if __name__ == "__main__":
    raise SystemExit(main())
