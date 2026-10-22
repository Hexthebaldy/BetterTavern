/**
 * 协议页面用的极简 Markdown：一级、二级标题，段落，“- ”开头的列表；行内只认 **粗体**、[文字](地址) 和邮箱地址。
 * 文档是我们自己写的（content/<语言>/*.md），不渲染 HTML，也不用 dangerouslySetInnerHTML。
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [whole, bold, label, href, email] = match;
    const key = `${index}-${whole.length}`;
    if (bold !== undefined) out.push(<strong key={key}>{bold}</strong>);
    else if (label !== undefined && href !== undefined) {
      out.push(
        href.startsWith("/") ? (
          <Link key={key} to={href}>
            {label}
          </Link>
        ) : (
          <a key={key} href={href} rel="noopener">
            {label}
          </a>
        ),
      );
    } else if (email !== undefined) {
      out.push(
        <a key={key} href={`mailto:${email}`}>
          {email}
        </a>,
      );
    }
    last = index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 第一个一级标题当页面标题 */
export function documentTitle(source: string): string {
  const line = source.split("\n").find((l) => l.startsWith("# "));
  return line ? line.slice(2).trim() : "";
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim());
        const first = lines[0] ?? "";
        if (first.startsWith("# ")) return <h1 key={i}>{inline(first.slice(2))}</h1>;
        if (first.startsWith("## ")) return <h2 key={i}>{inline(first.slice(3))}</h2>;
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </>
  );
}
