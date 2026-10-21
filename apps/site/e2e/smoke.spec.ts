/** 冒烟测试：打开页面，点演示的选项，展开常见问题，切部署标签；宽度从 320 到 1440 都没有横向滚动；不开 JS 也看得到文字 */

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

test("打开页面：预渲染的内容、页面信息、字体", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  await expect(page).toHaveTitle(/BetterTavern/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { level: 1, name: "BetterTavern" })).toBeVisible();

  const lead = (await page.locator(".hero .lead").textContent())?.trim();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", lead!);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", lead!);

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
  });
  expect(fonts).toContain("Noto Serif SC");
  expect(fonts).toContain("IBM Plex Mono");
  expect(errors).toEqual([]);
});

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

for (const width of [320, 360, 390, 414, 600, 768, 900, 980, 1024, 1280, 1440]) {
  test(`宽 ${width} 没有横向滚动`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    await page.evaluate(() => document.fonts.ready);
    const { scroll, client, outside } = await page.evaluate(() => {
      const client = document.documentElement.clientWidth;
      // 页面外层把横向溢出裁掉了（斜切的色带要用），所以再看一遍有没有内容伸到窗口外面被裁掉；命令框本来就能横向滚动，不算
      const outside = [...document.querySelectorAll(".lp *")]
        .filter((el) => !el.closest(".code pre"))
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
});
