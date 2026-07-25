const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequireAuthenticatedUser } = require("./supabase-auth");

function makeReq(authorization){
  return { get: (name) => (name.toLowerCase() === "authorization" ? authorization : undefined) };
}
function makeRes(){
  const res = {
    statusCode: null, body: null,
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
  return res;
}
function safeErrorLike(res, status, error, message){ res.status(status).json({ error, message }); }

test("Authorization 헤더가 없으면 네트워크 호출 없이 401 login_required", async () => {
  let fetchCalled = false;
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon", timeoutMs:1000,
    safeError: safeErrorLike, fetchImpl: async () => { fetchCalled = true; }
  });
  const res = makeRes();
  await middleware(makeReq(undefined), res, () => {});
  assert.equal(fetchCalled, false, "토큰이 없으면 Supabase를 호출하면 안 된다");
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "login_required");
});

test("Bearer 형식이 아니면 401 login_required", async () => {
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon", timeoutMs:1000,
    safeError: safeErrorLike, fetchImpl: async () => { throw new Error("should not be called"); }
  });
  const res = makeRes();
  await middleware(makeReq("Basic abc123"), res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "login_required");
});

test("유효한 토큰이면 req.authUser/req.authToken을 채우고 next()로 통과한다", async () => {
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon-key", timeoutMs:1000,
    safeError: safeErrorLike,
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://x.supabase.co/auth/v1/user");
      assert.equal(opts.headers.apikey, "anon-key");
      assert.equal(opts.headers.Authorization, "Bearer good-token");
      return { ok:true, json: async () => ({ id:"user-123" }) };
    }
  });
  const req = makeReq("Bearer good-token");
  const res = makeRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.authUser.id, "user-123");
  assert.equal(req.authToken, "good-token");
});

test("Supabase가 세션을 거부하면(만료·위조 토큰) 401 invalid_session", async () => {
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon", timeoutMs:1000,
    safeError: safeErrorLike,
    fetchImpl: async () => ({ ok:false, json: async () => ({}) })
  });
  const res = makeRes();
  await middleware(makeReq("Bearer expired-token"), res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "invalid_session");
});

test("응답은 ok지만 user.id가 없으면 401 invalid_session", async () => {
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon", timeoutMs:1000,
    safeError: safeErrorLike,
    fetchImpl: async () => ({ ok:true, json: async () => ({}) })
  });
  const res = makeRes();
  await middleware(makeReq("Bearer weird-token"), res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "invalid_session");
});

test("Supabase 장애(네트워크 오류)는 401이 아니라 503 auth_unavailable로 안전하게 fail-closed", async () => {
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon", timeoutMs:1000,
    safeError: safeErrorLike,
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); }
  });
  const res = makeRes();
  let nextCalled = false;
  await middleware(makeReq("Bearer any-token"), res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, "인증 서비스 장애 시에는 요청을 통과시키면 안 된다(fail-closed)");
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "auth_unavailable");
});

test("Supabase 응답 지연(타임아웃)은 504로 처리한다", async () => {
  const middleware = createRequireAuthenticatedUser({
    supabaseUrl:"https://x.supabase.co", supabaseAnonKey:"anon", timeoutMs:1000,
    safeError: safeErrorLike,
    fetchImpl: async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
  });
  const res = makeRes();
  await middleware(makeReq("Bearer any-token"), res, () => {});
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.error, "auth_unavailable");
});
