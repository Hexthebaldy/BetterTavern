/**
 * 日文界面的冒烟测试（docs/i18n.md 第 3、5 节）：浏览器是日文时界面跟着用日文、<html lang> 是 ja；
 * 服务端的错误按错误码翻译；开局时把界面语言传给服务端；故事正文标上这一局的 lang，宋体用日文那一组；
 * 最后删除账户。完整的流程在 flow.spec.ts 里按中文跑，这里只看语言和字体相关的部分。
 */

import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CARD = fileURLToPath(new URL("./fixtures/card.json", import.meta.url));
const FAKE_LLM = "http://127.0.0.1:8021/v1";
const email = `e2e-ja-${Date.now()}@example.test`;
const password = "e2e-password-1";

test.use({ locale: "ja-JP" });

test("Japanese interface: errors, story language, and the Japanese serif", async ({ page }) => {
  // ---- 登录失败的说明按错误码翻译 ----
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "物語の続きへ" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("ja");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("メールアドレスまたはパスワードが正しくありません")).toBeVisible();

  // ---- 注册，一级导航是日文；界面的字体组是日文的 ----
  await page.goto("/register");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "登録", exact: true }).click();
  await expect(page).toHaveURL(/\/playthroughs$/);
  await expect(page.getByRole("heading", { name: "セーブはまだありません" })).toBeVisible();
  await expect(page).toHaveTitle("セーブ · BetterTavern");
  await expect(page.getByRole("link", { name: "シナリオ", exact: true }).first()).toBeVisible();
  const serif = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-serif").trim(),
  );
  expect(serif.startsWith('"Noto Serif JP"')).toBe(true);

  // ---- 添加假模型并设为导演 ----
  await page.goto("/models");
  await page.getByRole("button", { name: "モデルを追加" }).first().click();
  const add = page.getByRole("dialog", { name: "モデルを追加" });
  await add.getByRole("radio", { name: "カスタム互換エンドポイント" }).click();
  await add.getByLabel("API キー").fill("sk-e2e-0000-fake");
  await add.getByPlaceholder("https://example.com/v1").fill(FAKE_LLM);
  await add.getByRole("radio", { name: "fake-model" }).click();
  await add.getByRole("button", { name: "モデルを保存" }).click();
  await expect(page).toHaveURL(/\/models\/[^/]+$/);

  // ---- 导入角色卡，开局：请求里带上界面语言 ----
  await page.goto("/workbench");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "キャラクターカードを読み込む" }).first().click();
  await (await chooser).setFiles(CARD);
  await expect(page).toHaveURL(/\/workbench\/d\//);
  await page.getByRole("button", { name: "保存して物語を始める" }).click();
  await expect(page).toHaveURL(/\/scenario\/[^/]+$/);
  await page.getByPlaceholder("名前", { exact: true }).fill("朝霧湊");
  const started = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/v1/playthroughs",
  );
  await page.getByRole("button", { name: "物語を始める" }).click();
  expect((await started).postDataJSON()).toMatchObject({ language: "ja" });
  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByRole("toolbar", { name: "読書の操作" })).toBeVisible({ timeout: 30_000 });

  // ---- 正文段落标着这一局的 lang，宋体取日文那一组（等开场写完，取第一段叙述） ----
  const narrative = page.locator('p.narrative[lang="ja"]').first();
  await expect(narrative).toBeVisible({ timeout: 30_000 });
  const family = await narrative.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family.startsWith('"Noto Serif JP"')).toBe(true);

  // ---- 删除账户 ----
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "メインナビゲーション" }).locator("button[aria-haspopup=dialog]").click();
  await page.getByRole("dialog", { name: "アカウント" }).getByRole("button", { name: "アカウントを削除" }).click();
  const remove = page.getByRole("dialog", { name: "アカウントを削除", exact: true });
  await remove.getByLabel("確認のためパスワードを入力").fill(password);
  await remove.getByRole("button", { name: "アカウントを削除" }).click();
  const confirm = page.getByRole("dialog", { name: "アカウントを削除しますか？" });
  await confirm.getByRole("button", { name: "アカウントを削除" }).click();
  await expect(page).toHaveURL(/\/login/);
});
