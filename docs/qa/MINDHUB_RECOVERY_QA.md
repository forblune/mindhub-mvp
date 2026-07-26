# MindHub 복구 RC — 브라우저 QA 결과 (2026-07-25)

> 대상: `rc/mindhub-recovery` (기준 커밋 `6fbb5b4`)
> 도구: Playwright MCP(실제 Chromium), 로컬 정적 서버(`python3 -m http.server`)
> 원칙: 실제 Solar 호출·실제 이메일 발송·운영 데이터 변경은 하지 않음. 실제 개인정보는 어떤 fixture에도 쓰지 않음.

판정은 눈으로 보는 대신 가능한 한 **측정**했다. 가로 오버플로는 `documentElement.scrollWidth`와
요소별 `getBoundingClientRect().right`를 직접 비교하고, 데모 격리는 `performance.getEntriesByType('resource')`로
실제 발생한 네트워크 요청을 열거하고, 대비는 WCAG 상대휘도 공식으로 계산했다.

---

## 1. 반응형 — 가로 오버플로 0

`index.html` 전 구간을 5개 폭에서 측정. **모든 폭에서 오버플로 0px, 뷰포트를 벗어난 요소 0개.**

| 폭 | 실측 뷰포트 | 오버플로 | 뷰포트 이탈 요소 |
|---|---|---|---|
| 360px (소형 모바일) | 345px | 0px | 0개 |
| 390px (일반 모바일) | 375px | 0px | 0개 |
| 640px (=1280px의 200% 확대 등가) | 625px | 0px | 0개 |
| 820px (태블릿) | 805px | 0px | 0개 |
| 1280px (데스크톱) | 1265px | 0px | 0개 |

`app.html`(로그인 화면)·`doctor.html?demo=1`도 각 폭에서 오버플로 0px.

**200% 확대**: 1280px 창의 200% 확대는 레이아웃상 640 CSS px와 동일하므로 그 폭에서 측정했다.
오버플로 0px, `overflow:hidden`으로 잘린 텍스트 0개, `#availability` 섹션 2개 카드 모두 정상 렌더.

## 2. 섹션 렌더링

`index.html` 11개 섹션 전부 0이 아닌 높이로 렌더 확인 (360px 기준):
nav 69 · hero 1244 · story 1054 · `#problem` 1140 · `#flow` 1297 · `#demo` 1890 · `#proof` 2215 ·
`#business` 1636 · **`#availability` 970** · final 755 · footer 110.

## 3. 접근성

- **미명명 폼 컨트롤 0개** (`labels`/`aria-label`/`aria-labelledby`/`title` 중 하나 이상 보유).
- **중복 id 0개.**
- **focus-visible**: 포커스 가능한 요소 17개 전부 가시적 포커스 링 보유.
  (`🔒 항상 포함` 버튼은 `disabled` 속성이 정상적으로 걸려 브라우저가 탭 순서에서 제외하고 포커스도 받지
  않으므로 대상이 아니다 — 최초 검출은 `disabled`를 걸러내지 않은 스크립트의 오탐이었다.)
- **키보드만으로 모달 조작**: 트리거 버튼에 포커스 → `Enter`로 열림 → 포커스가 첫 필드(`consultOrgName`)로
  이동 → `body`에 `consult-lock` 적용 → `Escape`로 닫힘 → **포커스가 트리거 버튼으로 정상 복귀**(body 유실 없음).
- **honeypot 탭 제외**: `consultWebsite`가 `tabindex="-1"` + `visibility:hidden` 두 독립 메커니즘으로
  탭 순서에서 제외됨(`effectiveTabIndex: -1`). 실제 Tab 키 이동도 `consultOrgName → consultOrganization`으로
  건너뛰는 것 확인.
- **대비**(WCAG 상대휘도 계산, AA 기준 4.5:1):
  - `.availability-note` `#b7c5c0` on `#0f1714` → **10.4:1**
  - `.consult-privacy` `#b7c5c0` on `#132c25` → **8.3:1**

## 4. 다크 모드

`.theme-toggle`로 전환 시 `data-theme` 및 `aria-pressed`가 정확히 반영되고, 배경/전경색이 실제로 변경되며
오버플로가 발생하지 않음. 라이트/다크 모두에서 `#availability` 카드 2개 정상 렌더.

## 5. 무로그인 데모 격리 (핵심 안전 요구사항)

