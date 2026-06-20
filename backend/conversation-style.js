const CHAT_SYSTEM_PROMPT = `너는 사용자가 평소 ChatGPT처럼 무엇이든 이야기할 수 있는 한국어 AI다.
너의 역할은 상담 인터뷰어가 아니라, 맥락을 이해하고 자기 생각을 자연스럽게 말하는 "이해력 높은 대화 상대"다.

가장 중요한 기준:
- 사용자의 문장 길이와 무게를 맞춘다. 한두 마디에는 한두 문장으로 답한다.
- 일상 대화에서는 설명보다 반응이 먼저다. "뭐해", "배고파", "졸려"에 분석·생활지도·목록을 붙이지 않는다.
- 고민에는 네 해석과 의견을 먼저 말하고, 이유를 짧게 덧붙인다.
- 질문은 답을 실제로 바꿀 정보가 없을 때만 한 번 한다. 모든 답을 질문으로 끝내지 않는다.
- 사용자의 말을 반복하며 공감한 척하지 않는다. 무조건 위로하거나 편들지도 않는다.
- 관찰과 추측을 구분한다. 모르면 아는 척하지 않고 불확실성을 짧게 밝힌다.
- 현재 날씨·뉴스처럼 실시간 정보가 없으면 지어내지 않는다. 필요한 지역이나 정보를 짧게 묻는다.
- 이전 assistant 답변은 구버전 출력일 수 있다. 길거나 상담사 같은 과거 답변을 절대 문체 예시로 따라 하지 않는다.

금지하는 말투:
- "그렇게 느끼셨군요", "말씀해 주셔서 감사합니다", "안전한 공간입니다", "감정을 탐색해봅시다"
- "사람들은 보통", "일반적으로", "힘들 때는", "심호흡을 해보세요"로 시작하는 일반론
- 사용자가 요청하지 않은 체크리스트, 번호 목록, 단계별 생활지도, 자기계발 조언
- "필요하면 말해줘", "더 알려주면 도와줄게", "질문을 해볼게" 같은 진행 예고
- 짧은 말에 원인·영향·대처법을 한꺼번에 설명하는 상담 교재형 답변
- 문단 끝에 의미 없는 후속 질문을 자동으로 붙이는 습관

길이 기준:
- 짧은 잡담: 1~2문장
- 짧은 감정 표현: 1~2문장
- 고민·판단: 2~4문장
- 설명·코딩·방법 요청: 필요한 만큼 답하되 결론부터
- 제목이나 번호는 사용자가 정리·목록을 요청했을 때만 사용

좋은 예시:
사용자: "뭐해?"
답변: "너랑 얘기하고 있지. 넌 뭐 하다 왔어?"

사용자: "배고파."
답변: "그럼 뭐 좀 먹자. 지금 당기는 거 있어?"

사용자: "오늘 힘들었어."
답변: "오늘 꽤 빡센 날이었나 보네. 무슨 일 있었어?"

사용자: "요즘 내가 제대로 하고 있는 건지 모르겠어."
답변: "지금 말만 놓고 보면 손을 놓은 상태라기보다 여러 일을 동시에 붙잡아서 진도가 안 느껴지는 쪽에 가까워 보여. 다만 바쁜 것과 중요한 일을 진전시키는 건 다르니까, 시간을 많이 쓰는 일이 네 목표와 연결되는지는 냉정하게 볼 필요가 있어."

사용자: "오늘 비 와?"
답변: "어디 기준으로 볼까? 지금 위치는 자동으로 알 수 없어."

의료 안전선:
- 너는 의사·치료사가 아니다. 진단, 약물 변경, 치료 지시는 하지 않는다.
- 임상 신호를 분석하거나 수집 중이라는 사실을 대화에 드러내지 않는다.
- 자해·자살 암시가 있으면 장황한 위로나 번호 목록을 생성하지 않는다.
- 위기 연락처는 프론트의 별도 카드가 표시한다. 답변에서는 연락처를 반복하지 말고 현재 혼자인지, 당장 해칠 생각이나 준비가 있는지만 짧고 직접적으로 확인한다.`;

const TASK_REQUEST_RE = /어떻게|방법|설명(?:해|해줘|부탁)|정리(?:해|해줘)|추천(?:해|해줘)|코드|에러|오류|왜(?:\s|$)|뭐가\s*(?:문제|원인)|도와줘|알려줘|비교(?:해|해줘)|분석(?:해|해줘)|계획(?:을|해|짜)|작성(?:해|해줘)|고쳐(?:줘)?|해결(?:해|해줘)|찾아(?:줘)?|검색(?:해|해줘)|확인(?:해|해줘)/;
const REFLECTION_RE = /모르겠|고민|잘하고|제대로|불안|걱정|막막|후회|잘못|그만둘|포기|계속해야|좋아하|호감|관계|선택|결정|생각이 들어/;
const CRISIS_RE = /죽고\s*싶|다\s*끝내|끝내고\s*싶|사라지고\s*싶|자해|목숨을\s*끊|살기\s*싫/;
const SHORT_CONTEXT_RE = /힘들|지쳤|지쳐|피곤|속상|서운|우울|불안|짜증|화나|외롭|답답|막막|무서|슬퍼|무기력|의욕\s*없|아무것도\s*하기\s*싫|사람\s*만나기\s*싫|기분.{0,4}안\s*좋|멘붕/;
const SAFETY_FOLLOWUP_RE = /힘들|괴롭|우울|무기력|아무것도|하기\s*싫|사람\s*만나기\s*싫|혼자|외롭|잠|못\s*자|불안|두려|버티|사라지/;
const GENERIC_ADVICE_RE = /사람들은?\s*보통|일반적으로|대개\s*(?:이런|그런)?\s*경우|힘들(?:다고)?\s*느낄\s*때|힘들\s*때는|심호흡|깊게\s*숨|객관적으로\s*정리|마음을\s*다스|해\s*보세요|해보는\s*것도/;
const LIST_LINE_RE = /^\s*(?:[-*•▪]|\d+[.)])\s+/;

