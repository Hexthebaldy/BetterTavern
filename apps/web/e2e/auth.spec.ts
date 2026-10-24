/**
 * 登录这几页（docs/design/comic 的“登录页”一节）：左格的桌面没有字、读屏看不到；找回密码走到填验证码那一步，
 * 6 格验证码能输入、粘贴，只留数字；验证页的邮箱和“换一个邮箱”；服务器切换的对话框（这里不是官方网站，所以有服务器行）；
 * 窄屏只剩表单。注册、登录的整条路在 flow.spec.ts 里。
 */

import { expect, test } from "@playwright/test";

const email = `e2e-auth-${Date.now()}@example.test`;

test("登录、找回密码、验证邮箱的版式和服务器切换", async ({ page }) => {
  // ---- 左格的桌面：没有字，整格对读屏隐藏 ----
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "继续你的故事" })).toBeVisible();
  const desk = page.locator('[aria-hidden="true"]:has(> svg)').first();
  await expect(desk).toBeVisible();
  expect((await desk.innerText()).trim()).toBe("");
  await expect(desk.locator("text, image, img, foreignObject")).toHaveCount(0);

  // ---- 服务器行：不认的地址提示出错，Esc 关掉 ----
  await page.getByRole("button", { name: /^服务器 .+，更改$/ }).click();
  const dialog = page.getByRole("dialog", { name: "换一个服务器" });
  await dialog.getByLabel("新服务器地址").fill("javascript:alert(1)");
  await dialog.getByLabel("新服务器地址").press("Enter");
  await expect(dialog.getByText("地址不对")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // ---- 找回密码：从登录页带着邮箱过去，发验证码以后是 6 格验证码 ----
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(/\/forgot$/);
  await expect(page.getByLabel("邮箱")).toHaveValue(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  const code = page.getByLabel("验证码");
  await expect(code).toBeFocused();
  await code.fill("12a3456789");
  await expect(code).toHaveValue("123456");
  await page.getByLabel("新密码").fill("short");
  await expect(page.getByRole("button", { name: "设置并登录" })).toBeDisabled();
  await page.getByRole("button", { name: "换一个邮箱" }).click();
  await expect(page.getByRole("heading", { name: "找回密码" })).toBeVisible();
  await page.getByRole("link", { name: "返回登录" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // ---- 验证邮箱：邮箱在标题下面，“换一个邮箱”回注册页 ----
  await page.evaluate((address) => {
    window.history.replaceState({ usr: { email: address }, key: "e2e", idx: 0 }, "", "/verify");
  }, email);
  await page.reload();
  await expect(page.getByRole("heading", { name: "验证邮箱" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("15 分钟内有效")).toBeVisible();
  await expect(page.getByRole("button", { name: "验证并登录" })).toBeDisabled();
  await page.getByLabel("验证码").fill("654321");
  await expect(page.getByRole("button", { name: "验证并登录" })).toBeEnabled();
  await page.getByRole("link", { name: "换一个邮箱" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "创建账户" })).toBeVisible();

  // ---- 窄屏只剩表单 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(desk).toBeHidden();
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