- `index.html` 데모: 4단계 자동 재생 완주(`리포트 완성`), 위험 단계에서 위기 카드 표시 —
  `🛡 지금 안전이 가장 중요해요 / 자살예방 상담전화 109 · 24시간 무료 · 위급하면 112/119`.
  **콘솔 에러·경고 0건.**
- `doctor.html?demo=1`: 발생한 네트워크 요청을 전수 열거한 결과 **총 1건(CDN의 supabase-js 라이브러리 로드)이며
  `supabase.co` 프로젝트 API 호출 0건, Solar 백엔드 호출 0건.** 새로고침 2회 후에도 렌더 결과가 완전히 동일
  (590자 → 590자, 중복·오류 상태 없음). "가상" 라벨과 "진단이나 응급 알림이 아니라" 고지 모두 표시.

## 6. 로그인 게이트 (핵심 안전 요구사항)

`app.html`을 세션 없이 로드:

- 로그인 오버레이가 `position:fixed`, `z-index:100`, **완전 불투명**(`rgb(13,20,18)`)으로 뷰포트 전체를 덮고,
  뷰포트 5개 지점 hit-test가 **모두 오버레이 내부**로 떨어짐 → 아래 채팅 DOM이 실제로 노출되지 않음.
- 채팅 영역 텍스트 0자, 버블 0개, 입력값 없음 → **로그인 전 환자 데이터 노출 0건.**
- 회원가입 폼 컨트롤(`authPw2`, `authHint`)이 **CSS로 숨겨진 게 아니라 DOM에 아예 존재하지 않음**.
- 가입 차단 탭 → "현재는 지정된 테스트 참여자만 이용할 수 있습니다." 안내 표시, 로그인 폼 숨김.
  로그인 탭 복귀 시 폼 정상 복원.
- 권한 없음 화면(`accessDeniedView`) 마크업 존재, 기본 숨김, 문구 확인:
  "로그인은 확인됐지만 현재 테스트 이용 권한이 없습니다."

## 7. 기관 도입 상담 폼

- 필드 12개 전부 라벨 보유. 요구된 항목이 모두 존재하고 필수/선택이 의도대로 설정됨
  (기관명·기관유형·담당자명·업무용이메일·도입목적·규모·문의내용·동의 = 필수 / 연락처·희망일정 = 선택).
- **환자 실명·진단명·진료기록·주민번호를 요구하는 입력 0개**, 첨부파일 입력 없음.
- 금지 안내문 표시 확인: "주민등록번호, 환자 실명, 진료기록, 의료영상, 처방전 등 민감정보와 첨부파일은 받지 않습니다."
- 잘못된 이메일 형식 → 인라인 오류 표시, 결과 영역이 성공처럼 바뀌지 않음.

### 발송 실패 시 정직성 (가장 중요한 검증)

백엔드가 실패하는 조건에서 제출한 결과:

| 항목 | 결과 |
|---|---|
| 상태 배너 클래스 | `consult-status on err` |
| 상태 배너 문구 | "현재 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요." |
| LLM 안내 영역 | 로컬 폴백 안내 정상 표시(447자, "적합도"/"추천 파일럿" 포함) |
| 제출 버튼 | 재활성화됨(사용자가 막히지 않음) |
| **거짓 성공 표시** | **없음** |

즉 발송 실패는 실패로 표시되고, 동시에 LLM 안내는 폴백으로 유지되어 화면이 깨지지 않는다.

## 8. 콘솔 에러

**공개 경로(무로그인 데모·랜딩)와 `app.html` 로그인 화면 모두 콘솔 에러·경고 0건.**

QA 중 관측된 콘솔 에러는 전부 **테스트 하네스 artifact**였고 앱 버그가 아니다. 정직하게 기록해 둔다:

1. `127.0.0.1:3100`으로의 CORS 실패 4건 — 이 포트를 다른 프로젝트의 Next.js 개발 서버가 점유하고 있어
   우리 경로에 404를 반환했다. 프론트는 localhost에서 백엔드를 3100으로 해석하므로 발생. 오히려
   "백엔드는 살아있지만 응답이 실패"하는 더 엄격한 조건이 되어 위 7절 정직성 검증에 유리했다.
2. `mindhub-mvp.onrender.com`으로의 CORS 실패 2건 — 처음에 정적 서버를 **4199** 포트로 띄웠는데 이 포트가
   백엔드 Origin allowlist(3000/3100/4173/8000)에 없어서 거부됐다. allowlist에 포함된 **4173**으로 다시
   측정하니 콘솔 에러 0건. 운영 백엔드가 `http://127.0.0.1:4173`에 대해 `access-control-allow-origin`을
   실제로 반환하는 것도 확인했다(Solar 토큰을 쓰지 않는 `/health` 호출).

