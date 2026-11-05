/**
 * 更新横幅：notice.json 里有更新时间就显示，到点换成“正在更新”；关掉以后这一次不再显示，下一次还会显示；
 * 文件撤掉、读不懂时都不显示。
 */

import { expect, test } from "@playwright/test";

const MINUTE = 60_000;
const START = new Date("2026-11-06T05:50:00");

function clock(time: number): string {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

test("更新横幅跟着 notice.json 变化", async ({ page }) => {
  await page.clock.install({ time: START });
  let answer: { status: number; body?: string } = { status: 204 };
  await page.route("**/notice.json", (route) => route.fulfill(answer));
  const notice = (at: number) => ({
    status: 200,
    body: JSON.stringify({ kind: "update", at: new Date(at).toISOString() }),
  });
  const banner = page.getByRole("status").filter({ hasText: "连不上" });
  const nextCheck = () => page.clock.fastForward(MINUTE);

  // ---- 平时没有提示 ----
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(banner).toHaveCount(0);

  // ---- 更新前 10 分钟开始显示，写的是更新的时刻 ----
  const at = START.getTime() + 11 * MINUTE;
  answer = notice(at);
  await nextCheck();
  await expect(banner).toContainText(`${clock(at)} 更新`);

  // ---- 到点换成“正在更新” ----
  await page.clock.fastForward(10 * MINUTE);
  await nextCheck();
  await expect(banner).toContainText("正在更新");

  // ---- 文件撤掉就消失 ----
  answer = { status: 204 };
  await nextCheck();
  await expect(banner).toHaveCount(0);

  // ---- 关掉以后这一次不再显示 ----
  const next = START.getTime() + 60 * MINUTE;
  answer = notice(next);
  await nextCheck();
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "关闭" }).click();
  await expect(banner).toHaveCount(0);
  await nextCheck();
  await expect(banner).toHaveCount(0);

  // ---- 下一次更新还会显示 ----
  answer = notice(next + 60 * MINUTE);
  await nextCheck();
  await expect(banner).toBeVisible();

  // ---- 读不懂（自己部署的服务器上这个地址是网页）时不显示 ----
  answer = { status: 200, body: "<!doctype html>" };
  await nextCheck();
  await expect(banner).toHaveCount(0);
});
