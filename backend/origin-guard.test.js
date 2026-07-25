const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequireAllowedOrigin } = require("./origin-guard");

function makeReq(origin){ return { get: (name) => (name.toLowerCase() === "origin" ? origin : undefined) }; }
function makeRes(){
  const res = {
    statusCode: null, body: null,
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
  return res;
}
function safeErrorLike(res, status, error, message){ res.status(status).json({ error, message }); }

test("허용 목록에 있는 Origin은 통과한다", () => {
  const guard = createRequireAllowedOrigin({
    allowedOrigins: new Set(["https://mindhub.forblune.com"]),
    safeError: safeErrorLike
  });
  let nextCalled = false;
  const res = makeRes();
  guard(makeReq("https://mindhub.forblune.com"), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("허용 목록에 없는 Origin은 403 origin_not_allowed로 차단한다", () => {
  const guard = createRequireAllowedOrigin({
    allowedOrigins: new Set(["https://mindhub.forblune.com"]),
    safeError: safeErrorLike
  });
  let nextCalled = false;
  const res = makeRes();
  guard(makeReq("https://evil.example"), res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "origin_not_allowed");
});

test("Origin 헤더 자체가 없으면 차단한다(정적 파일 경로가 아니라 이 미들웨어를 쓰는 한)", () => {
  const guard = createRequireAllowedOrigin({
    allowedOrigins: new Set(["https://mindhub.forblune.com"]),
    safeError: safeErrorLike
  });
  let nextCalled = false;
  const res = makeRes();
  guard(makeReq(undefined), res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