브라우저의 CORS/네트워크 오류 로그는 JS로 억제할 수 없으므로, "콘솔 에러 0"은 백엔드가 정상 응답하는
환경에서만 성립한다는 점을 명시해 둔다.

---

## QA에서 발견해 수정한 이슈 (2건)

### 1. 다크 모드에서 "제한됨" 카드의 시각적 구분 손실 (이번 작업이 만든 회귀)

`:root[data-theme="dark"] .availability-card{background:var(--paper)}` 일괄 지정이 라이트 모드의
`.availability-card.closed{background:var(--soft)}` 구분을 덮어써서, 다크 모드에서 공개 카드·제한 카드·본문
배경이 **모두 `#0f1714`로 동일**해지고 테두리만 남았다(제한 상태의 muted 표현 소실).

수정: `:root[data-theme="dark"] .availability-card.closed{background:var(--soft)}` 추가.
검증 후 다크 모드 제한 카드 `rgb(21,31,27)` vs 공개 카드/본문 `rgb(15,23,20)`로 구분 회복, 라이트 모드 불변.

### 2. 푸터 링크 탭 타깃 미달 (기존 이슈)

푸터 링크 3개가 높이 18px로 WCAG 2.5.8(AA) 최소 24px에 미달. 문장 안 인라인 링크가 아니라 독립 링크라
인라인 예외가 적용되지 않는다. (`#proof` 섹션의 출처 링크 4개는 문장 내 인라인이라 예외 적용 대상이므로 제외.)

수정: `.footer-links a{display:inline-flex;align-items:center;min-height:24px;padding:3px 0}` —
글자 크기는 유지하고 수직 패딩만 확보. 검증 후 라이트/다크 모두 3개 링크 전부 24px.

두 수정 모두 Playwright 회귀 테스트로 고정했다(`tests/e2e/index.spec.js`).

## 오탐으로 판정한 항목 (2건)

- **"로그인 전 채팅 UI 노출"**: computed style만 본 초기 스크립트가 오버레이 아래 DOM을 visible로 보고했으나,
  hit-test와 불투명도 측정으로 실제 노출이 없음을 확인. 채팅 영역에 데이터도 0건.
- **"포커스 링 없는 버튼 1개"**: 해당 버튼은 `disabled`가 정상 적용되어 애초에 포커스 대상이 아니었다.

## 자동 테스트 현황

- backend: `cd backend && npm test` → **65/65 통과**
- static: `npm run build` → 통과(HTML 3개, JS 9개)
- e2e: `npm run test:e2e` → **44/44 통과**(desktop + mobile 프로젝트, 위 회귀 테스트 2건 포함)

## 이번 QA 범위에서 하지 않은 것

- 실제 테스트 계정 로그인 후의 채팅·리포트 흐름 — closed-beta 마이그레이션이 운영에 적용되지 않았고
  계정 승인도 되지 않았으므로 불가(USER ACTION PACK 이후 검증 항목).
- 실제 Solar 호출, 실제 이메일 발송 — Hard Stop.
- 운영 도메인(`mindhub.forblune.com`) 대상 QA — 현재 운영에는 이번 변경이 배포되지 않았으므로
  로컬 `rc` 상태를 대상으로 했다.

---

## 재검증 추가 (2026-07-26)

기존 검증(위 내용)은 코드 변경이 없어 그대로 유효합니다. 이번 재개 세션에서 추가한 것만 기록합니다.

### 신규 뷰포트

| 폭 | 오버플로 | 뷰포트 이탈 요소 |
|---|---|---|
| 375px | 0px | 0개 |
| 430px | 0px | 0개 |

기존 360/390/640/820/1280px 결과와 함께 총 7개 폭 전부 오버플로 0.

### `prefers-reduced-motion: reduce`
CSS에 해당 미디어쿼리 규칙이 존재함을 확인(`index.html`).

### WebKit 브라우저 추가

`playwright.config.js`에 `webkit`(Desktop Safari 에뮬레이션) 프로젝트를 신규 추가했습니다.

