const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAdoptionInput,
  isValidAdoptionInput,
  buildAdoptionInput,
  fallbackAdoptionReply,
  extractResponseText
} = require("./adoption-consultation");

const valid = {
  organization:"clinic",
  goal:"previsit",
  scale:"small",
  priority:"privacy",
  workflow:"진료 전 환자의 최근 변화를 짧게 확인하고 싶습니다."
};

test("도입 상담 입력을 허용 목록과 길이로 제한한다", () => {
  const normalized = normalizeAdoptionInput({ ...valid, workflow:"가".repeat(900) });
  assert.equal(isValidAdoptionInput(normalized), true);
  assert.equal(normalized.workflow.length, 600);
  assert.equal(normalizeAdoptionInput({ ...valid, goal:"unknown" }).goal, "");
});

test("프롬프트에는 기관 조건만 포함하고 개인정보를 요구하지 않는다", () => {
  const input = buildAdoptionInput(normalizeAdoptionInput(valid));
  assert.match(input, /정신건강의학과 의원/);
  assert.match(input, /환자 개인정보를 추가로 요구하지 마라/);
});

test("API가 없어도 단계적인 파일럿 안내를 제공한다", () => {
  const reply = fallbackAdoptionReply(normalizeAdoptionInput(valid));
  assert.match(reply, /적합도/);
  assert.match(reply, /추천 파일럿/);
  assert.match(reply, /EMR 교체 없이/);
  assert.match(reply, /확정 판단이 아닙니다/);
});

test("Responses API의 편의 필드와 output 배열을 모두 읽는다", () => {
  assert.equal(extractResponseText({ output_text:"상담 결과" }), "상담 결과");
  assert.equal(extractResponseText({
    output:[{ content:[{ type:"output_text", text:"첫 문장" }, { type:"output_text", text:"둘째 문장" }] }]
  }), "첫 문장\n둘째 문장");
});