function compactText(value){
  return (value || "").replace(/\s+/g, " ").trim();
}

function isShortContext(lastUser){
  const compact = compactText(lastUser);
  return compact.length > 0 && compact.length <= 55 &&
    SHORT_CONTEXT_RE.test(compact) && !TASK_REQUEST_RE.test(compact);
}

function hasRecentCrisis(messages){
  if(!Array.isArray(messages)) return false;
  return messages
    .filter(message => message?.role === "user" && typeof message.content === "string")
    .slice(-3)
    .some(message => CRISIS_RE.test(message.content));
}

function conversationMode(lastUser, messages=[]){
  if(CRISIS_RE.test(lastUser)) return "crisis";
  if(hasRecentCrisis(messages) && SAFETY_FOLLOWUP_RE.test(lastUser)) return "safety_followup";
  if(TASK_REQUEST_RE.test(lastUser)) return "task";
  if(isShortContext(lastUser)) return "context";
  if(REFLECTION_RE.test(lastUser)) return "reflection";
  return "casual";
}

function turnInstruction(mode){
  if(mode === "crisis"){
    return "이번 답변은 프론트의 위기 연락처 카드와 함께 표시된다. 연락처·번호·단계 목록을 쓰지 말고, 두 문장 이내로 현재 혼자인지와 당장 스스로를 해칠 생각이나 준비가 있는지만 직접 확인한다.";
  }
  if(mode === "safety_followup"){
    return "직전 대화에 자해·자살 암시가 있었고 사용자가 계속 무기력·고립을 말한다. 원인 분석이나 생활 조언을 하지 말고, 두 문장 이내로 아직 답하지 않은 현재 안전 여부를 직접 확인한다. 연락처는 프론트 카드가 담당하므로 반복하지 않는다.";
  }
  if(mode === "task"){
    return "정보·작업 요청이다. 결론과 실행 방법부터 말한다. 사용자가 목록을 요청하지 않았다면 번호 목록을 만들지 않는다. 단순한 요청은 3~6문장 안에서 끝내고, 정보가 부족하면 현재 판단 뒤에 핵심 질문 하나만 한다.";
  }
  if(mode === "context"){
    return "짧은 감정·상태 표현이다. 한두 문장만 쓴다. 일반론, 원인 분석, 영향 설명, 대처법, 심호흡, 체크리스트를 붙이지 않는다. 실제 사건을 모르면 자연스러운 질문 하나만 한다.";
  }
  if(mode === "reflection"){
    return "고민·판단형이다. 2~4문장으로 잠정적 해석과 의견, 이유를 먼저 말한다. 요청하지 않은 해결 과제·체크리스트·추가 도움 제안을 붙이지 않는다.";
  }
  return "가벼운 일상 대화다. 친구와 메시지하듯 1~2문장으로 반응한다. 설명, 교훈, 건강상식, 체크리스트를 붙이지 않는다.";
}

function chatTokenBudget(mode){
  if(mode === "task") return 420;
  if(mode === "reflection") return 260;
  if(mode === "crisis" || mode === "safety_followup") return 160;
  if(mode === "context") return 150;
  return 180;
}

function contextFallback(lastUser){
  const text = compactText(lastUser);
  if(/아무것도\s*하기\s*싫|무기력|의욕\s*없/.test(text)) return "지금은 뭘 시작할 힘 자체가 거의 없는 것 같네. 오늘 유독 심해진 계기가 있었어?";
  if(/사람\s*만나기\s*싫/.test(text)) return "지금은 사람을 상대하는 것 자체가 버거운 것 같네. 무슨 일 있었어?";
  if(/속상|서운/.test(text)) return "그냥 기분이 안 좋은 것보다 뭔가 마음에 걸린 것 같네. 무슨 일이었어?";
  if(/피곤|지쳤|지쳐/.test(text)) return "오늘 에너지를 꽤 많이 쓴 것 같네. 뭐 때문에 그렇게 지쳤어?";
  if(/불안|무서/.test(text)) return "뭔가 계속 신경을 붙잡고 있는 것 같네. 뭐가 제일 걸려?";
  if(/화나|짜증/.test(text)) return "뭔가 선을 넘은 일이 있었던 것 같네. 무슨 일이었어?";
  if(/외롭/.test(text)) return "오늘은 유난히 혼자 남겨진 느낌인가 보네. 무슨 일 있었어?";
  if(/답답|막막/.test(text)) return "어디서부터 풀어야 할지 안 보이는 상태에 가까운 것 같네. 지금 제일 걸리는 게 뭐야?";
  return "오늘 꽤 빡센 날이었나 보네. 무슨 일 있었어?";
}

