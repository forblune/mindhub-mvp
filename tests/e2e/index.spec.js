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

  test("opens and closes the adoption consultation modal without submitting", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ }).click();
    await expect(page.locator("#consultOverlay")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("#consultTitle")).toContainText("AI 도입 적합도 상담");
    await expect(page.locator("#consultOrganization")).toBeVisible();
    await expect(page.locator("#consultGoal")).toBeVisible();
    await expect(page.locator("#consultScale")).toBeVisible();
    await expect(page.locator("#consultPriority")).toBeVisible();

    await page.getByRole("button", { name: "도입 상담 닫기" }).click();
    await expect(page.locator("#consultOverlay")).toHaveAttribute("aria-hidden", "true");
  });

  test("closes the adoption consultation modal with Escape", async ({ page }) => {
    await page.goto("/index.html");

    const consultButton = page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ });
    await consultButton.click();
    await expect(page.locator("#consultOverlay")).toHaveAttribute("aria-hidden", "false");

    await page.keyboard.press("Escape");

    await expect(page.locator("#consultOverlay")).toHaveAttribute("aria-hidden", "true");
    await expect(consultButton).toBeVisible();
  });

  test("generates a local adoption consultation guide when backend is unavailable", async ({ page }) => {
    await page.route("http://127.0.0.1:3100/adoption-consult", route => route.abort());
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ }).click();
    await page.locator("#consultOrganization").selectOption("clinic");
    await page.locator("#consultGoal").selectOption("previsit");
    await page.locator("#consultScale").selectOption("small");
    await page.locator("#consultPriority").selectOption("privacy");
    await page.locator("#consultWorkflow").fill("재진 환자의 최근 수면과 복약 변화를 진료 전에 빠르게 확인하고 싶습니다.");
    await page.getByRole("button", { name: /도입 방향 확인하기/ }).click();

    await expect(page.locator("#consultResult")).toHaveClass(/on/);
    await expect(page.locator("#consultSource")).toHaveText("기본 도입 가이드");
    await expect(page.locator("#consultOutput")).toContainText("정신건강의학과 의원");
    await expect(page.locator("#consultOutput")).toContainText("진료 전 환자 변화 요약");
    await expect(page.locator("#consultOutput")).toContainText("개인정보·환자 통제");
    await expect(page.locator("#consultSubmit")).toHaveText("도입 방향 다시 확인하기");
    await expect(page.locator("#consultSubmit")).toBeEnabled();
  });

  test("persists the selected theme on reload", async ({ page }) => {
    await page.goto("/index.html");

    const currentTheme = await page.locator("html").getAttribute("data-theme");
    const expectedTheme = currentTheme === "dark" ? "light" : "dark";
    await page.locator(".theme-toggle").click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);
    await expect(page.locator(".theme-toggle")).toHaveAttribute("aria-pressed", expectedTheme === "dark" ? "true" : "false");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);
    await expect(page.locator(".theme-toggle")).toHaveAttribute("aria-pressed", expectedTheme === "dark" ? "true" : "false");
  });

  test("opens the doctor demo from the landing page link", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator(".final-actions a[href='doctor.html?demo=1']").click();

    await expect(page).toHaveURL(/doctor\.html\?demo=1$/);
    await expect(page.locator("#dhdr")).toContainText("의사 대시보드");
    await expect(page.locator("#dinner")).toContainText("강하늘 (가상)");
  });

  test("toggles report sharing controls in the login-free demo", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("#demo").scrollIntoViewIfNeeded();

    const sleepRow = page.locator(".report-row[data-share='sleep']");
    const sleepToggle = sleepRow.locator(".share-toggle");

    await sleepToggle.click();
    await expect(sleepRow).toHaveClass(/off/);
    await expect(sleepToggle).toHaveText("비공개");
    await expect(sleepToggle).toHaveAttribute("aria-pressed", "true");

    await sleepToggle.click();
    await expect(sleepRow).not.toHaveClass(/off/);
    await expect(sleepToggle).toHaveText("공유 중");
    await expect(sleepToggle).toHaveAttribute("aria-pressed", "false");
  });
});
