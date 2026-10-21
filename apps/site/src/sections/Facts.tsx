/** 一览：墨色窄带 */

import { useCopy } from "../i18n/context.tsx";

export function Facts() {
  const { facts } = useCopy();
  return (
    <section className="band ink thin" aria-label={facts.aria}>
      <div className="wrap">
        <div className="facts">
          {facts.items.map((f) => (
            <div className="fact" key={f.k}>
              <span className="k">{f.k}</span>
              <span className="v">{f.v}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
