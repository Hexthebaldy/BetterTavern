/**
 * 冒烟测试：打开三种语言的页面，点演示的选项、架构图的步骤，展开常见问题，切部署标签，换语言；
 * 首页按浏览器语言跳一次；宽度从 320 到 1440 都没有横向滚动；不开 JS 也看得到文字。
 */

import { expect, test, type Page } from "@playwright/test";

/** 记下页面上的报错（包括 hydrate 对不上） */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

async function loadedFonts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
  });
}

const PAGES = [
  { path: "./", lang: "zh-CN", title: /用 SillyTavern 角色卡玩的互动小说/, serif: "Noto Serif SC", first: "身后响起一声钟", demo: "演示：雾港守夜人" },
  { path: "en/", lang: "en", title: /Interactive fiction/, serif: "Noto Serif SC", first: "Behind me a bell rang once", demo: "Demo: Fog Harbor Watch" },
  { path: "ja/", lang: "ja", title: /インタラクティブノベル/, serif: "Noto Serif JP", first: "背後で鐘が一つ鳴った", demo: "デモ：霧港の夜番" },
] as const;

for (const p of PAGES) {
  test(`打开 ${p.path}：预渲染的内容、页面信息、字体`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(p.path);
    await expect(page).toHaveTitle(p.title);
    await expect(page.locator("html")).toHaveAttribute("lang", p.lang);
    await expect(page.getByRole("heading", { level: 1, name: "BetterTavern" })).toBeVisible();
    await expect(page.getByRole("region", { name: p.demo }).locator(".narr").first()).toContainText(p.first);

    const lead = (await page.locator(".hero .lead").textContent())?.trim();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", lead!);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", lead!);

    const fonts = await loadedFonts(page);
    expect(fonts).toContain(p.serif);
    expect(fonts).toContain("IBM Plex Mono");
    expect(errors).toEqual([]);
  });
}

test("演示：第一段已经写好，点选项往下读", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  const demo = page.getByRole("region", { name: "演示：雾港守夜人" });
  await expect(demo.locator(".narr").first()).toContainText("身后响起一声钟");
  // hydrate 以后第一段不重新逐字打
  await expect(demo.getByText("正在写开场")).toHaveCount(0);

  await demo.getByRole("button", { name: "A：先爬上灯塔，把灯点亮" }).click();
  await expect(demo.locator(".note")).toHaveText("我的行动：先爬上灯塔，把灯点亮");
  await expect(demo.getByRole("button", { name: "A：问她老周去了哪里" })).toBeVisible();
  await expect(demo.locator(".narr").nth(1)).toContainText("“林深？”她说");

  await demo.getByRole("button", { name: "B：先看那本航海日志" }).click();
  await expect(demo.getByText("演示到这里结束。")).toBeVisible();
  expect(errors).toEqual([]);
});

test("演示（英文）：选项和主角的名字是英文的", async ({ page }) => {
  await page.goto("en/");
  const demo = page.getByRole("region", { name: "Demo: Fog Harbor Watch" });
  await demo.getByRole("button", { name: "A: Climb the lighthouse and light the lamp" }).click();
  await expect(demo.locator(".narr").nth(1)).toContainText("“Rowan?” she said.");
});

test("架构图：点步骤、点框、按“下一步”", async ({ page }) => {
  await page.goto("./");
  const arc = page.locator("figure.arc");
  const caption = arc.locator(".arc-cap");
  await expect(caption).toContainText("全景");
  await expect(arc.locator(".arc-n.dim")).toHaveCount(0);

  await arc.locator(".arc-st", { hasText: "导演" }).click();
  await expect(arc.locator(".arc-st", { hasText: "导演" })).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toContainText("召回工具");
  await expect(arc.locator(".arc-n.on")).toHaveCount(1);

  await caption.getByRole("button", { name: "下一步" }).click();
  await expect(caption).toContainText("推给玩家");

  await arc.getByRole("button", { name: /大纲修订/ }).click();
  await expect(caption).toContainText("章节整理和大纲修订");
  await expect(arc.locator(".arc-n.on")).toHaveCount(2);
});

test("常见问题：一次展开一条", async ({ page }) => {
  await page.goto("./");
  const first = page.getByRole("button", { name: "收费吗？" });
  const lang = page.getByRole("button", { name: "支持哪些语言？" });
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(lang).toHaveAttribute("aria-expanded", "false");

  await lang.click();
  await expect(lang).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("界面有中文、英文和日文")).toBeVisible();
});

