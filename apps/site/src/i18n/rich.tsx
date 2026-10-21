/** 文案里用反引号括起来的部分显示成行内代码，比如 `make web` */

import { richParts } from "./format.ts";

export function Rich({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((p, i) =>
        p.code ? (
          <code key={i} className="ic">
            {p.text}
          </code>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
