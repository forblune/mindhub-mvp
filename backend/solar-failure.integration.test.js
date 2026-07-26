// Solar(Upstage) 장애 상황에서 백엔드가 안전하게 실패하는지 실제 HTTP로 검증한다.
// global fetch를 URL별로 스텁해 Supabase 인증·beta 권한은 통과시키고 Solar만 실패시킨다.
// 실제 Upstage 호출은 하지 않는다(과금·Hard Stop).
const test = require("node:test");
const assert = require("node:assert/strict");

const ALLOWED_ORIGIN = "https://mindhub.forblune.com";
const realFetch = global.fetch;

// beta-access.js·supabase-auth.js는 `fetchImpl = fetch` 기본 인자를 **모듈 생성 시점**에 평가해
// 그때의 global.fetch를 캡처한다. 따라서 나중에 global.fetch를 갈아끼워도 반영되지 않는다.
// 그래서 server.js를 require하기 전에 "가변 핸들러로 위임하는" 고정 스텁을 심고,
// 테스트마다 핸들러만 바꾼다. 이렇게 하면 실제 미들웨어 체인을 그대로 통과시킬 수 있다.
let solarBehavior = () => { throw new Error("solarBehavior not set"); };
global.fetch = async (url, opts) => {
  const u = String(url);
  if(u.includes("/auth/v1/user")){
    return { ok:true, json: async () => ({ id:"11111111-1111-1111-1111-111111111111" }) };
  }
  if(u.includes("/rest/v1/app_access_grants")){
    return { ok:true, json: async () => [{ status:"approved" }] };
  }
  if(u.includes("api.upstage.ai")){
    return solarBehavior(opts);
  }
  return realFetch(url, opts);
};

// server.js는 require 시점에 환경변수를 읽으므로, 로드 전에 세팅해야 한다.
process.env.UPSTAGE_API_KEY = "test-key-not-real";
process.env.SUPABASE_ANON_KEY = "test-anon-not-real";
const { app } = require("./server");

function stubFetch(behavior){ solarBehavior = behavior; }

function withServer(fn){
  return async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try { await fn(base); }
    finally {
      await new Promise(r => server.close(r));
    }
  };
}

function post(base, path, body){
  return fetch(`${base}${path}`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Origin: ALLOWED_ORIGIN,
      Authorization: "Bearer test-token"
    },
    body: JSON.stringify(body)
  });
}

const CHAT_BODY = { messages:[{ role:"user", content:"오늘은 좀 지치는 하루였어" }] };
const EXTRACT_BODY = { text:"어제 4시간밖에 못 잤어" };

test("Upstage 401(키 거부) → 502 ai_unavailable, 조작된 분석 결과 없음", withServer(async (base) => {
  stubFetch(() => ({ ok:false, status:401, text: async () => "invalid api key" }));
  for(const [path, body] of [["/chat", CHAT_BODY], ["/extract", EXTRACT_BODY]]){
    const r = await post(base, path, body);
    assert.equal(r.status, 502, `${path} on 401`);
    const j = await r.json();
    assert.equal(j.error, "ai_unavailable");
    assert.ok(!("reply" in j), "실패 시 답변을 만들어내면 안 된다");
    assert.ok(!("sleep_h" in j), "실패 시 임상 신호를 만들어내면 안 된다");
  }
}));

test("Upstage 429(rate limit) → 502 ai_unavailable", withServer(async (base) => {
  stubFetch(() => ({ ok:false, status:429, text: async () => "too many requests" }));
  const r = await post(base, "/chat", CHAT_BODY);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "ai_unavailable");
}));

test("Upstage 5xx → 502 ai_unavailable", withServer(async (base) => {
  stubFetch(() => ({ ok:false, status:503, text: async () => "upstream unavailable" }));
  const r = await post(base, "/extract", EXTRACT_BODY);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "ai_unavailable");
}));

test("Upstage 타임아웃(AbortError) → 504", withServer(async (base) => {
  stubFetch(() => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
  const r = await post(base, "/chat", CHAT_BODY);
  assert.equal(r.status, 504);
  assert.equal((await r.json()).error, "ai_unavailable");
}));

test("Upstage 네트워크 오류 → 500 ai_unavailable (스택·업스트림 원문 미노출)", withServer(async (base) => {
  stubFetch(() => { throw new Error("ECONNRESET at /internal/path/secret.js"); });
  const r = await post(base, "/chat", CHAT_BODY);
  assert.equal(r.status, 500);
  const body = await r.text();
  assert.match(body, /ai_unavailable/);
  assert.ok(!body.includes("ECONNRESET"), "업스트림 오류 원문을 클라이언트에 노출하면 안 된다");
  assert.ok(!body.includes("secret.js"), "내부 경로를 노출하면 안 된다");
}));

test("Solar가 형식이 깨진 응답을 줘도 /extract는 조작 없이 전부 null", withServer(async (base) => {
  stubFetch(() => ({ ok:true, json: async () => ({ nonsense:true }) }));
  const r = await post(base, "/extract", EXTRACT_BODY);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { sleep_h:null, med_taken:null, mood:null, stressor:null },
    "형식 불명 응답에서 값을 추측해 채우면 안 된다");
}));

test("Solar가 범위를 벗어난 값을 줘도 경계 검사로 걸러진다", withServer(async (base) => {
  stubFetch(() => ({ ok:true, json: async () => ({
    choices:[{ message:{ content: JSON.stringify({ sleep_h: 999, mood: 42, med_taken:"아마도", stressor: "가".repeat(500) }) } }]
  })}));
  const r = await post(base, "/extract", EXTRACT_BODY);
  const j = await r.json();
  assert.equal(j.sleep_h, null, "24시간 초과 수면은 버려야 한다");
  assert.equal(j.mood, null, "0~10 범위 밖 기분 점수는 버려야 한다");
  assert.equal(j.med_taken, null, "boolean이 아닌 복약 여부는 버려야 한다");
  assert.ok(j.stressor.length <= 80, "스트레스원은 길이 제한이 적용돼야 한다");
}));

test("요청한 모델명이 그대로 Upstage에 전달되고 몰래 다른 모델로 바뀌지 않는다", withServer(async (base) => {
  let sentModel = null;
  stubFetch((opts) => {
    sentModel = JSON.parse(opts.body).model;
    return { ok:true, json: async () => ({ choices:[{ message:{ content:"{}" } }] }) };
  });
  await post(base, "/extract", EXTRACT_BODY);
  assert.equal(sentModel, process.env.SOLAR_MODEL || "solar-pro3",
    "SOLAR_MODEL(없으면 기본 solar-pro3) 외의 모델로 대체 호출하면 안 된다");
}));
