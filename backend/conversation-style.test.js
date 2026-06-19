const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHAT_SYSTEM_PROMPT,
  conversationMode,
  turnInstruction,
  chatTokenBudget,
  normalizeChatReply
} = require("./conversation-style");

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
  assert.equal(conversationMode("안녕"), "casual");
  assert.equal(conversationMode("요즘 내가 제대로 하고 있는 건지 모르겠어"), "reflection");
  assert.equal(conversationMode("이 에러를 어떻게 고쳐?"), "task");
  assert.equal(conversationMode("다 끝내고 싶어"), "crisis");
  assert.equal(chatTokenBudget("casual"), 120);
  assert.equal(chatTokenBudget("reflection"), 180);
  assert.equal(chatTokenBudget("task"), 360);
  assert.equal(chatTokenBudget("crisis"), 120);
});

test("과잉 조언과 보고서체를 억제한다", () => {
  assert.match(CHAT_SYSTEM_PROMPT, /체크리스트, 점수 매기기, 해결 과제를 자동으로 붙이지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /긴 제목·표·구분선을 만들지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /대화 진행을 예고하지 않는다/);
});

test("턴별 지시와 고민형 출력 가드레일을 적용한다", () => {
  assert.match(turnInstruction("reflection"), /추가 조언/);
  assert.match(turnInstruction("task"), /결론과 가장 유력한 원인/);
  assert.match(turnInstruction("crisis"), /위기 안전 확인/);
  const reply = [
    "지금 말만 놓고 보면 우선순위가 분산된 쪽에 가까워 보여. 바쁜 것과 진전은 다르니까 구분할 필요는 있어.",
    "",
    "예를 들어 오늘 한 일을 점수로 매겨봐. 필요하면 같이 정리해줄게."
  ].join("\n");
  assert.equal(
    normalizeChatReply(reply, "reflection"),
    "지금 말만 놓고 보면 우선순위가 분산된 쪽에 가까워 보여. 바쁜 것과 진전은 다르니까 구분할 필요는 있어."
  );
  assert.equal(normalizeChatReply(reply, "task"), reply.trim());
});
