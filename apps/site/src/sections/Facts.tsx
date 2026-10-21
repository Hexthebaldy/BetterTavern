/** 一览：墨色窄带 */

const FACTS = [
  { k: "角色卡", v: "SillyTavern V1、V2、V3，PNG 或 JSON" },
  { k: "模型", v: "DeepSeek、OpenAI、Grok、Gemini、Hugging Face，或兼容 OpenAI 接口的服务" },
  { k: "服务器", v: "Python（FastAPI）和 PostgreSQL，可以用 Docker Compose 部署" },
  { k: "界面", v: "中文 · English · 日本語" },
];

export function Facts() {
  return (
    <section className="band ink thin" aria-label="一览">
      <div className="wrap">
        <div className="facts">
          {FACTS.map((f) => (
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
