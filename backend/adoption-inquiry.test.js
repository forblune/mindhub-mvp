const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeInquiryInput,
  isValidInquiryInput,
  isHoneypotTriggered,
  escapeHtml,
  buildInquiryEmail,
  createInquiryMailer,
  createDuplicateGuard
} = require("./adoption-inquiry");

const valid = {
  orgName: "포레스트 정신건강의학과",
  orgType: "clinic",
  contactName: "김도입",
  email: "contact@forest-clinic.example",
  phone: "02-1234-5678",
  purpose: "previsit",
  scale: "small",
  timeline: "2026년 3분기",
  message: "재진 환자의 최근 수면·복약 변화를 진료 전에 파악하고 싶습니다.",
  consent: true
};

test("필수 항목이 모두 있으면 유효하다", () => {
  const input = normalizeInquiryInput(valid);
  assert.equal(isValidInquiryInput(input), true);
});

test("필수 항목 중 하나라도 비면 유효하지 않다", () => {
  for(const key of ["orgName","orgType","contactName","email","purpose","scale","message"]){
    const input = normalizeInquiryInput({ ...valid, [key]: "" });
    assert.equal(isValidInquiryInput(input), false, `${key}가 없으면 무효해야 함`);
  }
});

test("개인정보 동의가 없으면 다른 값이 다 맞아도 무효하다", () => {
  const input = normalizeInquiryInput({ ...valid, consent: false });
  assert.equal(isValidInquiryInput(input), false);
});

test("허용 목록 밖의 기관 유형·목적·규모는 빈 값으로 정규화된다", () => {
  const input = normalizeInquiryInput({ ...valid, orgType: "hacker", purpose: "???", scale: "enterprise" });
  assert.equal(input.orgType, "");
  assert.equal(input.purpose, "");
  assert.equal(input.scale, "");
  assert.equal(isValidInquiryInput(input), false);
});

test("이메일 형식이 아니면 무효하다", () => {
  const input = normalizeInquiryInput({ ...valid, email: "not-an-email" });
  assert.equal(isValidInquiryInput(input), false);
});

test("필드 길이를 초과하면 조용히 잘라낸다(하드 리젝 아님)", () => {
  const input = normalizeInquiryInput({ ...valid, orgName: "가".repeat(500), message: "나".repeat(5000) });
  assert.equal(input.orgName.length, 100);
  assert.equal(input.message.length, 1000);
});

test("honeypot 필드(website)가 채워지면 봇으로 판단한다", () => {
  const bot = normalizeInquiryInput({ ...valid, website: "http://spam.example" });
  const human = normalizeInquiryInput(valid);
  assert.equal(isHoneypotTriggered(bot), true);
  assert.equal(isHoneypotTriggered(human), false);
});

test("개행 문자가 포함된 값도 한 줄로 정리된다(헤더 인젝션 대비)", () => {
  const input = normalizeInquiryInput({ ...valid, orgName: "정상기관\r\nBcc: attacker@evil.example" });
  assert.equal(input.orgName.includes("\n"), false);
  assert.equal(input.orgName.includes("\r"), false);
});

test("이메일 본문은 HTML 이스케이프되고 제목에는 개행이 없다", () => {
  const malicious = normalizeInquiryInput({
    ...valid,
    orgName: "<script>alert(1)</script>",
    contactName: "김입력\r\nX-Injected: evil",
    message: "안녕 <b>태그</b> & \"따옴표\""
  });
  const { subject, html } = buildInquiryEmail(malicious, { requestId:"r1", receivedAt:"2026-07-25T00:00:00Z" });
  assert.match(subject, /^\[MindHub 기관 도입 상담\]/);
  assert.equal(subject.includes("\n"), false);
  assert.equal(subject.includes("\r"), false);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;/);
});

test("escapeHtml은 5대 특수문자를 모두 이스케이프한다", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("메일 본문에는 request id와 동의 여부가 포함된다", () => {
  const input = normalizeInquiryInput(valid);
  const { text } = buildInquiryEmail(input, { requestId:"req-123", receivedAt:"2026-07-25T00:00:00Z" });
  assert.match(text, /req-123/);
  assert.match(text, /동의함/);
});

test("mailer: Secret이 없으면 발송을 시도하지 않고 not_configured를 반환한다", async () => {
  let called = false;
  const send = createInquiryMailer({
    apiKey: "", fromEmail: "from@example.com", toEmail: "to@example.com",
    fetchImpl: async () => { called = true; return { ok:true, json: async () => ({ id:"x" }) }; }
  });
  const result = await send({ subject:"s", html:"h", text:"t" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(called, false, "설정이 없으면 실제 네트워크 호출을 시도하면 안 된다");
});

test("mailer: Resend 성공 응답은 id를 함께 돌려준다", async () => {
  const send = createInquiryMailer({
    apiKey:"key", fromEmail:"from@example.com", toEmail:"to@example.com",
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(opts.headers.Authorization, "Bearer key");
      const body = JSON.parse(opts.body);
      assert.equal(body.to[0], "to@example.com");
      assert.equal(body.from, "from@example.com");
      return { ok:true, json: async () => ({ id:"resend-id-1" }) };
    }
  });
  const result = await send({ subject:"s", html:"h", text:"t", replyTo:"reply@example.com" });
  assert.equal(result.ok, true);
  assert.equal(result.id, "resend-id-1");
});

test("mailer: Resend 오류 응답은 provider_error로 안전하게 처리한다", async () => {
  const send = createInquiryMailer({
    apiKey:"key", fromEmail:"from@example.com", toEmail:"to@example.com",
    fetchImpl: async () => ({ ok:false, status:422, json: async () => ({ message:"bad" }) })
  });
  const result = await send({ subject:"s", html:"h", text:"t" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "provider_error");
  assert.equal(result.status, 422);
});

test("mailer: 타임아웃은 timeout 사유로 처리한다", async () => {
  const send = createInquiryMailer({
    apiKey:"key", fromEmail:"from@example.com", toEmail:"to@example.com",
    fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  });
  const result = await send({ subject:"s", html:"h", text:"t" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
});

test("duplicate guard: 같은 문의를 짧은 시간 안에 다시 보내면 같은 request id를 돌려준다", () => {
  const guard = createDuplicateGuard({ windowMs: 60_000 });
  const input = normalizeInquiryInput(valid);
  assert.equal(guard.check(input), null);
  guard.remember(input, "req-abc");
  assert.equal(guard.check(input), "req-abc");
});

test("duplicate guard: 다른 문의는 중복으로 취급하지 않는다", () => {
  const guard = createDuplicateGuard({ windowMs: 60_000 });
  const input = normalizeInquiryInput(valid);
  guard.remember(input, "req-abc");
  const different = normalizeInquiryInput({ ...valid, message: "완전히 다른 문의 내용입니다." });
  assert.equal(guard.check(different), null);
});

test("duplicate guard: 시간 창이 지나면 다시 새 요청으로 취급한다", () => {
  const guard = createDuplicateGuard({ windowMs: -1 });
  const input = normalizeInquiryInput(valid);
  guard.remember(input, "req-abc");
  assert.equal(guard.check(input), null);
});
