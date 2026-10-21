/**
 * 06 部署：需要准备什么；Docker / 源码 / 网页 / 手机四组命令。
 * 四组命令横排在一条轨道上，切换标签时轨道滑过去，窗口的高度跟着当前这组变；标签下面的墨色底块也滑过去。
 * 左右键、Home、End 换标签（tabs.ts）。
 * 复制成功显示“已复制”；剪贴板不可用时自动选中命令，提示按 ⌘C 或 Ctrl+C（copy.ts）。窄屏上命令不折行，横向滚动。
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "../components/Icon.tsx";
import { commandText, DEPLOY_TABS, lineText, type DeployTab } from "../data/deploy.ts";
import { DOCS, EXTERNAL } from "../data/links.ts";
import { useCopy } from "../i18n/context.tsx";
import { copyCommands, copyLabel, COPY_RESET_MS, isApplePlatform, type CopyResult } from "./copy.ts";
import { DocNote } from "./DocNote.tsx";
import { nextTabIndex } from "./tabs.ts";

/** 窗口右下留出的位置，放命令框的蓝色投影（样式表里 .codes 的 padding） */
const SHADOW_ROOM = 6;

/**
 * 一组命令：终端样式的框，右上角“复制”。不是当前标签的不能操作（inert），滑走以后藏起来（样式表）。
 * 不开 JS 时 index.html 里的样式把四组竖着都显示出来，标签栏藏起来，每组的“终端”后面写上是哪一组（.nojs）
 */
function CommandBox({
  tab,
  active,
  ready,
  boxRef,
}: {
  tab: DeployTab;
  active: boolean;
  /** 页面接上交互以后才把没轮到的几组设成不能操作：不开 JS 时四组都要能选中、复制 */
  ready: boolean;
  boxRef: (el: HTMLDivElement | null) => void;
}) {
  const { deploy } = useCopy();
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef(0);
  const [copied, setCopied] = useState<CopyResult | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // 换了标签，提示回到“复制”
  useEffect(() => {
    if (!active) setCopied(null);
  }, [active]);

  const copy = async () => {
    setApple(isApplePlatform(navigator.platform || navigator.userAgent));
    const result = await copyCommands(commandText(tab.lines, deploy.notes), {
      writeText: navigator.clipboard?.writeText ? (text) => navigator.clipboard.writeText(text) : undefined,
      selectAndCopy: () => {
        const el = pre.current;
        const selection = window.getSelection();
        if (!el || !selection) return false;
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        const ok = document.execCommand("copy");
        if (ok) selection.removeAllRanges();
        return ok;
      },
    });
    setCopied(result);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), COPY_RESET_MS[result]);
  };

  return (
    <div
      ref={boxRef}
      className={active ? "code on" : "code"}
      role="tabpanel"
      id={`deploy-${tab.id}`}
      aria-labelledby={`deploy-tab-${tab.id}`}
      inert={ready && !active}
    >
      <div className="bar">
        <span className="lab">
          {deploy.terminal}
          <span className="nojs"> · {deploy.tabs[tab.id]}</span>
        </span>
        <button className={copied === "ok" ? "cp ok" : "cp"} type="button" onClick={copy}>
          <Icon name={copied === "ok" ? "check" : "copy"} size="s" />
          <span aria-live="polite">{deploy[copyLabel(copied, apple)]}</span>
        </button>
      </div>
      <pre ref={pre}>
        {tab.lines.map((line, i) => (
          <span key={i} className={line[0] === "#" ? "cm" : undefined} style={{ display: "block" }}>
            <span className="pr">{line[0] === "$" ? "$ " : ""}</span>
            {line[0] === "#" ? `# ${lineText(line, deploy.notes)}` : line[1]}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function Deploy() {
  const { deploy } = useCopy();
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  // 量出来的当前标签的位置（墨色底块）和这组命令的高度（窗口）；量到之前不设，按没有 JS 的样子画
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    const measure = () => {
      const tab = tabs.current[index];
      const box = boxes.current[index];
      if (tab) setMark({ left: tab.offsetLeft, width: tab.offsetWidth });
      if (box) setHeight(box.offsetHeight);
    };
    measure();
    // 字体加载完、窗口变宽变窄时，标签和命令框的尺寸会变
    const observer = new ResizeObserver(measure);
    for (const el of [...tabs.current, ...boxes.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [index]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(e.key, index, DEPLOY_TABS.length);
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    tabs.current[next]?.focus();
  };
  return (
    <section className="band ink" id="deploy">
      <div className="wrap">
        <div className="shead">
          <span className="num">
            <b>06</b>
          </span>
          <h2 className="h-l">{deploy.title}</h2>
          <p className="lead">{deploy.lead}</p>
        </div>
        <div className="deploy" style={{ marginTop: 0 }}>
          <div className="left">
            <h3 className="h-m">{deploy.needTitle}</h3>
            <ul className="req">
              {deploy.needs.map((n) => (
                <li key={n.k}>
                  <span>
                    <b>{n.k}</b>
                    {n.v}
                  </span>
                </li>
              ))}
            </ul>
            <p className="txt" style={{ fontSize: 14.5, lineHeight: "24px" }}>
              {deploy.note}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
              <a className="alink" href={DOCS.development} hrefLang="zh-CN" {...EXTERNAL}>
                {deploy.devGuide}
                <DocNote />
                <Icon name="arrowOut" size="s" />
              </a>
              <a className="alink" href={DOCS.nginx} {...EXTERNAL}>
                {deploy.proxy}
                <Icon name="arrowOut" size="s" />
              </a>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, minWidth: 0, width: "100%" }}>
            <div
              className={mark ? "tabs slid" : "tabs"}
              role="tablist"
              aria-label={deploy.tabsAria}
              onKeyDown={onKeyDown}
            >
              {mark && (
                <span
                  className="tab-mark"
                  aria-hidden="true"
                  style={{ width: mark.width, transform: `translateX(${mark.left}px)` }}
                />
              )}
              {DEPLOY_TABS.map((t, i) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  id={`deploy-tab-${t.id}`}
                  className={i === index ? "tab on" : "tab"}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-controls={`deploy-${t.id}`}
                  tabIndex={i === index ? 0 : -1}
                  onClick={() => setIndex(i)}
                >
                  {deploy.tabs[t.id]}
                </button>
              ))}
            </div>
            <div className="codes" style={height === null ? undefined : { height: height + SHADOW_ROOM }}>
              <div className="codes-track" style={{ transform: `translateX(calc(${-index} * (100% + 24px)))` }}>
                {DEPLOY_TABS.map((t, i) => (
                  <CommandBox
                    key={t.id}
                    tab={t}
                    active={i === index}
                    ready={ready}
                    boxRef={(el) => {
                      boxes.current[i] = el;
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
