/**
 * 一条完整的路：注册 → 刷新后还登录着（Cookie）→ 添加假模型 → 导入角色卡 → 编辑角色卡 → 开局 → 按 A 选选项 →
 * 按 / 自己写、Enter 发送 → 按 W 停靠世界状态 → 拖窄窗口看让位和滑出 → 按 ? 看快捷键 → 写结局 → 删除账户。
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
  // ---- 注册，刷新后仍然登录着 ----
  await page.goto("/register");
  await expect(page.getByLabel("邮箱")).toBeFocused();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(/\/playthroughs$/);
  await expect(page.getByRole("heading", { name: "还没有存档" })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).toBe("");
  await page.reload();
  await expect(page).toHaveURL(/\/playthroughs$/);

  // ---- 添加假模型并设为导演 ----
  await page.goto("/settings/models");
  await page.getByRole("radio", { name: "自定义兼容端点" }).click();
  await page.getByLabel("API Key").fill("sk-e2e-0000-fake");
  await page.getByPlaceholder("https://example.com/v1").fill(FAKE_LLM);
  await page.getByRole("radio", { name: "fake-model" }).click();
  await page.getByRole("button", { name: "保存模型" }).click();
  await expect(page).toHaveURL(/\/settings\/model\//);
  await expect(page.getByRole("link", { name: "模型" }).first()).toBeVisible();

  // ---- 导入角色卡，进剧本详情 ----
  await page.goto("/library");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入角色卡" }).first().click();
  await (await chooser).setFiles(CARD);
  await expect(page).toHaveURL(/\/scenario\//);
  await expect(page.getByRole("heading", { name: "沈知微" })).toBeVisible();

  // ---- 编辑角色卡：改描述、加一条世界书；没保存就离开会先问；空条目标红，改好马上恢复；保存后详情跟着变 ----
  await page.getByRole("button", { name: "编辑角色卡", exact: true }).click();
  await expect(page).toHaveURL(/\/scenario\/[^/]+\/edit$/);
  await page.getByLabel("描述").fill("{{char}} 是渡口的船娘，替人摆渡。");
  await page.getByRole("link", { name: "剧本", exact: true }).first().click();
  const discard = page.getByRole("dialog", { name: "放弃修改？" });
  await discard.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByRole("button", { name: "添加条目" }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("条目内容不能为空")).toBeVisible();
  await page.getByLabel("内容", { exact: true }).fill("子时才有最后一班船。");
  await expect(page.getByText("条目内容不能为空")).toHaveCount(0);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page).toHaveURL(/\/scenario\/[^/]+$/);
  await expect(page.getByText("沈知微 是渡口的船娘，替人摆渡。")).toBeVisible();
  await expect(page.getByText(/· 已编辑/)).toBeVisible();

  // ---- 开局，等开场写完、选项出来 ----
  await page.getByLabel("主角的名字").fill("林川");
  await page.getByRole("button", { name: "开始故事" }).click();
  await expect(page).toHaveURL(/\/play\//);
  const optionA = page.locator('button[aria-keyshortcuts="A"]');
  await expect(optionA).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(/^(?!●).* · BetterTavern$/);

  // ---- 按 A 只选中第一个选项（不发出），再按 Enter 发出：那一句作为“我的行动”出现，接着写出下一段 ----
  // 选项按钮里是字母键、读屏用的“A：”和选项文字，取最后那段文字（选中前取，选中后右端会多一段提示）
  const picked = await optionA.evaluate((el) => el.lastElementChild?.lastChild?.textContent?.trim() ?? "");
  expect(picked).not.toBe("");
  await page.keyboard.press("a");
  await expect(page.getByText("已选中 A，按 Enter 发出")).toBeAttached();
  await expect(page.locator("p", { hasText: `我的行动：${picked}` })).toHaveCount(0);
  await page.keyboard.press("Enter");
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

  // ---- 按 W：1440 宽时世界状态停靠在右边 ----
  await page.locator("body").click({ position: { x: 700, y: 120 } });
  await page.keyboard.press("w");
  const dock = page.locator('aside[aria-label="世界状态"]');
  await expect(dock).toBeVisible();
  await expect(page.locator("[data-nav]")).toHaveAttribute("data-nav", "sidebar");
  await noHorizontalScroll(page);

  // 1300：侧栏临时收成导航条，世界仍然停靠；1100：世界从右侧滑出，Esc 关闭
  await page.setViewportSize({ width: 1300, height: 900 });
  await expect(page.locator("[data-nav]")).toHaveAttribute("data-nav", "rail");
  await expect(dock).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await noHorizontalScroll(page);
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

  // ---- 删除账户：输入密码，再确认 ----
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "删除账户" }).first().click();
  await page.getByPlaceholder("输入密码确认").fill(password);
  await page.getByRole("button", { name: "删除账户" }).last().click();
  const confirm = page.getByRole("dialog", { name: "删除账户？" });
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await confirm.getByRole("button", { name: "删除账户" }).click();
  await expect(page).toHaveURL(/\/login/);
});
