# Solar 프록시 백엔드 — Render 배포 가이드

프론트가 Solar를 직접 부르면 API 키가 노출됩니다. 그래서 이 작은 백엔드가 중간에서 대신 호출하고,
키는 **Render 환경변수에만** 둡니다.

## 배포 순서
1. 이 `backend/` 폴더를 GitHub 저장소에 올린다. (또는 별도 저장소)
2. Render → **New → Web Service** → 그 GitHub 저장소 연결.
3. 설정:
   - **Root Directory:** `backend` (이 폴더가 루트가 아니면)
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Environment(환경변수) 추가:**
   - `UPSTAGE_API_KEY` = (Upstage 콘솔에서 발급한 키)
   - `SOLAR_MODEL` = (콘솔에서 본 정확한 모델명, 예: `solar-pro2`)
   - `SUPABASE_URL` = (Supabase 프로젝트 URL, 코드의 기본값과 다를 때)
   - `SUPABASE_ANON_KEY` = (Supabase 공개 anon key, 코드의 기본값과 다를 때)
   - `OPENAI_API_KEY` = (선택, 기관 도입 상담을 GPT로 보강할 때만)
   - `OPENAI_MODEL` = `gpt-5.4-mini` (선택, 비용·지연을 고려한 기본값)
   - `ALLOWED_ORIGINS` = (기본 목록 외 프론트 주소가 있다면 쉼표로 추가)
5. 배포되면 주소가 나온다 → 예: `https://mindhub-mvp.onrender.com`

## 확인
- 브라우저로 `https://<주소>/` 열어서 **`ok`** 가 보이면 살아있는 것.
- 추출 테스트(터미널):
  ```
  curl -X POST https://<주소>/extract \
    -H "Origin: https://mindhub.forblune.com" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <로그인 사용자의 Supabase access token>" \
    -d '{"text":"어제 4시간밖에 못 잤어. 약은 먹었어."}'
  ```
  → `{"sleep_h":4,"med_taken":true,"mood":null,"stressor":null}` 비슷하게 나오면 성공.

## 프론트 연결
- `app.html` 상단의 `const BACKEND_URL = "";` 에 위 Render 주소를 넣는다.
  → 예: `const BACKEND_URL = "https://mindhub-mvp.onrender.com";`
- 비워두면 로그인 사용자에게 로컬 폴백 답변을 사용하고, 주소를 넣으면 **Solar 실제 대화·추출**을 사용한다.
- Solar 호출이 실패해도 로그인 상태 안에서 로컬 폴백으로 전환된다.

## ⚠️ 함정
- **Cold start:** 무료 티어는 안 쓰면 잠들어 첫 요청이 ~30초. 발표 직전 `/` 를 한 번 열어 깨워둘 것.
- **Origin 제한:** `/chat`·`/extract`는 허용된 프론트 Origin이 반드시 필요하다. 새 도메인은 `ALLOWED_ORIGINS`에도 추가할 것.
- **로그인 제한:** `/chat`·`/extract`는 유효한 Supabase Bearer 토큰이 없으면 `401`로 거절한다.
- **도입 상담:** `/adoption-consult`는 개인정보를 받지 않는 공개 초기 상담 경로다. Origin·입력 길이·IP당 호출 횟수를 제한하고 OpenAI 요청에는 `store:false`를 사용한다.
- **키 관리:** 실제 `OPENAI_API_KEY`는 `.env`, Render 환경변수 등 비공개 설정에만 두고 저장소에는 올리지 않는다.
- **위험 감지는 프론트(규칙 기반)에 그대로 둠** — 안전 기능은 API가 죽어도 항상 동작해야 하므로 일부러 분리.
