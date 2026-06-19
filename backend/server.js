// 21팀 Solar 프록시 백엔드 (Render 배포용)
// 역할: 프론트가 보낸 대화 텍스트를 Solar(Upstage)로 보내, 임상 신호를 JSON으로 추출해 돌려준다.
// 핵심: UPSTAGE_API_KEY는 Render 환경변수에만 둔다(코드/프론트에 절대 노출 X).

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());                 // 프론트(다른 도메인)에서 호출 허용
app.use(express.json());

const API_KEY = process.env.UPSTAGE_API_KEY;          // Render 환경변수
const MODEL   = process.env.SOLAR_MODEL || "solar-pro2"; // 콘솔에서 본 정확한 모델명으로 환경변수 설정
const SOLAR_URL = "https://api.upstage.ai/v1/chat/completions";

// 헬스체크 (Render 깨우기용 — 발표 직전 한 번 호출해 cold start 방지)
app.get("/", (_req, res) => res.send("ok"));

// 프론트 정적 파일 서빙 (상위 폴더의 app.html, index.html 등)
// → https://mindhub-mvp.onrender.com/app.html 로 접근 가능
app.use(express.static(path.join(__dirname, "..")));

// 추출 엔드포인트
app.post("/extract", async (req, res) => {
  const text = (req.body && req.body.text || "").trim();
  if (!text) return res.json({ sleep_h: null, med_taken: null, mood: null, stressor: null });
  if (!API_KEY) return res.status(500).json({ error: "UPSTAGE_API_KEY not set" });

  const system = "너는 임상 데이터 정리 보조다. 진단·판단은 하지 마라. " +
    "다음 환자 대화에서 sleep_h(수면시간 숫자, 시간 단위), med_taken(복약 여부 true/false), " +
    "mood(0~10 정수, 낮을수록 우울), stressor(스트레스원 한 단어)를 추출해 JSON으로만 답하라. " +
    "언급이 없으면 해당 값은 null. 다른 말은 절대 쓰지 마라.";

  try {
    const r = await fetch(SOLAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text }
        ],
        max_tokens: 160,
        response_format: { type: "json_object" }   // 지원 안 하면 이 줄 빼도 됨
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "solar error", detail: t.slice(0, 300) });
    }
    const data = await r.json();
    let content = data.choices?.[0]?.message?.content || "{}";
    // 모델이 코드블록으로 감쌀 때 대비
    content = content.replace(/```json|```/g, "").trim();
    let parsed = {};
    try { parsed = JSON.parse(content); } catch (e) { parsed = {}; }
    return res.json({
      sleep_h:   parsed.sleep_h   ?? null,
      med_taken: parsed.med_taken ?? null,
      mood:      parsed.mood      ?? null,
      stressor:  parsed.stressor  ?? null
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// 채팅 엔드포인트 — 일반 AI처럼 실제 질문에 답하되 의료 안전선을 지키는 대화.
// 임상 추출은 /extract가 별도로 담당. 위험 감지는 프론트 규칙 기반(RISK_WORDS)이 항상 처리.
app.post("/chat", async (req, res) => {
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (!messages.length) return res.json({ reply: "" });
  if (!API_KEY) return res.status(500).json({ error: "UPSTAGE_API_KEY not set" });

  // /chat system 프롬프트 — 잡담은 짧게, 질문·코딩·방법 요청에는 실제로 답한다.
  const system = `너는 사용자가 평소 ChatGPT처럼 무엇이든 이야기할 수 있는 한국어 AI다.
잡담에는 카카오톡처럼 자연스럽게 1~3문장으로 반응한다.
사용자가 방법·설명·추천·코딩 도움을 분명히 요청하면 질문만 되묻지 말고, 핵심 답을 직접 주되 간결하게 정리한다.
사용자 말투와 무게에 맞추고, 과한 공감·칭찬·상담사식 표현·불필요한 체크리스트는 피한다.

의료 안전선:
- 너는 의사·치료사가 아니다. 진단, 약물 변경, 치료 지시는 하지 않는다.
- 의학적 판단은 "그건 선생님과 확인해보자"로 연결한다.
- 임상 신호를 분석하거나 수집 중이라는 사실을 대화에 드러내지 않는다.
- 비밀을 선생님에게 숨겨주겠다고 약속하지 않는다.
- 자해·자살 암시에는 섣부른 낙관으로 덮지 말고 짧게 고통을 받아준 뒤 지금 혼자인지 묻는다.
  위기 연락처 카드는 프론트가 별도로 표시한다.

대화를 억지로 질문으로 끝내지 말고, 사용자가 원하는 것이 대화인지 정보인지 구분해서 답한다.`;

  // 최근 대화만 전달하고 각 메시지 길이도 제한(토큰 절약). user/assistant 역할만 허용.
  const recent = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map(m => ({ role:m.role, content:m.content.slice(0, 2500) }));
  const lastUser = [...recent].reverse().find(m => m.role === "user")?.content || "";
  const needsDetail = /[?？]|어떻게|방법|설명|정리|추천|코드|에러|오류|왜|뭐가|도와|알려/.test(lastUser);
  const maxTokens = needsDetail ? 420 : 140;

  try {
    const r = await fetch(SOLAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [ { role: "system", content: system }, ...recent ],
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "solar error", detail: t.slice(0, 300) });
    }
    const data = await r.json();
    const reply = (data.choices?.[0]?.message?.content || "").trim();
    return res.json({ reply });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;   // Render가 PORT를 주입함
app.listen(PORT, () => console.log("solar proxy on " + PORT));
