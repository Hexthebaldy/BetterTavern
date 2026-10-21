/**
 * “长篇”里的 agent runtime 架构图，照设计稿 Landing.dc.html 的“03 长篇”：分三层，上面是玩家在等的 api 进程，
 * 中间一条 PostgreSQL，下面是 worker 的三个 agent。点上面的标签、点图里的框，或者按说明条上的按钮，一步一步看一回合；
 * 当前一步用到的框、数据和连线变蓝，连线在流动，其余变淡（arc/steps.ts）。窄于 820 时三层竖排，连线变成一行行说明。
 */

import { useState, type ReactNode } from "react";

import {
  ARC_CHIPS,
  ARC_GO,
  ARC_STEPS,
  arcClass,
  nextLabel,
  nextStep,
  type ArcKey,
  type ArcLink,
  type ArcPart,
} from "../arc/steps.ts";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useCopy } from "../i18n/context.tsx";

const cls = (...names: string[]) => names.filter(Boolean).join(" ");

/** 层与层之间的一条连线：up 往上读，dn 往下写，both 两头都有箭头 */
const LINK_DIR: Record<ArcLink, "up" | "dn" | "both"> = {
  rd: "up",
  rc: "both",
  wr: "dn",
  s1: "both",
  s2: "both",
  s3: "both",
};
const LINK_ICON = { up: "up", dn: "down", both: "upDown" } as const satisfies Record<string, IconName>;

export function Arc() {
  const { more } = useCopy();
  const t = more.arc;
  const p = t.parts;
  const [step, setStep] = useState(0);
  const c = (key: ArcKey) => arcClass(step, key);
  const go = (part: ArcPart) => () => setStep(ARC_GO[part]);
  const cur = t.steps[step]!;

  const node = (part: ArcPart, icon: IconName, title: string, children: ReactNode, agent = false) => (
    <button
      className={cls("arc-n", c(part))}
      type="button"
      onClick={go(part)}
      aria-pressed={c(part) === "on"}
    >
      <span className="t">
        <Icon name={icon} size="s" />
        {title}
        {agent && <span className="ag">agent</span>}
      </span>
      {children}
    </button>
  );
  const arrow = (key: "a1" | "a2" | "a3") => (
    <span className={cls("arc-ar", c(key))} aria-hidden="true">
      <Icon name="arrowRight" className="" />
    </span>
  );
  const link = (key: ArcLink, column?: number) => (
    <span
      className={cls("arc-lk", LINK_DIR[key], c(key))}
      style={column ? { gridColumn: column } : undefined}
    >
      <span className="lb">
        <Icon name={LINK_ICON[LINK_DIR[key]]} className="gi" />
        {t.links[key]}
      </span>
    </span>
  );

  return (
    <figure className="arc" aria-labelledby="arc-t">
      <div className="arc-hd">
        <div className="arc-ttl">
          <span className="arc-kick">AGENT RUNTIME</span>
          <h3 className="h-m" id="arc-t">
            {t.title}
          </h3>
        </div>
        <div className="arc-steps" role="group" aria-label={t.stepsAria}>
          {ARC_STEPS.map((s, i) => (
            <button
              key={i}
              className={i === step ? "arc-st on" : "arc-st"}
              type="button"
              aria-pressed={i === step}
              onClick={() => setStep(i)}
            >
              <b>{s.no}</b>
              {t.steps[i]!.label}
            </button>
          ))}
        </div>
      </div>
      <div className="arc-body">
        <div className="arc-lane">
          <span className="arc-tag">{t.fgLane}</span>
          <div className="arc-row4">
            {node(
              "act",
              "turnIn",
              p.act.t,
              <>
                <span className="d">{p.act.d}</span>
                <span className="arc-mini" aria-hidden="true">
                  <i>A</i>
                  <i>B</i>
                  <i className="w">{p.act.write}</i>
                </span>
              </>,
            )}
            {arrow("a1")}
            {node(
              "ctx",
              "layers",
              p.ctx.t,
              <>
                <span className="arc-cs" role="img" aria-label={p.ctx.aria}>
                  {p.ctx.rows.map((r, i) => (
                    <i key={i} className={`r${i + 1}`}>
                      {r}
                    </i>
                  ))}
                </span>
                <span className="d sm">{p.ctx.d}</span>
              </>,
            )}
            {arrow("a2")}
            {node(
              "dir",
              "clapper",
              p.dir.t,
              <>
                <span className="d">{p.dir.d}</span>
                <span className="arc-tools">
                  <span>recall</span>
                  <span>read_turn</span>
                  <span>lookup</span>
                </span>
                <span className="mdl">
                  <i />
                  {p.dir.model}
                </span>
              </>,
              true,
            )}
            {arrow("a3")}
            {node(
              "out",
              "stream",
              p.out.t,
              <>
                <span className="d">{p.out.d}</span>
                <span className="arc-tools">
                  {p.out.tools.map((x) => (
                    <span key={x}>{x}</span>
                  ))}
                </span>
              </>,
            )}
          </div>
        </div>
        <div className="arc-lk1">
          {link("rd", 3)}
          {link("rc", 5)}
          {link("wr", 7)}
        </div>
        <div className="arc-db">
          <div className="arc-dbh">
            <span className="dbi">
              <Icon name="database" size="s" />
            </span>
            <span>
              <b>PostgreSQL</b>
              <span>{t.db.sub}</span>
            </span>
          </div>
          <div className="arc-chips">
            {ARC_CHIPS.map((k) => (
              <span key={k} className={cls("arc-sc", k === "queue" ? "q" : "", c(k))}>
                {t.db.chips[k]}
              </span>
            ))}
          </div>
        </div>
        <div className="arc-lk2">
          {link("s1")}
          {link("s2")}
          {link("s3")}
        </div>
        <div className="arc-lane bg">
          <div className="arc-row3">
            {node(
              "st",
              "compass",
              p.st.t,
              <>
                <span className="d">{p.st.d}</span>
                <span className="arc-tools">
                  <span>{p.st.tools}</span>
                  <span>commit</span>
                  <span className="qn">{p.st.queue}</span>
                </span>
              </>,
              true,
            )}
            {node(
              "ch",
              "book",
              p.ch.t,
              <>
                <span className="d">{p.ch.d}</span>
                <span className="arc-tools">
                  <span className="qn">{p.ch.queue}</span>
                </span>
              </>,
              true,
            )}
            {node(
              "ol",
              "signpost",
              p.ol.t,
              <>
                <span className="d">{p.ol.d}</span>
                <span className="arc-tools">
                  <span className="qn">{p.ol.queue}</span>
                </span>
              </>,
              true,
            )}
          </div>
          <span className="arc-tag">{t.bgLane}</span>
        </div>
      </div>
      <figcaption className="arc-cap">
        <span className="no" aria-hidden="true">
          {ARC_STEPS[step]!.no || t.all}
        </span>
        <span className="tx" aria-live="polite">
          <b>{cur.title}</b>
          <span>{cur.text}</span>
        </span>
        <button className="arc-next" type="button" onClick={() => setStep(nextStep(step))}>
          {t[nextLabel(step)]}
          <Icon name="arrowRight" size="s" />
        </button>
      </figcaption>
    </figure>
  );
}
