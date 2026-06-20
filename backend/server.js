// 21팀 Solar 프록시 백엔드 (Render 배포용)
// 역할: 프론트가 보낸 대화 텍스트를 Solar(Upstage)로 보내, 임상 신호를 JSON으로 추출해 돌려준다.
// 핵심: UPSTAGE_API_KEY는 Render 환경변수에만 둔다(코드/프론트에 절대 노출 X).

const express = require("express");
const cors = require("cors");
const path = require("path");
const {
  CHAT_SYSTEM_PROMPT,
  conversationMode,
  turnInstruction,
  chatTokenBudget,
  normalizeChatReply,
  directChatReply
} = require("./conversation-style");
const {
  ADOPTION_SYSTEM_PROMPT,
  normalizeAdoptionInput,
  isValidAdoptionInput,
  buildAdoptionInput,
  fallbackAdoptionReply,
  extractResponseText
} = require("./adoption-consultation");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);       // Render 프록시 뒤의 실제 클라이언트 IP 사용

const DEFAULT_ORIGINS = [
  "https://mindhub.forblune.com",
  "https://forblune.github.io",
  "https://mindhub-mvp.onrender.com",
  "http://localhost:3000",
  "http://localhost:3100",
  "http://localhost:4173",
  "http://localhost:8000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3100",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:8000"
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(process.env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean)
]);

app.use(cors({
  origin(origin, callback){
    // 정적 파일·헬스체크는 Origin 없는 접근도 허용한다.
    // Solar를 쓰는 POST 경로는 requireAllowedOrigin에서 한 번 더 막는다.
    if(!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    const error = new Error("CORS_NOT_ALLOWED");
    error.status = 403;
    return callback(error);
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
}));
app.use(express.json({ limit:"32kb" }));

const API_KEY = process.env.UPSTAGE_API_KEY;          // Render 환경변수
const MODEL   = process.env.SOLAR_MODEL || "solar-pro2"; // 콘솔에서 본 정확한 모델명으로 환경변수 설정
const SOLAR_URL = "https://api.upstage.ai/v1/chat/completions";
const SOLAR_TIMEOUT_MS = 8000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 12000;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vhxvqtbemahbcbrbnkcv.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6InZoeHZxdGJlbWFoYmNicmJua2N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5ODEwNDMsImV4cCI6MjA5NjU1NzA0M30.kKowienH_myTszuJuG3HSuIDl9TUM6EBT4ZUV6jqRM0";
const AUTH_TIMEOUT_MS = 5000;

function makeRateLimiter({ windowMs, max }){
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = buckets.get(key);
    if(!bucket || now >= bucket.resetAt){
      bucket = { count:0, resetAt:now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.set("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if(bucket.count > max){
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error:"too_many_requests", message:"요청이 많아요. 잠시 후 다시 시도해 주세요." });
    }
    if(buckets.size > 1000){
      for(const [ip, value] of buckets){
        if(now >= value.resetAt) buckets.delete(ip);
      }
    }
    next();
  };
}

const chatLimiter = makeRateLimiter({ windowMs:10*60*1000, max:30 });
const extractLimiter = makeRateLimiter({ windowMs:10*60*1000, max:20 });
const adoptionLimiter = makeRateLimiter({ windowMs:30*60*1000, max:10 });
function requireAllowedOrigin(req, res, next){
  const origin = req.get("origin");
  if(!origin || !ALLOWED_ORIGINS.has(origin)){
    return safeError(res, 403, "origin_not_allowed", "허용되지 않은 접속 경로입니다.");
  }
  next();
}

async function requireAuthenticatedUser(req, res, next){
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if(!match) return safeError(res, 401, "login_required", "대화를 시작하려면 로그인해 주세요.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers:{
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${match[1]}`
      },
      signal:controller.signal
    });
    if(!r.ok) return safeError(res, 401, "invalid_session", "로그인 세션이 만료됐어요. 다시 로그인해 주세요.");
    const user = await r.json();
    if(!user || !user.id) return safeError(res, 401, "invalid_session", "로그인 세션을 확인하지 못했어요.");
    req.authUser = { id:user.id };
    next();
  }catch(e){
    return safeError(
      res,
      e.name === "AbortError" ? 504 : 503,
      "auth_unavailable",
      "로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
    );
  }finally{
    clearTimeout(timer);
  }
}

async function callSolar(payload, res){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOLAR_TIMEOUT_MS);
  const onClose = () => {
    if(!res.writableEnded) controller.abort();
  };
  res.once("close", onClose);
  try{
    return await fetch(SOLAR_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${API_KEY}` },
      body:JSON.stringify(payload),
      signal:controller.signal
    });
  }finally{
    clearTimeout(timer);
    res.removeListener("close", onClose);
  }
}

