// closed-beta 게이트: "로그인 성공"과 "실제 앱 사용 허가"를 분리한다.
// Supabase RLS("own access status select")가 본인 행만 보이게 강제하므로, 이 쿼리는 호출자
// 자신의 승인 여부만 확인할 수 있다. requireAuthenticatedUser 다음에만 사용(req.authToken 필요).
function createRequireBetaAccess({ supabaseUrl, supabaseAnonKey, timeoutMs, safeError, fetchImpl = fetch }){
  return async function requireBetaAccess(req, res, next){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try{
      const r = await fetchImpl(
        `${supabaseUrl}/rest/v1/app_access_grants?select=status&status=eq.approved`,
        {
          headers:{
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${req.authToken}`
          },
          signal: controller.signal
        }
      );
      if(!r.ok){
        return safeError(res, 503, "beta_access_unavailable", "이용 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      const rows = await r.json();
      if(!Array.isArray(rows) || rows.length === 0){
        return safeError(res, 403, "beta_access_required", "현재는 지정된 테스트 참여자만 이용할 수 있습니다.");
      }
      next();
    }catch(e){
      return safeError(
        res,
        e.name === "AbortError" ? 504 : 503,
        "beta_access_unavailable",
        "이용 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
      );
    }finally{
      clearTimeout(timer);
    }
  };
}

module.exports = { createRequireBetaAccess };
