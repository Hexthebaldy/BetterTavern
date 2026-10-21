/**
 * 首屏演示：App 阅读页的样子（里面保持 App 的柔和样式，只有外框是粗边和硬投影）。
 * 故事和推进规则在 story.ts。
 */

import { Fragment, useState } from "react";

import { Icon, type IconName } from "../components/Icon.tsx";
import {
  initialState,
  isEnded,
  segments,
  statusText,
  STORY,
  worldEntries,
  type DemoState,
  type EntityKind,
} from "./story.ts";

const KIND_ICON: Record<EntityKind, IconName> = { person: "person", place: "place", item: "item", fact: "doc" };
const KEYS = ["A", "B"];

/** 标题栏左边的封面（灯塔和浪） */
function Cover() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M-2 31q5.5-3.6 11 0t11 0 11 0 11 0"
        style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 1.6, strokeLinecap: "round" }}
      />
      <path
        d="M-2 36q5.5-3.6 11 0t11 0 11 0 11 0"
        style={{ fill: "none", stroke: "var(--line2)", strokeWidth: 1.6, strokeLinecap: "round" }}
      />
      <path d="M20 13l4.2 15.5h-8.4z" style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 1.6, strokeLinejoin: "round" }} />
      <circle cx="20" cy="10.2" r="2.6" style={{ fill: "var(--acc)" }} />
    </svg>
  );
}

export function Demo() {
  const [s] = useState<DemoState>(() => initialState());
  const [dark] = useState(false);
  const [world] = useState(false);

  const cur = STORY[s.node];
  const idle = s.phase === "idle";
  const ended = isEnded(s);
  const hasFresh = s.fresh.length > 0 && !world;

  return (
    <section className={dark ? "dm D" : "dm"} aria-label="演示：雾港守夜人">
      <header className="dm-top">
        <span className="dm-cover">
          <Cover />
        </span>
        <div className="dm-ttl">
          <b>雾港守夜人</b>
          <button className="me-pill" type="button" aria-label={`我是 ${s.name}，点一下换个名字`}>
            我是 {s.name}
            <Icon name="pencil" />
          </button>
        </div>
        <button className="ib" type="button" aria-label={dark ? "切回浅色" : "切到夜间"} aria-pressed={dark}>
          <Icon name={dark ? "sun" : "moon"} />
        </button>
        <button className="ib" type="button" aria-label="从头再读">
          <Icon name="restart" />
        </button>
      </header>

      <div className="dm-feed">
        {segments(s).map((seg, i) => (
          <Fragment key={i}>
            <p className="narr">
              {seg.text}
              {seg.caret && <span className="caret" aria-hidden="true" />}
            </p>
            {seg.act && (
              <p className="note">
                <span className="sr">我的行动：</span>
                {seg.act}
              </p>
            )}
          </Fragment>
        ))}

        {idle && cur.options && (
          <div className="opts appear" role="group" aria-label="选一个行动">
            {cur.options.map((o, i) => (
              <button
                key={o.label}
                className={s.chosen === i ? "opt on" : "opt"}
                type="button"
                disabled={s.chosen !== null}
                aria-label={`${KEYS[i]}：${o.label}`}
              >
                <span className="key" aria-hidden="true">
                  {KEYS[i]}
                </span>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        )}

        {ended && (
          <div className="endc appear">
            <p className="t" style={{ margin: 0 }}>
              演示到这里结束。
            </p>
            <p className="txt" style={{ fontSize: 14.5, lineHeight: "24px" }}>
              实际使用时，故事由你配置的模型一直写下去。
            </p>
            <div className="row">
              <button className="btn pri sm" type="button">
                从头再读
              </button>
              <a className="btn line sm" href="#deploy">
                部署说明
              </a>
            </div>
          </div>
        )}
        <span className="sr" aria-live="polite">
          {s.live}
        </span>
      </div>

      <footer className="dm-bar">
        <button
          className={world ? "tb on" : "tb"}
          type="button"
          aria-label={world ? "收起世界" : hasFresh ? "世界，有新内容" : "世界"}
          aria-expanded={world}
        >
          <Icon name="compass" style={{ width: 21, height: 21 }} />
          {hasFresh && <span className="bdg" />}
        </button>
        {!idle && (
          <>
            <div className="status">
              <span className="pulse" />
              <span>{statusText(s)}</span>
            </div>
            <button className="ghost" type="button">
              全部显示
            </button>
          </>
        )}
        {idle && !ended && (
          <button className="wpill" type="button">
            <Icon name="pencil" size="s" />
            <span style={{ flex: 1 }}>自己写…</span>
          </button>
        )}
        {ended && (
          <button className="wpill" type="button">
            <Icon name="restart" size="s" />
            <span style={{ flex: 1 }}>从头再读</span>
          </button>
        )}
      </footer>

      {world && (
        <div className="ws" role="dialog" aria-label="世界">
          <div className="ws-h">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t">世界</div>
              <div className="s">人物、地点、物品和已知的事实</div>
            </div>
            <button className="ib" type="button" aria-label="收起世界" style={{ background: "var(--card)" }}>
              <Icon name="close" />
            </button>
          </div>
          <div className="ws-l">
            {worldEntries(s).map((e) => (
              <div key={e.id} className={["ent", e.me ? "me" : "", e.fresh ? "fresh" : ""].filter(Boolean).join(" ")}>
                <span className="eic">
                  <Icon name={KIND_ICON[e.kind]} size="s" />
                </span>
                <span className="nm">
                  <b>{e.name}</b>
                  <span>
                    {e.kindLabel} · {e.note}
                  </span>
                </span>
                {e.isNew && <span className="tag new">新</span>}
                {e.isUpd && <span className="tag upd">更新</span>}
              </div>
            ))}
          </div>
          <div className="ws-f">主角还不知道的秘密默认隐藏，确认后才会显示。</div>
        </div>
      )}
    </section>
  );
}
