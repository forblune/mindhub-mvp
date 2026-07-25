// Supabase Bearer 토큰 검증. fetch를 주입 가능하게 해 실제 Supabase 없이 성공/실패/장애/타임아웃을 테스트한다.
function createRequireAuthenticatedUser({ supabaseUrl, supabaseAnonKey, timeoutMs, safeError, fetchImpl = fetch }){
  return async function requireAuthenticatedUser(req, res, next){
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if(!match) return safeError(res, 401, "login_required", "대화를 시작하려면 로그인해 주세요.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try{
      const r = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        headers:{
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${match[1]}`
        },
        signal: controller.signal
      });
      if(!r.ok) return safeError(res, 401, "invalid_session", "로그인 세션이 만료됐어요. 다시 로그인해 주세요.");
      const user = await r.json();
      if(!user || !user.id) return safeError(res, 401, "invalid_session", "로그인 세션을 확인하지 못했어요.");
      req.authUser = { id:user.id };
      req.authToken = match[1];
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
  };
}

module.exports = { createRequireAuthenticatedUser };
