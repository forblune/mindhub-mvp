const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHAT_SYSTEM_PROMPT,
  conversationMode,
  turnInstruction,
  chatTokenBudget,
  normalizeChatReply,
  isShortContext,
  directChatReply,
  hasRecentCrisis
} = require("./conversation-style");

test("대화 철학은 상담 인터뷰보다 자연스러운 답변을 우선한다", () => {
  assert.match(CHAT_SYSTEM_PROMPT, /상담 인터뷰어가 아니라/);
  assert.match(CHAT_SYSTEM_PROMPT, /일상 대화에서는 설명보다 반응이 먼저다/);
  assert.match(CHAT_SYSTEM_PROMPT, /모든 답을 질문으로 끝내지 않는다/);
  assert.match(CHAT_SYSTEM_PROMPT, /구버전 출력/);
  assert.match(CHAT_SYSTEM_PROMPT, /번호 목록을 생성하지 않는다/);
});

test("물음표만으로 작업형 답변으로 분류하지 않는다", () => {
  assert.equal(conversationMode("뭐해?"), "casual");
  assert.equal(conversationMode("오늘 비 와?"), "casual");
  assert.equal(conversationMode("안녕"), "casual");
  assert.equal(conversationMode("요즘 내가 제대로 하고 있는 건지 모르겠어"), "reflection");
  assert.equal(conversationMode("이 에러를 어떻게 고쳐?"), "task");
  assert.equal(conversationMode("다 끝내고 싶어"), "crisis");
  assert.equal(conversationMode("오늘 힘들었어"), "context");
});

test("직전 위기 대화에서 이어진 무기력은 짧은 안전 후속 확인으로 분류한다", () => {
  const history = [
    { role:"user", content:"요즘 죽고 싶다는 생각이 자주 들어" },
    { role:"assistant", content:"지금 혼자 있어?" },
    { role:"user", content:"아무것도 하기 싫고 사람 만나기도 싫어" }
  ];
  assert.equal(hasRecentCrisis(history), true);
  assert.equal(conversationMode(history[2].content, history), "safety_followup");
  assert.match(turnInstruction("safety_followup"), /연락처는 프론트 카드/);
});

test("짧은 일상말은 모델 호출 없이 자연스럽게 답할 수 있다", () => {
  assert.equal(directChatReply("뭐해?", "casual"), "너랑 얘기하고 있지. 넌 뭐 하다 왔어?");
  assert.equal(directChatReply("배고파", "casual"), "그럼 뭐 좀 먹자. 지금 당기는 거 있어?");
  assert.equal(directChatReply("오늘 비 와?", "casual"), "어디 기준으로 볼까? 지금 위치는 자동으로 알 수 없어.");
  assert.equal(directChatReply("오늘 힘들었어", "context"), "오늘 꽤 빡센 날이었나 보네. 무슨 일 있었어?");
  assert.match(directChatReply("죽고 싶어", "crisis"), /당장 스스로를 해칠 생각이나 준비/);
});

test("응답 성격별 토큰 예산은 절단을 피할 여유를 둔다", () => {
  assert.equal(chatTokenBudget("casual"), 180);
  assert.equal(chatTokenBudget("context"), 150);
  assert.equal(chatTokenBudget("reflection"), 260);
  assert.equal(chatTokenBudget("task"), 420);
  assert.equal(chatTokenBudget("crisis"), 160);
});

test("짧은 감정 표현은 일반론보다 실제 맥락을 먼저 묻는다", () => {
  assert.equal(isShortContext("오늘 힘들었어"), true);
  assert.equal(isShortContext("아무것도 하기 싫어"), true);
  assert.equal(isShortContext("힘들 때 대처 방법을 알려줘"), false);
  assert.match(turnInstruction("context"), /원인 분석/);
  assert.equal(
    normalizeChatReply("힘들다고 느낄 때는 보통 심호흡을 해보는 것이 좋아요.", "context", "오늘 힘들었어"),
    "오늘 꽤 빡센 날이었나 보네. 무슨 일 있었어?"
  );
});

test("상담형 목록과 장문을 비작업 답변에서 제거한다", () => {
  const verbose = [
    "지금은 많이 지친 상태처럼 보여.",
    "",
    "1. 최근 스트레스가 있었나요?",
    "2. 수면은 어떤가요?",
    "3. 식사는 잘 하나요?"
  ].join("\n");
  assert.equal(
    normalizeChatReply(verbose, "reflection", "요즘 내가 이상한 것 같아"),
    "지금은 많이 지친 상태처럼 보여."
  );
});

test("토큰 제한으로 잘린 마지막 단어를 사용자에게 노출하지 않는다", () => {
  assert.equal(
    normalizeChatReply(
      "배고프면 몸이 에너지를 필요로 하는 신호야. 뭔가 간단히 먹는 게 좋겠어. 다른",
      "casual",
      "배고파",
      "length"
    ),
    "배고프면 몸이 에너지를 필요로 하는 신호야. 뭔가 간단히 먹는 게 좋겠어."
  );
});

test("위기 답변의 연락처 중복은 안전 확인 문장으로 교체한다", () => {
  assert.equal(
    normalizeChatReply(
      "1. 119에 전화하세요.\n2. 109로 연락하세요.",
      "crisis",
      "죽고 싶어"
    ),
    "지금은 안전부터 확인할게. 혼자 있어? 그리고 당장 스스로를 해칠 생각이나 준비한 게 있어?"
  );
});
