/**
 * 英文界面的冒烟测试（docs/i18n.md 第 5 节）：浏览器是英文时界面跟着用英文；服务端的错误按错误码翻译；
 * 设置里切到中文、再切回来立刻生效；开局时把界面语言传给服务端（提示词用英文）；最后删除账户。
 * 完整的流程在 flow.spec.ts 里按中文跑，这里只看语言相关的部分。
 */

import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CARD = fileURLToPath(new URL("./fixtures/card.json", import.meta.url));
const FAKE_LLM = "http://127.0.0.1:8021/v1";
const email = `e2e-en-${Date.now()}@example.test`;
const password = "e2e-password-1";

test.use({ locale: "en-US" });

test("English interface: errors, language switch, and the story's prompt language", async ({ page }) => {
  // ---- 登录失败的说明按错误码翻译（服务端只给英文说明和错误码） ----
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Continue your story" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong email or password.")).toBeVisible();

  // ---- 注册，一级导航是英文 ----
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign up and sign in" }).click();
  await expect(page).toHaveURL(/\/playthroughs$/);
  await expect(page.getByRole("heading", { name: "No saves yet" })).toBeVisible();
  await expect(page).toHaveTitle("Saves · BetterTavern");
  await expect(page.getByRole("link", { name: "Library", exact: true }).first()).toBeVisible();

  // ---- 设置里切到中文，再切回跟随系统 ----
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Language/ }).click();
  const dialog = page.getByRole("dialog", { name: "Language" });
  await expect(dialog.getByText("System language: English")).toBeVisible();
  await dialog.getByRole("radio", { name: /中文/ }).click();
  await expect(page.getByRole("dialog", { name: "语言" })).toBeVisible();
  await expect(page).toHaveTitle("设置 · BetterTavern");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("zh-CN");
  await page
    .getByRole("dialog", { name: "语言" })
    .getByRole("radio", { name: /跟随系统/ })
    .click();
  await expect(page).toHaveTitle("Settings · BetterTavern");
  await page.keyboard.press("Escape");

  // ---- 添加假模型并设为导演 ----
  await page.goto("/settings/models");
  await page.getByRole("radio", { name: "Custom compatible endpoint" }).click();
  await page.getByLabel("API key").fill("sk-e2e-0000-fake");
  await page.getByPlaceholder("https://example.com/v1").fill(FAKE_LLM);
  await page.getByRole("radio", { name: "fake-model" }).click();
  await page.getByRole("button", { name: "Save model" }).click();
  await expect(page).toHaveURL(/\/settings\/model\//);

  // ---- 导入角色卡，开局：请求里带上界面语言 ----
  await page.goto("/library");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import character card" }).first().click();
  await (await chooser).setFiles(CARD);
  await expect(page.getByRole("button", { name: "Edit character card", exact: true })).toBeVisible();
  await page.getByPlaceholder("Name", { exact: true }).fill("Rowan");
  const started = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/v1/playthroughs",
  );
  await page.getByRole("button", { name: "Start the story" }).click();
  expect((await started).postDataJSON()).toMatchObject({ language: "en" });
  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByRole("toolbar", { name: "Reading actions" })).toBeVisible({ timeout: 30_000 });

  // ---- 删除账户 ----
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Delete account" }).first().click();
  await page.getByPlaceholder("Enter your password to confirm").fill(password);
  await page.getByRole("button", { name: "Delete account" }).last().click();
  const confirm = page.getByRole("dialog", { name: "Delete your account?" });
  await confirm.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/login/);
});
