const { test, expect } = require("@playwright/test");

test.describe("MindHub doctor demo dashboard", () => {
  test("renders the login-free virtual patient report", async ({ page }) => {
    await page.goto("/doctor.html?demo=1");

    await expect(page.locator("#dhdr")).toContainText("의사 대시보드");
    await expect(page.locator("#plist")).toContainText("강하늘 (가상)");

    const report = page.locator("#dinner");
    await expect(report).toContainText("강하늘 (가상)");
    await expect(report).toContainText("진료 전 우선 확인");
    await expect(report).toContainText("자동 트리아지");
    await expect(report).toContainText("위험 표현이 있어");
    await expect(report).toContainText("평균 수면 4.3h");
    await expect(report).toContainText("복약 누락 1건");
    await expect(report).toContainText("최근 기분 점수가 1/10");
    await expect(report).toContainText("진단이나 응급 알림이 아니라");
  });
});
