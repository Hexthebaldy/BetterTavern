/**
 * 服务商图块里的方形标记（和网页端 apps/web/src/pages/settings/parts.tsx 的 ProviderMark 画法一样）：
 * 有标志的画 @bettertavern/design 的 providerLogos.ts（品牌原色；单色标志用当前文字颜色；带渐变的路径按渐变填，
 * 例如 Gemini），没有的（自定义兼容端点）写 { }。
 */

import { useId } from "react";

import { providerLogo } from "@bettertavern/design/providerLogos";

export function ProviderMark({ provider }: { provider: string }) {
  const logo = providerLogo(provider);
  // 渐变的 id 在整个页面里要唯一
  const gradientId = useId().replace(/[^\w-]/g, "");
  return (
    <span className="mk" aria-hidden="true">
      {logo ? (
        <svg viewBox={logo.viewBox} fillRule={logo.fillRule}>
          <defs>
            {logo.paths.map((p, i) =>
              p.gradient ? (
                <linearGradient
                  key={i}
                  id={`${gradientId}-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={p.gradient.x1}
                  y1={p.gradient.y1}
                  x2={p.gradient.x2}
                  y2={p.gradient.y2}
                >
                  {p.gradient.stops.map((stop, j) => (
                    <stop key={j} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
                  ))}
                </linearGradient>
              ) : null,
            )}
          </defs>
          {logo.paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill={p.gradient ? `url(#${gradientId}-${i})` : (p.fill ?? "currentColor")}
            />
          ))}
        </svg>
      ) : (
        "{ }"
      )}
    </span>
  );
}
