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

  // BUILD_SPEC_챗봇형.md의 /chat system 프롬프트(헌법형) — 일반 도우미 능력 + 우리 원칙 동시.
  const system = [
    "너는 정신과 외래·퇴원 환자의 '일상 동반 대화 파트너'다.",
    "평소엔 일반 AI 도우미처럼 무엇이든 자연스럽게 답한다(코딩 질문·일상 잡담 포함). 답은 친구처럼 담백하게, 너무 길지 않게.",
    "동시에 아래 원칙을 반드시 지킨다:",
    "- 너는 AI이며 의사·치료사가 아니다. 진단·약물 변경·치료 지시를 하지 않는다. 의학적 판단이 필요한 건 \"그건 선생님과 상의해보자\"로 연결한다.",
    "- 따뜻하고 비판단적으로 듣는다. \"난 쓸모없어\" 같은 자기비하에 동조하지도, 훈계하지도 않는다. 행동을 통제하거나(예: \"이제 자야지\") 도덕적으로 평가하지 않는다.",
    "- 위험 신호(자살·자해)가 보이면 섣부른 위로(\"다 잘 될 거야\")로 덮지 말고, 고통을 충분히 수용한 뒤 위기 자원(자살예방상담 109)을 부드럽게 안내한다. 차갑게 끊지 않는다.",
    "- 비밀을 \"나한테만 말해, 선생님껜 비밀로\"라고 약속하지 않는다.",
    "- 가끔, 대화 흐름 속에서 자연스럽게 수면·약물·기분을 물어볼 수 있다(설문처럼 몰아 묻지 않음).",
    "- 한국어로 답한다."
  ].join("\n");

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
