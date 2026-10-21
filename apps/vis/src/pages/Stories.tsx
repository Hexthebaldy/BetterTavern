/**
 * 故事列表 → 某个故事的回合列表（每个回合一行：状态、首字、总耗时、模型、token、重试和断线次数），
 * 下面列出章节整理写的记忆（章节摘要、全书梗概和玩家画像的各个版本）。
 */

import { Link, useNavigate, useParams } from "react-router-dom";

import { type MemoryItem, usePlaythrough, usePlaythroughs } from "../api.ts";
import { ErrorBox, IdChip, Loading, Pill, statusTone, usePref } from "../components/common.tsx";
import { ACTION_SOURCES, errorCode, OPTION_SOURCES, TURN_STATUS } from "../lib/catalog.ts";
import { ago, clock, duration, modelName, tokens } from "../lib/format.ts";

export function Stories() {
  const { data, error, isLoading } = usePlaythroughs();
  const navigate = useNavigate();
  return (
    <div className="page">
      <div className="page-head">
        <h1>故事</h1>
        <span className="mut">所有用户的故事，最近有动静的在前</span>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {isLoading ? <Loading /> : null}
      {data && data.playthroughs.length === 0 ? <div className="empty">还没有故事。</div> : null}
      {data && data.playthroughs.length > 0 ? (
        <table className="list nowrap">
          <thead>
            <tr>
              <th>标题</th>
              <th>角色卡</th>
              <th>回合</th>
              <th>失败</th>
              <th>用户</th>
              <th>最近</th>
            </tr>
          </thead>
          <tbody>
            {data.playthroughs.map((p) => (
              <tr key={p.id} className="link" onClick={() => navigate(`/stories/${p.id}`)}>
                <td>
                  <b>{p.title}</b> {p.generating ? <Pill tone="acc">生成中</Pill> : null}
                  {p.seed_source === "minimal" ? <Pill tone="warn">最小世界</Pill> : null}
                </td>
                <td className="mut">{p.scenario_name ?? "（剧本已删除）"}</td>
                <td>{p.turns}</td>
                <td>{p.failed > 0 ? <Pill tone="error">{p.failed}</Pill> : <span className="mut">0</span>}</td>
                <td className="mono mut">{p.user_ref}</td>
                <td className="mut">{ago(p.last_turn_at ?? p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function StoryDetail() {
  const { id = "" } = useParams();
  // 和回合详情页共用“显示故事内容”的开关：打开时记忆显示原文
  const [storyPref] = usePref("vis.story", "0");
  const { data, error, isLoading } = usePlaythrough(id, storyPref === "1");
  const navigate = useNavigate();
  if (isLoading) return <Loading />;
  if (error || !data) {
    return (
      <div className="page">
        <ErrorBox error={error ?? "没有数据"} />
      </div>
    );
  }
  const { playthrough: p, turns } = data;
  const maxDuration = Math.max(1, ...turns.map((t) => t.duration_ms ?? 0));
  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/stories">故事</Link>
      </div>
      <div className="page-head">
        <h1>{p.title}</h1>
        <span className="mut">
          {p.scenario_name ?? "（剧本已删除）"} · {p.user_ref} · 开局于 {clock(p.created_at)}
          {p.seed_source === "minimal" ? " · 世界用的是最小设定" : ""}
        </span>
        <IdChip id={p.id} length={12} />
        <Link to={`/logs?id=${p.id}`} className="small">
          在原始日志里看
        </Link>
      </div>
      <table className="list nowrap">
        <thead>
          <tr>
            <th>回合</th>
            <th>行动</th>
            <th>状态</th>
            <th>首字</th>
            <th>总耗时</th>
            <th>模型</th>
            <th>输出 token</th>
            <th>断线</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((t) => (
            <tr key={t.id} className="link" onClick={() => navigate(`/turns/${t.id}`)}>
              <td>
                <b>{t.seq}</b>
                {t.attempt > 0 ? <span className="mut small"> · 第 {t.attempt + 1} 次</span> : null}
              </td>
              <td>
                {ACTION_SOURCES[t.action.source ?? ""] ?? t.action.source}
                {t.action.option_id ? <span className="mut"> {t.action.option_id}</span> : null}
              </td>
              <td>
                <Pill tone={statusTone(t.status)}>{TURN_STATUS[t.status] ?? t.status}</Pill>
                {t.error?.code ? (
                  <div className="small" style={{ color: "var(--err)" }}>
                    {errorCode(t.error.code)}
                  </div>
                ) : null}
                {t.options_source && t.options_source !== "model" ? (
                  <div className="small mut">选项来自{OPTION_SOURCES[t.options_source]}</div>
                ) : null}
              </td>
              <td>{duration(t.run?.ttft_ms)}</td>
              <td>
                <div className="durbar">
                  <i style={{ width: `${((t.duration_ms ?? 0) / maxDuration) * 120}px` }} />
                  {duration(t.duration_ms)}
                </div>
              </td>
              <td className="mono small">
                <span className="model" title={t.run?.model ?? undefined}>
                  {modelName(t.run?.model)}
                </span>
              </td>
              <td>{tokens(t.run?.output_tokens)}</td>
              <td>
                {t.log?.sse_drops ? (
                  <Pill>断线 {t.log.sse_drops}</Pill>
                ) : (
                  <span className="mut">–</span>
                )}
              </td>
              <td className="mut">{clock(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Memory items={data.memory} />
    </div>
  );
}

const MEMORY_KINDS: Record<MemoryItem["kind"], string> = {
  chapter: "章节摘要",
  synopsis: "全书梗概",
  profile: "玩家画像",
};

/** 章节整理写的记忆，按写的先后排。原文只在打开“显示故事内容”时有 */
function Memory({ items }: { items: MemoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2>记忆</h2>
      <table className="list">
        <thead>
          <tr>
            <th>种类</th>
            <th>覆盖的回合</th>
            <th>写于</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m, i) => (
            <tr key={i}>
              <td className="nowrap">{MEMORY_KINDS[m.kind] ?? m.kind}</td>
              <td className="nowrap">
                {m.kind === "profile" ? `到第 ${m.last_seq} 回合` : `第 ${m.first_seq}–${m.last_seq} 回合`}
              </td>
              <td className="nowrap mut">第 {m.written_seq} 回合</td>
              <td>{m.text ? <div className="story">{m.text}</div> : <span className="mut">已隐藏：{m.chars} 字</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
