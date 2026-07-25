const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequireBetaAccess } = require("./beta-access");

function makeRes(){
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
  return res;
}

function safeErrorLike(res, status, error, message){
  res.status(status).json({ error, message });
}

test("승인된 사용자는 next()로 통과한다", async () => {
  let nextCalled = false;
  const requireBetaAccess = createRequireBetaAccess({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    timeoutMs: 1000,
    safeError: safeErrorLike,
    fetchImpl: async (url, opts) => {
      assert.match(url, /\/rest\/v1\/app_access_grants\?select=status&status=eq\.approved$/);
      assert.equal(opts.headers.Authorization, "Bearer good-token");
      return { ok: true, json: async () => [{ status: "approved" }] };
    }
  });
  const req = { authToken: "good-token" };
  const res = makeRes();
  await requireBetaAccess(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("미승인(행 없음) 사용자는 403 beta_access_required로 차단된다", async () => {
  let nextCalled = false;
  const requireBetaAccess = createRequireBetaAccess({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    timeoutMs: 1000,
    safeError: safeErrorLike,
    fetchImpl: async () => ({ ok: true, json: async () => [] })
  });
  const req = { authToken: "pending-user-token" };
  const res = makeRes();
  await requireBetaAccess(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "beta_access_required");
});

test("Supabase REST 오류 응답은 503 beta_access_unavailable로 안전하게 처리한다", async () => {
  let nextCalled = false;
  const requireBetaAccess = createRequireBetaAccess({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    timeoutMs: 1000,
    safeError: safeErrorLike,
    fetchImpl: async () => ({ ok: false, json: async () => ({}) })
  });
  const req = { authToken: "any-token" };
  const res = makeRes();
  await requireBetaAccess(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "beta_access_unavailable");
});

test("네트워크 오류(fetch throw)도 503으로 안전하게 처리한다", async () => {
  let nextCalled = false;
  const requireBetaAccess = createRequireBetaAccess({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    timeoutMs: 1000,
    safeError: safeErrorLike,
    fetchImpl: async () => { throw new Error("network down"); }
  });
  const req = { authToken: "any-token" };
  const res = makeRes();
  await requireBetaAccess(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "beta_access_unavailable");
});

test("타임아웃(AbortError)은 504로 처리한다", async () => {
  let nextCalled = false;
  const requireBetaAccess = createRequireBetaAccess({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    timeoutMs: 1000,
    safeError: safeErrorLike,
    fetchImpl: async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
  });
  const req = { authToken: "any-token" };
  const res = makeRes();
  await requireBetaAccess(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 504);
});
