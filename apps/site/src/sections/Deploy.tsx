/**
 * 06 部署：需要准备什么；Docker / 源码 / 网页 / 手机四组命令。
 * 复制成功显示“已复制”；剪贴板不可用时自动选中命令，提示按 ⌘C 或 Ctrl+C（copy.ts）。窄屏上命令不折行，横向滚动。
 */

import { useEffect, useRef, useState } from "react";

import { Icon } from "../components/Icon.tsx";
import { commandText, DEPLOY_TABS, lineText, type DeployTab } from "../data/deploy.ts";
import { DOCS, EXTERNAL } from "../data/links.ts";
import { useCopy } from "../i18n/context.tsx";
import { copyCommands, copyLabel, COPY_RESET_MS, isApplePlatform, type CopyResult } from "./copy.ts";
import { DocNote } from "./DocNote.tsx";

/**
 * 一组命令：终端样式的框，右上角“复制”。不是当前标签的带 hidden。
 * 不开 JS 时 index.html 里的样式把四组都显示出来，标签栏藏起来，每组的“终端”后面写上是哪一组（.nojs）
 */
function CommandBox({ tab, active }: { tab: DeployTab; active: boolean }) {
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
      className="code"
      role="tabpanel"
      id={`deploy-${tab.id}`}
      aria-labelledby={`deploy-tab-${tab.id}`}
      hidden={!active}
      style={{ width: "100%" }}
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
  const [tabId, setTabId] = useState<DeployTab["id"]>("docker");
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
            <div className="tabs" role="tablist" aria-label={deploy.tabsAria}>
              {DEPLOY_TABS.map((t) => (
                <button
                  key={t.id}
                  id={`deploy-tab-${t.id}`}
                  className={t.id === tabId ? "tab on" : "tab"}
                  type="button"
                  role="tab"
                  aria-selected={t.id === tabId}
                  aria-controls={`deploy-${t.id}`}
                  onClick={() => setTabId(t.id)}
                >
                  {deploy.tabs[t.id]}
                </button>
              ))}
            </div>
            {DEPLOY_TABS.map((t) => (
              <CommandBox key={t.id} tab={t} active={t.id === tabId} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