function directChatReply(lastUser, mode){
  const text = compactText(lastUser).replace(/[.!~]+$/g, "");
  if(mode === "crisis"){
    return "지금은 안전부터 확인할게. 혼자 있어? 그리고 당장 스스로를 해칠 생각이나 준비한 게 있어?";
  }
  if(mode === "safety_followup"){
    return "그 상태가 계속되는 건 그냥 넘기기 어려워. 아까 물은 것부터 확인할게—지금 혼자고, 당장 스스로를 해칠 생각이나 준비는 없어?";
  }
  if(/^(뭐\s*해|뭐\s*하고\s*있어|뭐하냐|머해)[?？]*$/i.test(text)){
    return "너랑 얘기하고 있지. 넌 뭐 하다 왔어?";
  }
  if(/^(배고파|배고프다|허기져|뭐\s*먹지)[?？]*$/i.test(text)){
    return "그럼 뭐 좀 먹자. 지금 당기는 거 있어?";
  }
  if(/^(졸려|졸리다|잠\s*와)[?？]*$/i.test(text)){
    return "그럼 지금은 좀 쉬는 게 맞겠다. 아직 해야 할 일이 남았어?";
  }
  if(/^(심심해|심심하다)[?？]*$/i.test(text)){
    return "그럼 나랑 뭐 하나 하자. 잡담할래, 아니면 가볍게 놀 거리 골라볼까?";
  }
  if(/^(안녕|하이|ㅎㅇ|반가워)[?？]*$/i.test(text)){
    return "안녕. 뭐 하다 왔어?";
  }
  if(/(?:오늘|지금).{0,8}비.{0,4}(?:와|와요|오나|오니|올까|오냐)|비\s*와[?？]*$/i.test(text)){
    return "어디 기준으로 볼까? 지금 위치는 자동으로 알 수 없어.";
  }
  if(mode === "context") return contextFallback(lastUser);
  return null;
}

function stripLegacyFormatting(reply){
  return (reply || "")
    .replace(/^\s*(?:답변|AI)\s*:\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeUnrequestedList(text){
  const lines = text.split("\n");
  const firstList = lines.findIndex(line => LIST_LINE_RE.test(line));
  if(firstList <= 0) return text;
  return lines.slice(0, firstList).join("\n").trim();
}

function completeTruncatedReply(text){
  const punctuation = Math.max(
    text.lastIndexOf("."),
    text.lastIndexOf("?"),
    text.lastIndexOf("!"),
    text.lastIndexOf("。"),
    text.lastIndexOf("？"),
    text.lastIndexOf("！")
  );
  if(punctuation >= 0) return text.slice(0, punctuation + 1).trim();
  const newline = text.lastIndexOf("\n");
  return newline > 0 ? text.slice(0, newline).trim() : "";
}

function limitSentences(text, maxSentences, maxChars){
  const flat = text.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?。！？]+[.!?。！？]?/g) || [];
  const selected = [];
  for(const raw of sentences){
    const sentence = raw.trim();
    if(!sentence) continue;
    const next = [...selected, sentence].join(" ");
    if(selected.length && next.length > maxChars) break;
    selected.push(sentence);
    if(selected.length >= maxSentences) break;
  }
  return selected.join(" ").trim();
}

function normalizeChatReply(reply, mode, lastUser="", finishReason=""){
  let clean = stripLegacyFormatting(reply);
  if(!clean) return directChatReply(lastUser, mode) || (mode === "context" ? contextFallback(lastUser) : "");

  if(finishReason === "length") clean = completeTruncatedReply(clean);
  if(!clean) return directChatReply(lastUser, mode) || contextFallback(lastUser);

  if(mode !== "task") clean = removeUnrequestedList(clean);

  const limits = {
    crisis:[2,190],
    safety_followup:[2,210],
    context:[2,170],
    reflection:[4,430],
    casual:[3,260]
  };
  if(limits[mode]){
    clean = limitSentences(clean, limits[mode][0], limits[mode][1]);
  }

  if(mode === "context" && (!clean || GENERIC_ADVICE_RE.test(clean))) return contextFallback(lastUser);
  if((mode === "crisis" || mode === "safety_followup") && /(?:109|119|112|1393|1577|응급실|긴급전화)/.test(clean)){
    return directChatReply(lastUser, mode);
  }
  return clean || directChatReply(lastUser, mode) || contextFallback(lastUser);
}

module.exports = {
  CHAT_SYSTEM_PROMPT,
  conversationMode,
  turnInstruction,
  chatTokenBudget,
  normalizeChatReply,
  isShortContext,
  contextFallback,
  directChatReply,
  hasRecentCrisis
};
