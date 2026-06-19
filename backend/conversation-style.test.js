const test = require("node:test");
const assert = require("node:assert/strict");
const { CHAT_SYSTEM_PROMPT, chatTokenBudget } = require("./conversation-style");

test("대화 철학은 답변과 판단을 질문보다 우선한다", () => {
  assert.match(CHAT_SYSTEM_PROMPT, /질문보다 답변이 먼저다/);
  assert.match(CHAT_SYSTEM_PROMPT, /잠정적 판단/);
  assert.match(CHAT_SYSTEM_PROMPT, /모든 답을 질문으로 끝내지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /불확실성/);
});

test("상담사 상투어와 위기 예외를 함께 명시한다", () => {
  assert.match(CHAT_SYSTEM_PROMPT, /그렇게 느끼셨군요/);
  assert.match(CHAT_SYSTEM_PROMPT, /상담 매뉴얼 표현을 습관적으로 쓰지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /현재 안전을 우선한다/);
  assert.match(CHAT_SYSTEM_PROMPT, /혼자인지/);
});

test("응답 성격에 따라 토큰 예산을 배분한다", () => {
  assert.equal(chatTokenBudget("안녕"), 140);
  assert.equal(chatTokenBudget("요즘 내가 제대로 하고 있는 건지 모르겠어"), 220);
  assert.equal(chatTokenBudget("이 에러를 어떻게 고쳐?"), 360);
});

test("과잉 조언과 보고서체를 억제한다", () => {
  assert.match(CHAT_SYSTEM_PROMPT, /체크리스트, 점수 매기기, 해결 과제를 자동으로 붙이지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /긴 제목·표·구분선을 만들지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /대화 진행을 예고하지 않는다/);
});
