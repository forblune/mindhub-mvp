const { test, expect } = require("@playwright/test");

test.describe("MindHub public landing page", () => {
  test("shows the product story and login-free entry points", async ({ page }) => {
    await page.goto("/index.html");

    await expect(page).toHaveTitle(/MindHub/);
    await expect(page.locator(".brand")).toContainText("MindHub");
    await expect(page.locator(".hero h1")).toContainText("진료 사이");
    await expect(page.locator(".hero h1")).toContainText("진료 전 10초");
    await expect(page.locator(".hero-actions").getByRole("button", { name: /로그인 없이 데모 보기/ })).toBeVisible();
    await expect(page.locator('a[href="doctor.html?demo=1"]').first()).toHaveText(/의사 리포트 체험|의사 화면/);
  });

  test("runs the login-free scenario demo to a completed report", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator("#demo").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /시나리오 실행/ }).click();

    await expect(page.locator("#reportReady")).toHaveText("리포트 완성", { timeout: 8_000 });
    await expect(page.locator("#triageDemo")).toBeVisible();
    await expect(page.locator("#safetyValue")).toContainText("위험 표현 1건");
    await expect(page.locator("#sleepValue")).toContainText("최근 수면 4시간");
    await expect(page.locator("#medValue")).toContainText("복약 1/2일");
    await expect(page.locator("#stressValue")).toContainText("직장 스트레스");
  });
});
