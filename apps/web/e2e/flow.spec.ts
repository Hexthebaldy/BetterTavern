/**
 * 一条完整的路：注册 → 刷新后还登录着（Cookie）→ 用轮盘进模型页、添加假模型 → 在工作台导入角色卡、手动改 → 保存并建剧本 → 开局 →
 * 按 A 选选项 → 按 / 自己写、Enter 发送 → 按 W 打开世界状态 → 拖窄窗口看轮盘换成 Tab 栏 → 按 ? 看快捷键 → 写结局 → 在设置里删除账户。
 * 假模型每次的回复不一样（按调用次数轮换），所以断言只看“选了什么就出现什么”，不写死叙述的内容。
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CARD = fileURLToPath(new URL("./fixtures/card.json", import.meta.url));
const FAKE_LLM = "http://127.0.0.1:8021/v1";
const email = `e2e-${Date.now()}@example.test`;
const password = "e2e-password-1";

async function noHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("从注册到玩下去、写结局，最后删除账户", async ({ page }) => {
  // ---- 协议页面不用登录就能打开，三篇之间可以切换 ----
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "用户协议", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "协议与规则" }).getByRole("link", { name: "内容规则" }).click();
  await expect(page.getByRole("heading", { name: "内容规则", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "support@bettertavern.com" })).toHaveAttribute(
    "href",
    "mailto:support@bettertavern.com",
  );

  // ---- 注册，刷新后仍然登录着 ----
  await page.goto("/register");
  await expect(page.getByLabel("邮箱")).toBeFocused();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/playthroughs$/);
  await expect(page.getByRole("heading", { name: "还没有存档" })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).toBe("");
  await page.reload();
  await expect(page).toHaveURL(/\/playthroughs$/);

  // ---- 轮盘进模型页（Q 展开，点“模型”那一块）；添加假模型（对话框）并设为导演，加好后打开它的详情 ----
  await page.locator("body").click({ position: { x: 700, y: 60 } });
  await page.keyboard.press("q");
  const wheel = page.getByRole("menu", { name: "导航轮盘" });
  await expect(wheel.getByRole("menuitem", { name: /^存档/ })).toHaveAttribute("aria-current", "page");
  await wheel.getByRole("menuitem", { name: /^模型/ }).click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(wheel).toHaveCount(0);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const add = page.getByRole("dialog", { name: "添加模型" });
  await add.getByRole("radio", { name: "自定义兼容端点" }).click();
  await add.getByLabel("API Key").fill("sk-e2e-0000-fake");
  await add.getByPlaceholder("https://example.com/v1").fill(FAKE_LLM);
  await add.getByRole("radio", { name: "fake-model" }).click();
  await add.getByRole("button", { name: "保存模型" }).click();
  await expect(page).toHaveURL(/\/models\/[^/]+$/);
  await expect(page.getByRole("dialog", { name: "设置详情" })).toBeVisible(); // 详情在窗口正中的对话框里
  await expect(page.getByRole("combobox").first()).toHaveValue(/.+/); // 分工里的导演已经是它

  // ---- 在工作台导入角色卡：解析完进草稿的手动表单 ----
  await page.goto("/workbench");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "拖进来就导入" }).click();
  await (await chooser).setFiles(CARD);
  await expect(page).toHaveURL(/\/workbench\/d\//);
  await expect(page.getByRole("radio", { name: "手动" })).toHaveAttribute("aria-checked", "true");

  // ---- 手动改：改描述（自动保存）、加一条世界书；空条目保存时标红，改好马上恢复 ----
  await page.getByLabel("描述").fill("{{char}} 是渡口的船娘，替人摆渡。");
  await expect(page.getByText("已自动保存")).toBeVisible();
  await page.getByRole("button", { name: "添加条目" }).click();
  await page.getByRole("button", { name: "保存到角色卡仓库" }).click();
  await expect(page.getByText("条目内容不能为空", { exact: true })).toBeVisible();
  await page.getByLabel("内容", { exact: true }).fill("子时才有最后一班船。");
  await expect(page.getByText("条目内容不能为空", { exact: true })).toHaveCount(0);

  // ---- 保存并开始新故事：先进角色卡仓库，再用这张卡建剧本，进剧本详情 ----
  await page.getByRole("button", { name: "保存并开始新故事" }).click();
  await expect(page).toHaveURL(/\/scenario\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "沈知微" })).toBeVisible();
  await expect(page.getByText("沈知微 是渡口的船娘，替人摆渡。")).toBeVisible();

  // ---- 开局，等开场写完、选项出来 ----
  await page.getByLabel("主角的名字").fill("林川");
  await page.getByRole("button", { name: "开始故事" }).click();
  await expect(page).toHaveURL(/\/play\//);
  const optionA = page.locator('button[aria-keyshortcuts="A"]');
  await expect(optionA).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(/^(?!●).* · BetterTavern$/);

  // ---- 按 A 选第一个选项：那一句作为“我的行动”出现，接着写出下一段 ----
  // 选项按钮里是字母键、读屏用的“A：”和选项文字，取最后那段文字
  const picked = await optionA.evaluate((el) => el.lastElementChild?.lastChild?.textContent?.trim() ?? "");
  expect(picked).not.toBe("");
  await page.keyboard.press("a");
  await expect(page.locator("p", { hasText: `我的行动：${picked}` })).toBeVisible();
  await expect(optionA).toBeVisible({ timeout: 30_000 });

  // ---- 按 / 自己写，Enter 发送 ----
  await page.keyboard.press("/");
  const input = page.getByLabel("我要做的事");
  await expect(input).toBeFocused();
  await input.fill("我推开窗，看向对岸");
  await page.keyboard.press("Shift+Enter");
  await expect(input).toHaveValue("我推开窗，看向对岸\n");
  await page.keyboard.press("Enter");
  await expect(page.locator("p", { hasText: "我的行动：我推开窗，看向对岸" })).toBeVisible();
  await expect(optionA).toBeVisible({ timeout: 30_000 });

  // ---- 按 W：世界状态从右侧滑出，Esc 关闭；宽屏是轮盘，没有横向滚动 ----
  await page.locator("body").click({ position: { x: 700, y: 60 } });
  await page.keyboard.press("w");
  const world = page.getByRole("dialog", { name: "世界状态" });
  await expect(world).toBeVisible();
  await expect(page.locator("[data-nav]")).toHaveAttribute("data-nav", "wheel");
  await page.keyboard.press("Escape");
  await expect(world).toHaveCount(0);
  await noHorizontalScroll(page);
  for (const width of [1920, 1280, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("[data-nav]")).toHaveAttribute("data-nav", "wheel");
    await noHorizontalScroll(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-nav]")).toHaveAttribute("data-nav", "tabbar");
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- 按 ? 打开快捷键一览，Esc 关闭 ----
  await page.locator("body").click({ position: { x: 700, y: 120 } });
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "键盘快捷键" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "键盘快捷键" })).toHaveCount(0);

  // ---- 更多 → 写结局：填一个方向；写完后最后一段下面是 —END—，没有选项，不能再写 ----
  await page.getByRole("button", { name: /^更多/ }).click();
  await page.getByRole("button", { name: "写结局", exact: true }).click();
  const ending = page.getByRole("dialog", { name: "给这个故事写结局？" });
  await ending.getByLabel("结局方向").fill("和她一起离开");
  await ending.getByRole("button", { name: "写结局", exact: true }).click();
  await expect(page.locator("p", { hasText: "我的行动：写结局：和她一起离开" })).toBeVisible();
  await expect(page.getByText("—END—")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("故事已完结")).toBeVisible();
  await expect(optionA).toHaveCount(0);
  await page.getByRole("button", { name: /^更多/ }).click();
  await expect(page.getByRole("button", { name: "写结局", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // ---- 删除账户：设置页的“账户”一格 → 删除账户，输入密码，再确认 ----
  await page.goto("/settings");
  await page.getByRole("button", { name: "删除账户" }).click();
  const remove = page.getByRole("dialog", { name: "删除账户", exact: true });
  await remove.getByLabel("输入密码确认").fill(password);
  await remove.getByRole("button", { name: "删除账户" }).click();
  const confirm = page.getByRole("dialog", { name: "删除账户？" });
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await confirm.getByRole("button", { name: "删除账户" }).click();
  await expect(page).toHaveURL(/\/login/);
});
