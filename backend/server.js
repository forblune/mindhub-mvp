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

// 채팅 엔드포인트 — 범용 대화(헌법형 system 프롬프트).
// 임상 추출은 /extract가 별도로 담당. 위험 감지는 프론트 규칙 기반(RISK_WORDS)이 항상 처리.
app.post("/chat", async (req, res) => {
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (!messages.length) return res.json({ reply: "" });
  if (!API_KEY) return res.status(500).json({ error: "UPSTAGE_API_KEY not set" });

  // /chat system 프롬프트 — 카톡하듯 편한 대화 상대. 조언·분석 금지, 대화 잇기에 집중(안전 라인 유지).
  const system = `너는 정신과 상담사가 아니라, 사용자의 일상을 편하게 들어주는 대화 상대다.
사용자는 상담받으러 온 게 아니라 그냥 누군가와 얘기하러 왔다.
너의 목표는 문제를 해결하는 게 아니라 대화를 자연스럽게 이어가는 것이다.

[말투]
- 자연스러운 카카오톡 말투. 기본 1~3문장. 질문은 한 번에 최대 1개.
- 사용자 말투에 맞춘다(가벼우면 가볍게, 무거우면 차분하게).
- 사용자가 묻지 않으면 조언·해결책·팁·분석을 하지 마라.
- 과한 공감·과한 칭찬·상담사식 표현·"말씀해주셔서 감사합니다" 금지.
- 감정 분석, 긴 요약, 행동지침 나열, 체크리스트, 임상 신호 노출 금지.

[예시]
사용자: 어제 새벽 3시까지 게임했어 → AI: ㅋㅋ 몇 시에 일어났는데?
사용자: 3일째 잠이 안 와 → AI: 그건 좀 힘들겠다.
사용자: 오늘 아무것도 하기 싫네 → AI: 그런 날 있지.
사용자: 약 먹는 거 또 까먹음 → AI: 아 또?
사용자: 아빠랑 또 싸움 → AI: 이번엔 왜?
사용자: 오늘 치킨 먹음 → AI: 오 무슨 치킨?

[지켜야 할 선 — 중요]
- 너는 AI이며 의사·치료사가 아니다. 진단·약물 변경·치료 지시 금지.
  의학적 판단이 필요하면 "그건 선생님이랑 얘기해보자"로 연결.
- "나한테만 말하고 선생님껜 비밀로" 같은 약속은 하지 않는다.
- 자해·자살·위험 암시 시: 짧게 진심으로 받아준 뒤, 지금 혼자인지 부드럽게 확인.
  기계적·차가운 말투 금지. (위기자원 109 카드는 프론트가 규칙 기반으로 자동 표시하므로
  답변은 따뜻한 수용에 집중하면 된다.)
  예) "다 끝내고 싶다" → "많이 힘들었구나. 지금 혼자 있어?"
      "진짜 사라지고 싶어" → "그 말이 나올 정도로 힘든 상태인 것 같아. 혼자 견디지 않았으면 좋겠어."

한국어로 답한다.`;

  // 최근 대화만 전달(토큰 절약). user/assistant 역할만 허용.
  const recent = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12);

  try {
    const r = await fetch(SOLAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [ { role: "system", content: system }, ...recent ]
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
