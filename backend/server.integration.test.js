// server.js 전체를 실제 ephemeral 포트에 띄워 진짜 HTTP 요청으로 미들웨어 체인(Origin → 인증 →
// rate limit → 라우트)이 실제로 올바른 순서로 연결됐는지 확인한다. 로그인이 필요한 /chat·/extract는
// 실제 Supabase 네트워크 호출 없이 도달 가능한 앞단(Origin 차단, 인증 없음)까지만 검증하고,
// 로그인이 필요 없는 /adoption-consult·/adoption-inquiry·/health는 끝까지 검증한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("./server");

const ALLOWED_ORIGIN = "https://mindhub.forblune.com";

function withServer(fn){
  return async () => {
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try{
      await fn(base);
    }finally{
      await new Promise(resolve => server.close(resolve));
    }
  };
}

test("GET /health는 인증·Origin 없이도 200 ok", withServer(async (base) => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "ok");
}));

test("허용되지 않은 Origin에서 POST /chat·/extract는 인증 전에 403으로 차단된다", withServer(async (base) => {
  for(const path of ["/chat", "/extract"]){
    const r = await fetch(`${base}${path}`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", Origin:"https://evil.example" },
      body:"{}"
    });
    assert.equal(r.status, 403, `${path} disallowed origin`);
    const body = await r.json();
    assert.equal(body.error, "origin_not_allowed");
  }
}));

test("허용된 Origin이지만 인증 헤더가 없으면 /chat·/extract는 401", withServer(async (base) => {
  for(const path of ["/chat", "/extract"]){
    const r = await fetch(`${base}${path}`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", Origin: ALLOWED_ORIGIN },
      body:"{}"
    });
    assert.equal(r.status, 401, `${path} missing auth`);
    const body = await r.json();
    assert.equal(body.error, "login_required");
  }
}));

test("허용되지 않은 Origin에서는 /adoption-consult·/adoption-inquiry도 403", withServer(async (base) => {
  for(const path of ["/adoption-consult", "/adoption-inquiry"]){
    const r = await fetch(`${base}${path}`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", Origin:"https://evil.example" },
      body:"{}"
    });
    assert.equal(r.status, 403, path);
  }
}));

test("POST /adoption-consult: 필수값이 없으면 400, 있으면 200 + guided_fallback(테스트 환경엔 OPENAI_API_KEY 없음)", withServer(async (base) => {
  const missing = await fetch(`${base}/adoption-consult`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({})
  });
  assert.equal(missing.status, 400);

  const valid = await fetch(`${base}/adoption-consult`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({
      organization:"clinic", goal:"previsit", scale:"small", priority:"privacy",
      workflow:"진료 전 확인이 어렵습니다."
    })
  });
  assert.equal(valid.status, 200);
  const body = await valid.json();
  assert.equal(body.source, "guided_fallback");
  assert.match(body.reply, /적합도/);
}));

test("POST /adoption-inquiry: 유효한 입력이지만 메일 Secret이 없는 테스트 환경에서는 503 email_unavailable(거짓 성공 없음)", withServer(async (base) => {
  const r = await fetch(`${base}/adoption-inquiry`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({
      orgName:"포레스트 정신건강의학과", orgType:"clinic", contactName:"김도입",
      email:"contact@forest-clinic.example", purpose:"previsit", scale:"small",
      message:"진료 전 확인이 필요합니다.", consent:true
    })
  });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.error, "email_unavailable");
}));

test("POST /adoption-inquiry: honeypot이 채워지면 실제로는 아무것도 안 하면서 200으로 위장한다", withServer(async (base) => {
  const r = await fetch(`${base}/adoption-inquiry`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({ website:"http://spam.example" })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(body.requestId);
}));

test("32kb를 넘는 요청 본문은 413 body_too_large", withServer(async (base) => {
  const r = await fetch(`${base}/adoption-consult`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin: ALLOWED_ORIGIN },
    body: JSON.stringify({ workflow:"가".repeat(40_000) })
  });
  assert.equal(r.status, 413);
  const body = await r.json();
  assert.equal(body.error, "body_too_large");
}));

// 참고: rate limit 자체의 동작(한도 이내 통과, 초과 시 429, 키별 독립, 윈도우 만료)은
// rate-limiter.test.js에서 주입된 시계로 격리 테스트한다. 이 파일의 다른 테스트들이
// /adoption-inquiry를 여러 번 호출하며 server.js 모듈 전역의 inquiryLimiter 상태를 공유하기
// 때문에, 여기서 한도 소진까지 반복 요청하는 테스트를 추가하면 실행 순서에 따라 다른 테스트를
// 깨뜨릴 수 있어 의도적으로 두지 않았다. 실제 서버에서의 429 응답은 이번 작업 중 curl로도
// 직접 확인했다(docs/audit 참고).
