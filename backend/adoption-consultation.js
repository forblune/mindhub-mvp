const ORGANIZATIONS = {
  clinic: "정신건강의학과 의원",
  hospital: "병원·종합병원",
  public: "정신건강복지센터·공공기관",
  other: "기타 기관"
};

const GOALS = {
  previsit: "진료 전 환자 변화 요약",
  followup: "퇴원·외래 사이 추적관리",
  safety: "안전 신호와 우선 확인 항목 정리",
  workflow: "문진·기록 업무 효율화"
};

const SCALES = {
  small: "의료진 1~2명·소규모 파일럿",
  medium: "의료진 3~10명·단일 기관",
  large: "다부서·다기관 확장 검토"
};

const PRIORITIES = {
  speed: "진료 준비 시간 단축",
  privacy: "개인정보·환자 통제",
  integration: "EMR·기존 업무 연동",
  engagement: "환자의 자발적 기록 지속"
};

const ADOPTION_SYSTEM_PROMPT = `너는 정신건강 서비스 "마음기록"의 기관 도입 상담 보조자다.
마음기록은 진료 사이의 일상 대화를 수면·복약·기분·스트레스·안전 신호로 정리하고,
환자가 공유한 범위만 진료 전 리포트로 전달하는 기록·요약·전달 서비스다.

목표:
- 입력된 기관 조건을 바탕으로 현실적인 첫 파일럿 범위를 제안한다.
- 기존 EMR을 당장 교체하거나 진단·치료를 자동화한다고 과장하지 않는다.
- 의료진 1~2명, 동의한 소수 사용자, 별도 웹/PDF 리포트로 시작하는 단계적 접근을 우선한다.
- 개인정보, 환자 동의, 안전 대응 책임, 의료기관 검토가 필요함을 분명히 한다.
- 법률·의료·보안 인증을 완료했다고 단정하지 않는다.

반드시 아래 제목을 그대로 사용해 한국어로 간결하게 답한다.

적합도
추천 파일럿
운영 준비
주의점

각 항목은 1~3개의 짧은 글머리표로 쓴다. 영업 문구보다 판단 근거와 실행 가능한 다음 단계를 우선한다.`;

function cleanText(value, max=600){
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeAdoptionInput(body={}){
  const organization = Object.hasOwn(ORGANIZATIONS, body.organization) ? body.organization : "";
  const goal = Object.hasOwn(GOALS, body.goal) ? body.goal : "";
  const scale = Object.hasOwn(SCALES, body.scale) ? body.scale : "";
  const priority = Object.hasOwn(PRIORITIES, body.priority) ? body.priority : "";
  return {
    organization,
    goal,
    scale,
    priority,
    workflow: cleanText(body.workflow)
  };
}

function isValidAdoptionInput(input){
  return !!(input.organization && input.goal && input.scale && input.priority);
}

function buildAdoptionInput(input){
  return [
    `기관 유형: ${ORGANIZATIONS[input.organization]}`,
    `가장 중요한 목표: ${GOALS[input.goal]}`,
    `검토 규모: ${SCALES[input.scale]}`,
    `우선순위: ${PRIORITIES[input.priority]}`,
    `현재 업무와 어려움: ${input.workflow || "별도 설명 없음"}`,
    "",
    "위 조건만으로 확정할 수 없는 부분은 가정이라고 밝혀라. 환자 개인정보를 추가로 요구하지 마라."
  ].join("\n");
}

function fallbackAdoptionReply(input){
  const organization = ORGANIZATIONS[input.organization];
  const goal = GOALS[input.goal];
  const scale = SCALES[input.scale];
  const priority = PRIORITIES[input.priority];
  return `적합도
• ${organization}에서 ${goal}을 검증하는 초기 파일럿과 잘 맞습니다.
• 특히 “${priority}”를 실제 사용 지표로 확인할 수 있는 범위부터 시작하는 편이 안전합니다.

추천 파일럿
• ${scale} 기준으로 4~6주 동안 동의한 소수 사용자만 운영합니다.
• EMR 교체 없이 별도 웹 리포트 또는 PDF로 시작하고, 진료 전 확인 시간과 정보 누락을 측정합니다.

운영 준비
• 의료진이 확인할 항목, 환자 공유 범위, 위험 표현 발견 시 대응 절차를 먼저 합의합니다.
• 실제 환자 적용 전 개인정보 처리, 동의 문구, 접근 권한과 보관 정책을 기관 기준으로 검토합니다.

주의점
• 이 결과는 초기 도입 방향이며 의료·법률·보안 적합성에 대한 확정 판단이 아닙니다.
• 진단·응급 모니터링 자동화를 약속하기보다 기록·요약·전달 범위에서 효과를 먼저 검증해야 합니다.`;
}

function extractResponseText(data){
  if(typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for(const item of Array.isArray(data?.output) ? data.output : []){
    for(const content of Array.isArray(item?.content) ? item.content : []){
      if(content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

module.exports = {
  ADOPTION_SYSTEM_PROMPT,
  ORGANIZATIONS,
  GOALS,
  SCALES,
  PRIORITIES,
  normalizeAdoptionInput,
  isValidAdoptionInput,
  buildAdoptionInput,
  fallbackAdoptionReply,
  extractResponseText
};
