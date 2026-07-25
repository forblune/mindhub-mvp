const test = require("node:test");
const assert = require("node:assert/strict");
const { makeRateLimiter } = require("./rate-limiter");

function makeReq(ip){ return { ip, socket:{} }; }
function makeRes(){
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value){ this.headers[name] = value; return this; },
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
  return res;
}

test("한도 이내 요청은 next()로 통과하고 RateLimit 헤더를 남긴다", () => {
  const limiter = makeRateLimiter({ windowMs:60_000, max:3 });
  let nextCalled = 0;
  const req = makeReq("1.1.1.1");
  const res = makeRes();
  limiter(req, res, () => { nextCalled++; });
  assert.equal(nextCalled, 1);
  assert.equal(res.statusCode, null);
  assert.equal(res.headers["RateLimit-Limit"], "3");
  assert.equal(res.headers["RateLimit-Remaining"], "2");
});

test("한도를 넘으면 429와 Retry-After를 반환하고 next()를 호출하지 않는다", () => {
  const limiter = makeRateLimiter({ windowMs:60_000, max:2 });
  const req = makeReq("2.2.2.2");
  let nextCalled = 0;
  for(let i = 0; i < 2; i++) limiter(req, makeRes(), () => { nextCalled++; });

  const res = makeRes();
  limiter(req, res, () => { nextCalled++; });

  assert.equal(nextCalled, 2, "한도를 넘은 3번째 호출은 next()를 부르면 안 된다");
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "too_many_requests");
  assert.ok(res.headers["Retry-After"]);
});

test("IP별로 독립된 한도를 적용한다", () => {
  const limiter = makeRateLimiter({ windowMs:60_000, max:1 });
  const resA1 = makeRes(); limiter(makeReq("A"), resA1, () => {});
  const resA2 = makeRes(); limiter(makeReq("A"), resA2, () => {});
  const resB1 = makeRes(); limiter(makeReq("B"), resB1, () => {});

  assert.equal(resA1.statusCode, null);
  assert.equal(resA2.statusCode, 429, "같은 IP의 2번째 요청은 막혀야 한다");
  assert.equal(resB1.statusCode, null, "다른 IP는 별도 한도를 가진다");
});

test("윈도우가 지나면 카운트가 초기화된다(주입된 시계로 확인)", () => {
  let time = 0;
  const limiter = makeRateLimiter({ windowMs:1000, max:1, now: () => time });
  const req = makeReq("C");

  const res1 = makeRes(); limiter(req, res1, () => {});
  assert.equal(res1.statusCode, null);

  const res2 = makeRes(); limiter(req, res2, () => {});
  assert.equal(res2.statusCode, 429, "윈도우 안에서는 여전히 막혀야 한다");

  time += 1001; // 윈도우 만료
  const res3 = makeRes(); limiter(req, res3, () => {});
  assert.equal(res3.statusCode, null, "윈도우가 지나면 다시 허용돼야 한다");
});

test("req.ip가 없으면 socket.remoteAddress로 폴백한다", () => {
  const limiter = makeRateLimiter({ windowMs:60_000, max:1 });
  const req = { socket:{ remoteAddress:"9.9.9.9" } };
  const res1 = makeRes(); limiter(req, res1, () => {});
  const res2 = makeRes(); limiter(req, res2, () => {});
  assert.equal(res1.statusCode, null);
  assert.equal(res2.statusCode, 429);
});
