// Solar/이메일을 소비하는 POST 경로 전용 2차 Origin 검사. cors() 미들웨어가 이미 한 번 막지만,
// 정적 파일·헬스체크는 Origin 없는 접근도 허용해야 해서 그쪽은 통과시키므로 여기서 한 번 더 막는다.
function createRequireAllowedOrigin({ allowedOrigins, safeError }){
  return function requireAllowedOrigin(req, res, next){
    const origin = req.get("origin");
    if(!origin || !allowedOrigins.has(origin)){
      return safeError(res, 403, "origin_not_allowed", "허용되지 않은 접속 경로입니다.");
    }
    next();
  };
}

module.exports = { createRequireAllowedOrigin };