- **단일 워커 실행**: 전체 통과. 재현 확인을 위해 두 차례 개별 재실행했고 각각 통과.
- **4-worker 병렬 실행**: 63/66, 21/22 등 실행마다 **다른 테스트가** 간헐적으로 실패.
  같은 테스트가 반복 실패하지 않고 매번 다른 지점에서 실패한다는 사실 자체가 결정적 버그가 아니라
  **리소스 경합(WebKit 인스턴스가 무거워 병렬 워커 다수 실행 시 CPU 경합 발생)** 임을 뒷받침합니다.
  실패했던 개별 테스트를 단일 워커로 재실행하면 매번 통과했습니다.
- **결론**: 제품 코드에 WebKit 전용 결함 없음. CI에서 webkit 프로젝트만 낮은 workers 수
  (예: `npx playwright test --project=webkit --workers=2`)로 실행할 것을 권고(선택 사항).

### 마이그레이션 재검증

파일이 지난 검증(`837790f`) 이후 변경되지 않았음을 diff로 확인 후, 로컬 Postgres에서 대표 시나리오만
재실행(전체 25개 재실행 대신 파일 불변 증명 + 핵심 시나리오로 효율화):

- 마이그레이션 2회 연속 적용 — 멱등 확인
- 기존 사용자 `pending` 자동 백필 확인
- `service_role` 승인 → `has_beta_access()`=true → `entries` INSERT 성공
- **ROLLBACK 실행 후 신규 가입 정상 동작** (지난 세션에서 수정한 결함의 회귀 없음 재확인)

전부 PASS. 25개 전체 시나리오의 상세 근거는 `docs/architecture/CLOSED_BETA_ACCESS.md`에 그대로 유지.

### hotfix(PR #25) 독립 재리뷰

- 변경 파일 정확히 3개(`backend/server.js`, `backend/static-files.js`, `backend/static-files.test.js`), RC 전용
  식별자(`has_beta_access`, `app_access_grants`, `solar-pro3`, `RESEND_API_KEY`, `adoption-inquiry`) 혼입 0건
- 로컬 실서버로 허용 4파일(200) / 차단 17경로(404, 전부 ~150바이트 기본 404 페이지, 실제 내용 유출 0) /
  우회 11종(traversal·인코딩·대소문자·중복 slash·null byte·query string) + HTTP 메서드 6종 전부 차단 재확인
- API 회귀 없음(`/health` 200, `/chat` Origin 없음 403·허용 Origin 무인증 401, `/extract` 동일)
- backend 73/73 재확인

### hotfix→main→RC 동기화 재시뮬레이션

동일한 결과 재확인: `backend/server.js` 1곳 충돌(HEAD/RC 유지로 해결), 해결 후 트리 해시가 RC와 완전 동일,
회귀 없음. 원격 브랜치는 변경하지 않음.

---

## WebKit 플레이키니스 근본 원인 및 수정 (2026-07-26, 후속)

앞선 재검증에서 "제품 결함 아닌 리소스 경합"으로 판정했던 WebKit 간헐적 실패를 더 깊이 조사한 결과,
**실제로 재현 가능한 테스트 버그**를 하나 발견해 수정했습니다.

### 근본 원인

`tests/e2e/index.spec.js`가 `#demo` 섹션으로 `page.locator("#demo").scrollIntoViewIfNeeded()`를 호출한 뒤
곧바로 별도 `.click()`을 실행했습니다. `index.html`은 `html{scroll-behavior:smooth}`(전역)를 쓰는데,
`scrollIntoViewIfNeeded()`는 스크롤 애니메이션이 끝나길 기다리지 않고 즉시 반환됩니다. WebKit에서
간헐적으로(4회 중 1회꼴) 이 스크롤이 아직 끝나지 않은 상태에서 뒤이은 `.click()`이 실행돼 버튼을
놓쳤습니다 — 실패 시 `#reportReady`가 8초 타임아웃 내내 `"대기 중"`(초기값)에 머물러 있었는데, 이는
클릭이 `runDemo()`를 아예 트리거하지 못했다는 명확한 증거였습니다.

### 수정

수동 `scrollIntoViewIfNeeded()` 호출 3곳을 전부 제거했습니다. Playwright의 `.click()` 자체가 actionability
프로토콜의 일부로 요소를 스크롤하고 **위치가 안정될 때까지 대기**하므로, 별도 수동 스크롤보다 더 견고합니다.

### 검증

- 실패했던 테스트를 수정 후 단일 워커로 5회 연속 재실행 → 5/5 통과
- WebKit 전체 스위트(22개) 단일 워커로 재실행 → **22/22 통과**
- Chromium·mobile-chrome도 회귀 없음(44/44)

