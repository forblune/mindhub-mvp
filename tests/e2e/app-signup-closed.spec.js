const { test, expect } = require("@playwright/test");

test.describe("MindHub app.html — closed-beta 회원가입 차단", () => {
  test("로그인 화면 기본값은 로그인 탭이고 실제 로그인 폼만 노출한다", async ({ page }) => {
    await page.goto("/app.html");

    await expect(page.locator("#loginView")).toBeVisible();
    await expect(page.locator("#tabLogin")).toHaveClass(/active/);
    await expect(page.locator("#tabSignup")).not.toHaveClass(/active/);
    await expect(page.locator("#loginFields")).toBeVisible();
    await expect(page.locator("#authEmail")).toBeVisible();
    await expect(page.locator("#authPw")).toBeVisible();
    await expect(page.locator("#signupClosedNotice")).toBeHidden();
  });

  test("회원가입 탭은 실제 가입 폼 대신 차단 안내만 보여준다", async ({ page }) => {
    await page.goto("/app.html");

    await page.locator("#tabSignup").click();

    await expect(page.locator("#tabSignup")).toHaveClass(/active/);
    await expect(page.locator("#loginFields")).toBeHidden();
    await expect(page.locator("#signupClosedNotice")).toBeVisible();
    await expect(page.locator("#signupClosedNotice")).toContainText("현재는 지정된 테스트 참여자만 이용할 수 있습니다.");

    // 회원가입 관련 입력 필드는 숨김이 아니라 아예 존재하지 않아야 한다(CSS로만 숨기는 방식 금지).
    await expect(page.locator("#authPw2")).toHaveCount(0);
    await expect(page.locator("#authHint")).toHaveCount(0);
  });

  test("회원가입 탭에서 다시 로그인 탭으로 돌아오면 로그인 폼이 복원된다", async ({ page }) => {
    await page.goto("/app.html");

    await page.locator("#tabSignup").click();
    await page.locator("#tabLogin").click();

    await expect(page.locator("#tabLogin")).toHaveClass(/active/);
    await expect(page.locator("#loginFields")).toBeVisible();
    await expect(page.locator("#signupClosedNotice")).toBeHidden();
  });

  test("이용 권한 없음 화면 마크업이 존재하고 기본적으로 숨겨져 있다", async ({ page }) => {
    await page.goto("/app.html");

    const denied = page.locator("#accessDeniedView");
    await expect(denied).toBeHidden();
    await expect(denied).toContainText("로그인은 확인됐지만 현재 테스트 이용 권한이 없습니다.");
  });
});