test("部署：切标签换命令", async ({ page }) => {
  await page.goto("./");
  const docker = page.getByRole("tabpanel", { name: "Docker" });
  await expect(docker).toBeVisible();
  await expect(docker).toContainText("docker compose -f deploy/docker-compose.yml up -d");

  await page.getByRole("tab", { name: "源码" }).click();
  await expect(page.getByRole("tab", { name: "源码" })).toHaveAttribute("aria-selected", "true");
  const source = page.getByRole("tabpanel", { name: "源码" });
  await expect(source).toContainText("make dev");
  await expect(docker).toBeHidden();

  await source.getByRole("button", { name: "复制" }).click();
  await expect(source.locator(".cp")).toHaveText(/已复制|已选中/);
});

test("换语言：跳到另一种语言的页面，带上锚点，记住选择", async ({ page }) => {
  await page.goto("./#faq");
  await page.locator(".lsw summary").click();
  await page.locator(".lsw-m").getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/#faq$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => localStorage.getItem("bettertavern.site.lang"))).toBe("en");

  // 记住了英文：再打开中文首页会跳到英文页；在英文页上选回中文就留在中文
  await page.goto("./");
  await expect(page).toHaveURL(/\/en\/$/);
  await page.locator(".lsw summary").click();
  await page.locator(".lsw-m").getByRole("link", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("给搜索引擎的文件：robots.txt 和不让收录的 404 页", async ({ page, request }) => {
  const robots = await request.get("robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("Disallow: /downloads/");

  await page.goto("404.html");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.getByRole("heading", { name: "找不到这个页面" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to home/ })).toBeVisible();
});

test.describe("浏览器是英文", () => {
  test.use({ locale: "en-US" });

  test("第一次打开首页跳到英文页，之后不再自动跳", async ({ page }) => {
    await page.goto("./#deploy");
    await expect(page).toHaveURL(/\/en\/#deploy$/);
    await page.goto("./");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
});

for (const p of PAGES) {
  for (const width of [320, 360, 390, 414, 600, 768, 900, 980, 1024, 1280, 1440]) {
    test(`${p.path} 宽 ${width} 没有横向滚动`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(p.path);
      await page.evaluate(() => document.fonts.ready);
      const { scroll, client, outside } = await page.evaluate(() => {
        const client = document.documentElement.clientWidth;
        // 页面外层把横向溢出裁掉了（斜切的色带要用），所以再看一遍有没有内容伸到窗口外面被裁掉；
        // 命令框和架构图的步骤标签本来就能横向滚动；部署里没轮到的几组命令排在窗口右边、被窗口裁掉，都不算
        const outside = [...document.querySelectorAll(".lp *")]
          .filter((el) => !el.closest(".code pre, .arc-steps, .codes-track > .code:not(.on)"))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > client + 0.5 || r.left < -0.5);
          })
          .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
        return { scroll: document.documentElement.scrollWidth, client, outside };
      });
      expect(scroll).toBeLessThanOrEqual(client);
      expect(outside).toEqual([]);
    });
  }
}

test.describe("不开 JS", () => {
  test.use({ javaScriptEnabled: false });

  test("看得到全部文字：演示第一段、常见问题的回答、四组部署命令", async ({ page }) => {
    await page.goto("./");
    await expect(page.locator(".dm .narr")).toContainText("身后响起一声钟");
    await expect(page.getByRole("button", { name: "A：先爬上灯塔，把灯点亮" })).toBeVisible();
    await expect(page.getByText("界面有中文、英文和日文")).toBeVisible();
    await expect(page.getByText("ALLOW_PRIVATE_ENDPOINTS=true")).toBeVisible();
    for (const cmd of ["docker compose -f deploy/docker-compose.yml up -d", "make worker", "make web", "cd apps/mobile && npm start"]) {
      await expect(page.locator(".code pre", { hasText: cmd }).first()).toBeVisible();
    }
  });

  test("英文、日文页也是完整的；中文首页不跳", async ({ page }) => {
    await page.goto("en/");
    await expect(page.locator(".dm .narr")).toContainText("Behind me a bell rang once");
    await expect(page.getByText("The interface is in Chinese, English and Japanese")).toBeVisible();
    await page.goto("ja/");
    await expect(page.getByText("画面は中国語・英語・日本語で")).toBeVisible();
    await expect(page.locator(".arc-cap")).toContainText("全体像");
  });
});
