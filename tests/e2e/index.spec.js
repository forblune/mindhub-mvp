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

  test("states current public availability and labels the patient app link as a private test login", async ({ page }) => {
    await page.goto("/index.html");

    const availability = page.locator("#availability");
    await expect(availability).toContainText("지금 공개된 것은 가상 데모뿐입니다");
    await expect(availability).toContainText("실제 환자용 AI 대화·기록 저장");
    await expect(availability).toContainText("신규 회원가입은 현재 받지 않습니다");

    // 실제 환자 앱으로 가는 모든 링크는 "비공개 테스트 로그인"이라고 명시돼야 한다(과도한 실사용 강조 금지).
    const appLinks = page.locator('a[href="app.html"]');
    await expect(appLinks).toHaveCount(3);
    for(const link of await appLinks.all()){
      await expect(link).toContainText("비공개 테스트 로그인");
    }

    // 최종 CTA는 가상 데모/의사 리포트/도입 상담을 우선 강조하고, 로그인은 마지막 보조 CTA로만 노출한다.
    const finalActions = page.locator(".final-actions");
    await expect(finalActions.locator("button.primary")).toContainText("가상 데모");
    await expect(finalActions.locator("a.secondary", { hasText: "비공개 테스트 로그인" })).toBeVisible();
  });

  test("keeps the restricted availability card visually distinct in both themes", async ({ page }) => {
    await page.goto("/index.html");

    // 다크 모드 일괄 배경 지정이 "제한됨" 카드의 muted 구분을 덮어쓰지 않아야 한다(브라우저 QA에서 발견한 회귀).
    const bg = () => page.evaluate(() => {
      const g = sel => getComputedStyle(document.querySelector(sel)).backgroundColor;
      return { open: g(".availability-card.open"), closed: g(".availability-card.closed"), body: getComputedStyle(document.body).backgroundColor };
    });

    const light = await bg();
    expect(light.closed).not.toBe(light.open);
    expect(light.closed).not.toBe(light.body);

    await page.locator(".theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const dark = await bg();
    expect(dark.closed).not.toBe(dark.open);
    expect(dark.closed).not.toBe(dark.body);
  });

  test("gives footer links a large enough tap target", async ({ page }) => {
    await page.goto("/index.html");

    // 푸터 링크는 문장 안 인라인 링크가 아니므로 WCAG 2.5.8(AA) 24px 최소 크기를 지켜야 한다.
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll(".footer-links a")].map(a => a.getBoundingClientRect().height)
    );
    expect(heights.length).toBeGreaterThan(0);
    for(const h of heights){
      expect(h).toBeGreaterThanOrEqual(24);
    }
  });

  test("runs the login-free scenario demo to a completed report", async ({ page }) => {
    await page.goto("/index.html");

    await page.getByRole("button", { name: /시나리오 실행/ }).click();

    await expect(page.locator("#reportReady")).toHaveText("리포트 완성", { timeout: 8_000 });
    await expect(page.locator("#triageDemo")).toBeVisible();
    await expect(page.locator("#safetyValue")).toContainText("위험 표현 1건");
    await expect(page.locator("#sleepValue")).toContainText("최근 수면 4시간");
    await expect(page.locator("#medValue")).toContainText("복약 1/2일");
    await expect(page.locator("#stressValue")).toContainText("직장 스트레스");
  });

  test("starts the login-free scenario from the hero call to action", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /로그인 없이 데모 보기/ }).click();

    await expect(page.locator("#reportReady")).toHaveText("리포트 완성", { timeout: 8_000 });
    await expect(page.locator("#demoStatus")).toContainText("완료");
    await expect(page.locator("#triageDemo")).toBeVisible();
  });

  test("resets the login-free scenario demo to its initial state", async ({ page }) => {
    await page.goto("/index.html");

    await page.getByRole("button", { name: /시나리오 실행/ }).click();
    await expect(page.locator("#reportReady")).toHaveText("리포트 완성", { timeout: 8_000 });

    const sleepRow = page.locator(".report-row[data-share='sleep']");
    const sleepToggle = sleepRow.locator(".share-toggle");
    await sleepToggle.click();
    await expect(sleepRow).toHaveClass(/off/);

    await page.getByRole("button", { name: "초기화" }).click();

    await expect(page.locator("#reportReady")).toHaveText("대기 중");
    await expect(page.locator("#reportReady")).not.toHaveClass(/on/);
    await expect(page.locator("#triageDemo")).not.toHaveClass(/on/);
    await expect(page.locator("#demoStatus")).toContainText("준비됨");
    await expect(page.locator("#demoChat")).toContainText("오늘 있었던 일이나 궁금한 것");
    await expect(sleepRow).not.toHaveClass(/off/);
    await expect(sleepToggle).toHaveText("공유 중");
    await expect(sleepToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#demoRun")).toHaveText("▶ 시나리오 실행");
    await expect(page.locator("#demoRun")).toBeEnabled();
  });

  test("opens and closes the adoption consultation modal without submitting", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ }).click();
    await expect(page.locator("#consultOverlay")).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("[role='dialog']")).toHaveAttribute("aria-describedby", "consultDesc");
    await expect(page.locator("#consultTitle")).toContainText("AI 도입 적합도 상담");
    await expect(page.locator("#consultDesc")).toContainText("첫 파일럿 범위");
    await expect(page.locator("#consultOrgName")).toBeVisible();
    await expect(page.locator("#consultOrganization")).toBeVisible();
    await expect(page.locator("#consultContactName")).toBeVisible();
    await expect(page.locator("#consultEmail")).toBeVisible();
    await expect(page.locator("#consultPhone")).toBeVisible();
    await expect(page.locator("#consultGoal")).toBeVisible();
    await expect(page.locator("#consultScale")).toBeVisible();
    await expect(page.locator("#consultPriority")).toBeVisible();
    await expect(page.locator("#consultTimeline")).toBeVisible();
    await expect(page.locator("#consultConsent")).toBeVisible();
    // honeypot 필드는 사람 사용자에게 보이지 않아야 한다(스팸 봇 함정).
    await expect(page.locator("#consultWebsite")).toBeHidden();

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
    await page.route("http://127.0.0.1:3100/adoption-inquiry", route => route.abort());
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ }).click();
    await page.locator("#consultOrgName").fill("포레스트 정신건강의학과");
    await page.locator("#consultOrganization").selectOption("clinic");
    await page.locator("#consultContactName").fill("김도입");
    await page.locator("#consultEmail").fill("contact@forest-clinic.example");
    await page.locator("#consultGoal").selectOption("previsit");
    await page.locator("#consultScale").selectOption("small");
    await page.locator("#consultPriority").selectOption("privacy");
    await page.locator("#consultWorkflow").fill("재진 환자의 최근 수면과 복약 변화를 진료 전에 빠르게 확인하고 싶습니다.");
    await page.locator("#consultConsent").check();
    await page.getByRole("button", { name: /도입 방향 확인하고 상담 요청 보내기/ }).click();

    await expect(page.locator("#consultResult")).toHaveClass(/on/);
    await expect(page.locator("#consultSource")).toHaveText("기본 도입 가이드");
    await expect(page.locator("#consultOutput")).toContainText("정신건강의학과 의원");
    await expect(page.locator("#consultOutput")).toContainText("진료 전 환자 변화 요약");
    await expect(page.locator("#consultOutput")).toContainText("개인정보·환자 통제");
    await expect(page.locator("#consultStatus")).toHaveClass(/err/);
    await expect(page.locator("#consultStatus")).toContainText("현재 요청을 보내지 못했습니다");
    await expect(page.locator("#consultSubmit")).toHaveText("도입 방향 다시 확인하고 상담 요청 다시 보내기");
    await expect(page.locator("#consultSubmit")).toBeEnabled();
  });

  test("shows a success status once the adoption inquiry email request succeeds", async ({ page }) => {
    await page.route("http://127.0.0.1:3100/adoption-consult", route => route.abort());
    await page.route("http://127.0.0.1:3100/adoption-inquiry", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, requestId: "test-request-id" })
    }));
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ }).click();
    await page.locator("#consultOrgName").fill("포레스트 정신건강의학과");
    await page.locator("#consultOrganization").selectOption("clinic");
    await page.locator("#consultContactName").fill("김도입");
    await page.locator("#consultEmail").fill("contact@forest-clinic.example");
    await page.locator("#consultGoal").selectOption("previsit");
    await page.locator("#consultScale").selectOption("small");
    await page.locator("#consultPriority").selectOption("privacy");
    await page.locator("#consultWorkflow").fill("재진 환자의 최근 수면과 복약 변화를 진료 전에 빠르게 확인하고 싶습니다.");
    await page.locator("#consultConsent").check();
    await page.getByRole("button", { name: /도입 방향 확인하고 상담 요청 보내기/ }).click();

    await expect(page.locator("#consultStatus")).toHaveClass(/ok/);
    await expect(page.locator("#consultStatus")).toContainText("도입 상담 요청을 보냈습니다");
  });

  test("blocks the adoption inquiry submission until an invalid work email is fixed", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator(".hero-actions").getByRole("button", { name: /기관 도입 상담/ }).click();
    await page.locator("#consultOrgName").fill("포레스트 정신건강의학과");
    await page.locator("#consultOrganization").selectOption("clinic");
    await page.locator("#consultContactName").fill("김도입");
    await page.locator("#consultEmail").fill("not-an-email");
    await page.locator("#consultGoal").selectOption("previsit");
    await page.locator("#consultScale").selectOption("small");
    await page.locator("#consultPriority").selectOption("privacy");
    await page.locator("#consultWorkflow").fill("재진 환자의 최근 수면과 복약 변화를 진료 전에 빠르게 확인하고 싶습니다.");
    await page.locator("#consultConsent").check();
    // 브라우저 자체의 type="email" 검증을 우회해 서버(자바스크립트) 쪽 형식 검사를 확인한다.
    await page.locator("#consultEmail").evaluate(el => el.setAttribute("type", "text"));
    await page.getByRole("button", { name: /도입 방향 확인하고 상담 요청 보내기/ }).click();

    await expect(page.locator("#consultResult")).not.toHaveClass(/(^|\s)on(\s|$)/);
    await expect(page.locator("#consultStatus")).toHaveClass(/err/);
    await expect(page.locator("#consultStatus")).toContainText("업무용 이메일 형식을 다시 확인해 주세요");
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