async function callOpenAI(payload, res){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const onClose = () => {
    if(!res.writableEnded) controller.abort();
  };
  res.once("close", onClose);
  try{
    return await fetch(OPENAI_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_API_KEY}` },
      body:JSON.stringify(payload),
      signal:controller.signal
    });
  }finally{
    clearTimeout(timer);
    res.removeListener("close", onClose);
  }
}

function safeError(res, status, error, message){
  if(res.headersSent || res.writableEnded || res.destroyed) return;
  res.status(status).json({ error, message });
}
function boundedNumber(value, min, max, integer=false){
  if(value===null || value===undefined || value==="") return null;
  const n = typeof value==="number" ? value : Number(value);
  if(!Number.isFinite(n) || n<min || n>max) return null;
  return integer ? Math.round(n) : n;
}

// 헬스체크 (Render 깨우기·배포 상태 확인용, Solar 토큰 사용 없음)
function healthCheck(_req, res){
  res.set("Cache-Control", "no-store");
  res.type("text/plain").send("ok");
}
app.get("/", healthCheck);
app.get("/health", healthCheck);

// 기관 도입 적합도 상담 — 개인정보를 저장하지 않는 단발성 안내.
app.post("/adoption-consult", requireAllowedOrigin, adoptionLimiter, async (req, res) => {
  const input = normalizeAdoptionInput(req.body);
  if(!isValidAdoptionInput(input)){
    return res.status(400).json({
      error:"invalid_consultation_input",
      message:"기관 유형, 목표, 규모와 우선순위를 모두 선택해 주세요."
    });
  }

  const fallback = fallbackAdoptionReply(input);
  if(!OPENAI_API_KEY) return res.json({ reply:fallback, source:"guided_fallback" });

  try{
    const r = await callOpenAI({
      model:OPENAI_MODEL,
      store:false,
      reasoning:{ effort:"low" },
      instructions:ADOPTION_SYSTEM_PROMPT,
      input:buildAdoptionInput(input),
      max_output_tokens:700
    }, res);
    if(!r.ok){
      const detail = (await r.text()).slice(0, 300);
      console.error("openai adoption consult error", r.status, detail);
      return res.json({ reply:fallback, source:"guided_fallback" });
    }
    const data = await r.json();
    const reply = extractResponseText(data);
    return res.json({ reply:reply || fallback, source:reply ? "openai" : "guided_fallback" });
  }catch(e){
    console.error("adoption consult request failed", e.name || "Error", e.message || "");
    return res.json({ reply:fallback, source:"guided_fallback" });
  }
});

// 추출 엔드포인트
app.post("/extract", requireAllowedOrigin, requireAuthenticatedUser, extractLimiter, async (req, res) => {
  const text = (req.body && req.body.text || "").trim();
  if (!text) return res.json({ sleep_h: null, med_taken: null, mood: null, stressor: null });
  if (text.length > 3000) return res.status(413).json({ error:"input_too_long", message:"메시지는 3,000자 이내로 보내 주세요." });
  if (!API_KEY) return safeError(res, 503, "ai_unavailable", "AI 정리 기능이 준비되지 않았습니다.");

  const system = "너는 임상 데이터 정리 보조다. 진단·판단은 하지 마라. " +
    "다음 환자 대화에서 sleep_h(수면시간 숫자, 시간 단위), med_taken(복약 여부 true/false), " +
    "mood(0~10 정수, 낮을수록 우울), stressor(스트레스원 한 단어)를 추출해 JSON으로만 답하라. " +
    "언급이 없으면 해당 값은 null. 다른 말은 절대 쓰지 마라.";

  try {
    const r = await callSolar({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text }
      ],
      max_tokens: 160,
      response_format: { type: "json_object" }
    }, res);
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.error("solar extract error", r.status, detail);
      return safeError(res, 502, "ai_unavailable", "AI 정리 기능이 잠시 불안정합니다.");
    }
    const data = await r.json();
    let content = data.choices?.[0]?.message?.content || "{}";
    // 모델이 코드블록으로 감쌀 때 대비
    content = content.replace(/```json|```/g, "").trim();
    let parsed = {};
    try { parsed = JSON.parse(content); } catch (e) { parsed = {}; }
    return res.json({
      sleep_h:   boundedNumber(parsed.sleep_h, 0, 24),
      med_taken: typeof parsed.med_taken==="boolean" ? parsed.med_taken : null,
      mood:      boundedNumber(parsed.mood, 0, 10, true),
      stressor:  typeof parsed.stressor==="string" ? parsed.stressor.trim().slice(0, 80) || null : null
    });
  } catch (e) {
    console.error("extract request failed", e.name || "Error", e.message || "");
    return safeError(res, e.name==="AbortError" ? 504 : 500, "ai_unavailable", "AI 정리 기능이 잠시 불안정합니다.");
  }
});

// 채팅 엔드포인트 — 일반 AI처럼 실제 질문에 답하되 의료 안전선을 지키는 대화.
// 임상 추출은 /extract가 별도로 담당. 위험 감지는 프론트 규칙 기반(RISK_WORDS)이 항상 처리.
app.post("/chat", requireAllowedOrigin, requireAuthenticatedUser, chatLimiter, async (req, res) => {
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (!messages.length) return res.json({ reply: "" });

  // 최근 대화만 전달하고 각 메시지 길이도 제한(토큰 절약). user/assistant 역할만 허용.
  const recent = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map(m => ({
      role:m.role,
      // 구버전의 장문 상담형 답변을 모델이 문체 예시로 모방하지 않도록 assistant 기록만 짧게 제한한다.
      content:m.content.trim().slice(0, m.role === "assistant" ? 700 : 3000)
    }));
  if(!recent.length) return res.status(400).json({ error:"invalid_messages", message:"유효한 대화가 없어요." });
  if(recent.some(m => m.content.length > 3000) || recent.reduce((n,m)=>n+m.content.length,0) > 12000){
    return res.status(413).json({ error:"input_too_long", message:"대화가 너무 길어요. 새 대화에서 다시 시도해 주세요." });
  }
  const lastUser = [...recent].reverse().find(m => m.role === "user")?.content || "";
  const mode = conversationMode(lastUser, recent);
  const directReply = directChatReply(lastUser, mode);
  if(directReply) return res.json({ reply:directReply, mode, source:"direct" });
  if (!API_KEY) return safeError(res, 503, "ai_unavailable", "AI 답변 기능이 준비되지 않았습니다.");
  const maxTokens = chatTokenBudget(mode);

  try {
    const r = await callSolar({
      model: MODEL,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "system", content: turnInstruction(mode) },
        ...recent
      ],
      max_tokens: maxTokens,
      temperature: 0.65
    }, res);
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.error("solar chat error", r.status, detail);
      return safeError(res, 502, "ai_unavailable", "AI 답변 기능이 잠시 불안정합니다.");
    }
    const data = await r.json();
    const choice = data.choices?.[0] || {};
    const reply = normalizeChatReply(
      choice.message?.content || "",
      mode,
      lastUser,
      choice.finish_reason || ""
    );
    return res.json({ reply, mode, source:"solar" });
  } catch (e) {
    console.error("chat request failed", e.name || "Error", e.message || "");
    return safeError(res, e.name==="AbortError" ? 504 : 500, "ai_unavailable", "AI 답변 기능이 잠시 불안정합니다.");
  }
});

// 프론트 정적 파일 서빙 (상위 폴더의 app.html, index.html 등)
app.use(express.static(path.join(__dirname, "..")));

app.use((err, _req, res, _next) => {
  if(err?.message === "CORS_NOT_ALLOWED") return safeError(res, 403, "origin_not_allowed", "허용되지 않은 접속 경로입니다.");
  if(err?.type === "entity.too.large") return safeError(res, 413, "body_too_large", "요청 본문이 너무 큽니다.");
  console.error("unhandled request error", err?.message || err);
  return safeError(res, 500, "server_error", "서버 요청을 처리하지 못했습니다.");
});

const PORT = process.env.PORT || 3000;   // Render가 PORT를 주입함
app.listen(PORT, () => console.log("solar proxy on " + PORT));