### 조사 중 발견한 것: 세션 리소스 경합은 실재했다

첫 수정 직후에도 다른 테스트가 산발적으로 실패해 "리소스 경합"으로 잠정 판정했었습니다. 이후 `ps aux`로
실제 프로세스를 확인한 결과, 이 세션에서 MCP 도구(Playwright MCP, Chrome DevTools MCP)가 남긴 Firefox·
Chrome 헬퍼 프로세스가 10개 이상 떠 있었습니다(이 코드베이스나 e2e 테스트와 무관, 세션 내 다른 브라우저
자동화 도구의 잔여 프로세스). 이것이 CPU를 다투면서 타이밍에 민감한 assertion을 흔들었을 가능성이 있고,
실제로 그 프로세스들을 건드리지 않은 깨끗한 재실행에서는 WebKit이 22/22 안정적으로 통과했습니다.

**결론**: 스크롤+클릭 경합은 실제 테스트 버그였고 수정했습니다. 그 위에 세션 특유의 프로세스 경합이 더해져
증상이 더 산발적으로 보였을 뿐입니다. 둘 다 제품 코드(index.html/app.html/doctor.html/backend)의 결함은
아니었습니다.

---

## 운영 반영 검증 (2026-07-26) — PR #25 병합·배포

**승인 및 실행**: 사용자가 PR #25 병합과 Render 운영 배포를 명시적으로 승인.

### 병합
- PR #25: `MERGED` (squash), merge commit `70ae7526a1b0c307b847c25dbd2cafbd0f566638`
- 새 main SHA: `70ae752` (기존 `dca3adc`)
- diff가 예상한 3파일과 정확히 일치(+11/-2, +10, +26) — squash 특성상 커밋 그래프상 조상 관계는
  아니지만 내용은 hotfix 브랜치와 동일함을 확인

### Render 자동 배포
- rootDir=backend 필터를 통과하는 변경이므로 자동 배포 트리거 예상대로 발생
- `/.git/HEAD` 노출 SHA가 `f907a727`(구버전)에서 사라지는 시점을 폴링해 배포 반영 확인
- Manual Deploy **불필요** — 자동 배포로 충분

### 운영 보안 검증 (배포 후, 실제 프로덕션)

| 항목 | 결과 |
|---|---|
| `/health` | 200 `ok` |
| `/index.html` `/app.html` `/doctor.html` `/favicon.png` | 전부 200 |
| `/.git/HEAD` `/.git/index` `/.git/config` `/.git/packed-refs` `/.git/logs/HEAD` `/.git/refs/heads/main` | 전부 404 |
| `/backend/server.js` `/backend/static-files.js` `/backend/package.json` | 전부 404 |
| `/README.md` `/CLAUDE.md` `/.env` `/.env.example` `/package.json` | 전부 404 |
| `/supabase/migrations/20260725120000_closed_beta_access.sql` | 404 |
| 404 응답 본문 | 전부 ~150바이트 기본 404 페이지, 실제 파일 내용 유출 0 |
| `/chat` Origin 없음 | 403 (회귀 없음) |
| `/chat` 허용 Origin, 무인증 | 401 (회귀 없음) |
| 공개 홈페이지(`mindhub.forblune.com`) | 200, 정상 렌더 |
| 무로그인 데모 | 4단계 완주, 109 위기 카드 표시 |
| `doctor.html?demo=1` | 가상 리포트·"가상" 라벨·안전 고지 정상 |
| 콘솔 오류 | 0건 |

**결론: 전부 PASS. rollback 불필요.** 첫 헬스체크 시도가 90초 타임아웃 없이 응답이 없었던 것은
Render 무료 티어 cold start(사전 warm-up 부재)였고, 재시도에서 즉시 응답했습니다 — 검증 자체는
warm 상태에서 안정적으로 재현됐습니다.

### RC 동기화
- `rc/mindhub-recovery`에 새 main(`70ae752`) 병합
- `backend/server.js` 1곳 충돌 — 사전 시뮬레이션과 정확히 동일한 형태, 동일한 방식(HEAD/RC 유지)으로 해결
- 병합 후 트리가 병합 전 RC와 **완전 동일**(0줄 차이) — 기능 중복 0, 회귀 0. 사전 시뮬레이션이 실제와 정확히 일치했음을 재확인
