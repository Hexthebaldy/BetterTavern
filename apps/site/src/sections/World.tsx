/**
 * 02 世界状态：说明、秘密、关系图。
 * 鼠标移到节点上（或键盘聚焦），只亮它和它的邻居；点节点在下面看详情。秘密先模糊，点“揭示”要确认一次，揭开后图上多一条虚线。
 */

import { useState } from "react";

import { Icon, type IconName } from "../components/Icon.tsx";
import {
  edgesShown,
  highlight,
  kindLabel,
  NODE_IDS,
  NODES,
  nodeAria,
  relations,
  SECRET_EDGE,
  SECRET_TEXT,
  type Kind,
  type NodeId,
} from "../world/graph.ts";

const KIND_ICON: Record<Kind, IconName> = { person: "person", place: "place", item: "item" };

type Secret = "hidden" | "ask" | "shown";

export function World() {
  const [secret, setSecret] = useState<Secret>("hidden");
  const [sel, setSel] = useState<NodeId>("me");
  const [focus, setFocus] = useState<NodeId | null>(null);
  const shown = secret === "shown";
  const hl = highlight(focus, shown);
  const sn = NODES[sel];

  return (
    <section className="band blue" id="world">
      <div className="wrap">
        <div className="stage">
          <div className="left">
            <span className="num">
              <b>02</b>
            </span>
            <h2 className="h-l">世界状态</h2>
            <p className="lead">
              开局时，AI 先读角色卡，整理出人物、地点、物品、组织和秘密。之后每一段都参照这些来写，并随剧情更新。
            </p>
            <ul className="ticks">
              <li>
                <span className="tic">
                  <Icon name="person" size="s" />
                </span>
                人物、地点、物品、组织，各自记录当前状态
              </li>
              <li>
                <span className="tic">
                  <Icon name="graph" size="s" />
                </span>
                关系图：谁在哪里、谁拿着什么、谁和谁有关系
              </li>
              <li>
                <span className="tic">
                  <Icon name="lock" size="s" />
                </span>
                主角还不知道的秘密默认隐藏，确认后才显示
              </li>
            </ul>
            <div className="secret">
              <div className="row">
                <span className="lock">
                  <Icon name="lock" size="s" />
                </span>
                {!shown && <span className="sr">1 条未揭示的秘密</span>}
                <p className={shown ? "sx" : "sx hid"} aria-hidden={!shown} style={{ margin: 0 }}>
                  {SECRET_TEXT}
                </p>
                {secret === "hidden" && (
                  <button className="btn sec sm" type="button" onClick={() => setSecret("ask")}>
                    揭示
                  </button>
                )}
                {shown && <span className="badge warn">已揭示</span>}
              </div>
              {secret === "ask" && (
                <div className="ask" role="alert">
                  <span>揭示一条秘密？揭示后会看到主角还不知道的事。</span>
                  <button className="btn sec sm" type="button" onClick={() => setSecret("hidden")}>
                    取消
                  </button>
                  <button
                    className="btn pri sm"
                    type="button"
                    style={{ padding: "0 18px" }}
                    onClick={() => {
                      setSecret("shown");
                      setSel("keeper");
                    }}
                  >
                    揭示
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="gwrap">
            <p className="cap" style={{ padding: "0 6px" }}>
              <span className="on-hover">鼠标移到节点上，相关的关系会高亮；点击查看详情。</span>
              <span className="on-touch">点一下节点，查看详情和相关的关系。</span>
            </p>
            <div className="graph" role="group" aria-label="关系图：雾港守夜人" onMouseLeave={() => setFocus(null)}>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {[...edgesShown(false), SECRET_EDGE].map((e, i) => {
                  const isSecret = e === SECRET_EDGE;
                  // 秘密那条线一直画着，揭开前看不见；高亮按当前画出来的线算
                  const index = isSecret ? (shown ? edgesShown(true).length - 1 : -1) : i;
                  const cls = [
                    "ge",
                    isSecret ? "sec" : "",
                    isSecret && shown ? "show" : "",
                    hl ? (hl.litEdges.has(index) ? "lit" : "dim") : "",
                  ];
                  return (
                    <line
                      key={`${e.a}-${e.b}${isSecret ? "-sec" : ""}`}
                      className={cls.filter(Boolean).join(" ")}
                      x1={NODES[e.a].x}
                      y1={NODES[e.a].y}
                      x2={NODES[e.b].x}
                      y2={NODES[e.b].y}
                    />
                  );
                })}
              </svg>
              {NODE_IDS.map((id) => {
                const n = NODES[id];
                const cls = ["gn", id === "me" ? "me" : "", sel === id ? "sel" : "", hl?.dimNodes.has(id) ? "dim" : ""];
                return (
                  <button
                    key={id}
                    className={cls.filter(Boolean).join(" ")}
                    type="button"
                    style={{ left: `${n.x}%`, top: `${n.y}%` }}
                    aria-pressed={sel === id}
                    aria-label={nodeAria(id)}
                    onMouseEnter={() => setFocus(id)}
                    onFocus={() => setFocus(id)}
                    onBlur={() => setFocus(null)}
                    onClick={() => setSel(id)}
                  >
                    <span className="gi">
                      <Icon name={KIND_ICON[n.kind]} />
                    </span>
                    <span>{n.label}</span>
                    {id === "me" && <span className="hide-sm">· 林深</span>}
                  </button>
                );
              })}
            </div>
            <div className="info" aria-live="polite">
              <div className="top">
                <span className={sel === "me" ? "badge acc" : "badge"}>{kindLabel(sel)}</span>
                <span className="nm">{sel === "me" ? "我 · 林深" : sn.label}</span>
              </div>
              <p className="txt" style={{ fontSize: 14.5, lineHeight: "24px" }}>
                {sn.desc}
              </p>
              <div className="rels">
                {relations(sel, shown).map((r, i) => (
                  <span key={i} className={r.secret ? "rel secr" : "rel"}>
                    {r.pre}
                    <b>{r.target}</b>
                    {r.post}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
