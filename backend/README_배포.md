# Solar 프록시 백엔드 — Render 배포 가이드

프론트가 Solar를 직접 부르면 API 키가 노출됩니다. 그래서 이 작은 백엔드가 중간에서 대신 호출하고,
키는 **Render 환경변수에만** 둡니다.

## 배포 순서
1. 이 `backend/` 폴더를 GitHub 저장소에 올린다. (또는 별도 저장소)
2. Render → **New → Web Service** → 그 GitHub 저장소 연결.
3. 설정:
   - **Root Directory:** `backend` (이 폴더가 루트가 아니면)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Environment(환경변수) 추가:**
   - `UPSTAGE_API_KEY` = (Upstage 콘솔에서 발급한 키)
   - `SOLAR_MODEL` = (콘솔에서 본 정확한 모델명, 예: `solar-pro2`)
5. 배포되면 주소가 나온다 → 예: `https://21team-solar.onrender.com`

## 확인
- 브라우저로 `https://<주소>/` 열어서 **`ok`** 가 보이면 살아있는 것.
- 추출 테스트(터미널):
  ```
  curl -X POST https://<주소>/extract \
    -H "Content-Type: application/json" \
    -d '{"text":"어제 4시간밖에 못 잤어. 약은 먹었어."}'
  ```
  → `{"sleep_h":4,"med_taken":true,"mood":null,"stressor":null}` 비슷하게 나오면 성공.

## 프론트 연결
- `index.html` 상단의 `const BACKEND_URL = "";` 에 위 Render 주소를 넣는다.
  → 예: `const BACKEND_URL = "https://21team-solar.onrender.com";`
- 비워두면 **목업 모드**(데모, API 없이 동작). 주소를 넣으면 **Solar 실제 추출**.
- Solar 호출이 실패해도 자동으로 목업으로 **폴백**되므로 데모는 안 깨진다.

## ⚠️ 함정
- **Cold start:** 무료 티어는 안 쓰면 잠들어 첫 요청이 ~30초. 발표 직전 `/` 를 한 번 열어 깨워둘 것.
- **위험 감지는 프론트(규칙 기반)에 그대로 둠** — 안전 기능은 API가 죽어도 항상 동작해야 하므로 일부러 분리.
