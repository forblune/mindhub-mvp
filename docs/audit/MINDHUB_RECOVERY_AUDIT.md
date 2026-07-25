# MindHub 복구 현황 감사 (2026-07-25)

> 코드 수정 전 read-only 감사. Supabase MCP(read-only), Chrome DevTools MCP(운영 사이트),
> GitHub MCP, 로컬 코드 리딩으로 수집. 실제 이메일·UID는 기록하지 않고 개수만 남긴다.

## 요약

- **핵심 문제 확인**: `app.html`은 이메일/비밀번호 가입과 카카오 로그인을 아무 승인 절차 없이 허용한다.
  가입 즉시 실제 Solar/OpenAI 백엔드를 호출하고 실제 Supabase `entries`에 쓰는 진짜 환자 앱으로 들어간다.
  "지정된 내부 테스트 사용자만 로그인 가능" 요구사항은 현재 전혀 구현돼 있지 않다.
- **Supabase 보안 자체는 견고함**: RLS 활성화, role 상승은 RLS뿐 아니라 컬럼 단위 GRANT로도 차단되어 있다
  (`authenticated`는 `profiles.role`에 UPDATE 권한 자체가 없음). Advisor는 WARN만 있고 CRITICAL/HIGH 없음.
- **감사 중 별도로 발견한 심각한 운영 이슈(긴급)**: Render 백엔드가 `express.static(path.join(__dirname,".."))`로
  저장소 루트 전체를 정적 서빙 중이라, 운영 서버에서 `.git/HEAD`, `.git/logs/HEAD`, `.git/index`,
  `.git/refs/heads/main`, `.git/packed-refs`가 실제 내용으로 200 응답한다. `backend/server.js`,
  `SUPABASE_보안강화_20260619.sql` 등도 그대로 읽힌다. GitHub 저장소가 이미 public이라 신규 비밀 유출 위험은
  낮지만, 프롬프트·rate limit 값·검증 로직 등 내부 구현이 origin에서 그대로 노출되고 있어 우선 수정 대상이다.
- **로컬 `main`이 `origin/main`보다 31커밋(약 5주치) 앞서 있고 push되지 않았다.** GitHub Pages/Render 배포는
  `main` push에 연동되므로, 이번 작업에서는 `origin/main`에 절대 push하지 않는다(운영 배포 Hard Stop과 동일 위험).
- `기관 도입 상담`은 현재 이메일 발송이 아니라 **LLM이 즉석에서 답을 생성해 화면에 보여주는 기능**이며, 이름/기관명/연락처를
  아예 입력받지 않는다. 실제 리드 캡처·이메일 알림은 완전히 새로 만들어야 하는 기능이다.

---

## A. 공개 프런트 (index.html / app.html / doctor.html)

### index.html (1238줄) — 공개 랜딩 + 무로그인 데모 + 도입 상담 모달
- 섹션 순서(위→아래): nav → hero(512) → story-band(547) → `#problem`(572) → `#flow`(599) →
  `#demo`(635) → `#proof`(709, Solar 근거 4개 외부 링크 포함) → `#business`(765, 목표 KPI는 미검증 명시) →
  최종 CTA(797) → footer(814) → 숨겨진 도입 상담 모달(825-899).
- 무로그인 데모(906-1067)는 완전히 로컬 스크립트: `fetch`/`BACKEND_URL`/Supabase 호출이 전혀 없음(직접 grep 확인).
  위험 신호 스텝(DEMO_STEPS[3])도 정적 크리시스 카드만 띄움.
- 회원가입 CTA는 없음(grep 결과 0건). 모든 링크가 "로그인 후 …" 문구.
- **도입 상담 모달은 이름/기관명/이메일/연락처 필드가 아예 없다.** 4개 select(기관유형/목표/규모/우선순위) + 선택 textarea만 받고,
  안내문에 "담당자 연락처·환자 정보를 넣지 말라"고 명시. `POST /adoption-consult` → OpenAI로 즉석 답변 생성, 실패 시 로컬 템플릿.
  **서버 저장도, 이메일 발송도 없음** — 요청서 7번 작업(이메일 발송)이 메워야 할 정확한 공백.
- 모바일 대응: viewport meta + 4개 media query(980/720/460px, prefers-reduced-motion) 존재 확인.

### app.html (1775줄) — 로그인 필수 환자 채팅 앱
- **보안 공백(핵심)**: `emailAuth()`(1649-1678)가 승인 절차 없이 `sb.auth.signUp()`을 직접 호출(1667).
  `kakaoLogin()`(1600-1603)도 동일하게 무제한. `is_doctor`/`approved`/`beta`/`invite`류 접근권한 개념이
  파일 전체에 전혀 없음(grep 0건) — doctor/patient role 분기 외 어떤 접근 게이트도 없다.
  가입 직후 `boot()`(1719-1762)이 `role==='doctor'`만 확인하고 나머지는 전부 `enterChat()`로 통과시킨다.
- anon key는 공개 설계이므로 **app.html만 고쳐서는 막을 수 없다** — Supabase Auth REST를 직접 두드리면 우회됨.
  진짜 차단은 (a) Supabase Auth 프로젝트 설정(가입 차단) + (b) `profiles` 승인 컬럼을 RLS/RPC로 강제하는
  서버 측 통제가 함께 있어야 한다.
- 위험 감지(`RISK_WORDS`, 592/1161)는 순수 동기 로컬 체크로 네트워크 의존 없음을 코드로 확인함(원칙 2 충족).
- `BACKEND_URL`(595) 호출 실패/시간초과 시 `mockReply()`(1186-1230)로 즉시 폴백, 채팅이 끊기지 않음(원칙 4 충족).
- 계정별 저장 분리(`storageScope`, 1526-1547)로 demo/계정별 localStorage 키가 분리돼 있음.
- 로그인 실패 문구는 이미 계정 존재 여부를 흘리지 않는 안전한 문구(`로그인 실패: 이메일/비밀번호를 확인해 주세요`, 1676) —
  이번 작업 요청서의 오류 문구 요구사항과 방향이 같아 재사용 가능.
- line 405 주석("?demo=1이면 건너뜀")은 실제로 대응하는 코드가 없는 오래된 주석 — 오해 소지가 있어 정리 필요(버그는 아님).

### doctor.html (516줄) — 의사 읽기 전용 대시보드
- `?demo=1`은 Supabase를 전혀 호출하지 않는 고정 fixture(가상 환자 "강하늘 (가상)")로 완전히 격리돼 있음.
- 실제 모드는 클라이언트 게이트(`profiles.role==='doctor'` 아니면 접근거부 화면) + DB 게이트(RPC 내부 `is_doctor()`)
  이중으로 막혀 있어 견고함.
- 환자별 공유 설정은 전부 `get_patient_report_entries` RPC(SECURITY DEFINER)에서 서버 측으로 강제되고, 원문 대화(`text`)는
  RPC가 항상 null로 반환 — doctor.html JS에는 별도 필터링 로직이 필요 없는 구조.
- 진단·응급 단정 문구 없음, "진단이나 응급 알림이 아니다" 고지 확인.
- 참고(버그 아님, 확인 필요): `loadPatients()`(380-394)가 RPC가 아닌 `profiles` 테이블을 직접 select — RLS만으로
  보호되는데, 이 repo의 SQL 파일에는 `profiles` SELECT 정책이 명시돼 있지 않아 리포지토리만으로는 완전히 검증 불가
  (Supabase 감사 결과 `own profile select`/`doctor reads profiles` 정책 존재 확인됨 — 정상).

---

## B. Supabase (프로젝트 ref `vhxvqtbemahbcbrbnkcv`, org Forblune, 대시보드명 "MindBridge")

- **ref 일치 확인.** 프론트(app.html/doctor.html)와 백엔드(server.js) 모두 동일 URL 사용 확인.
- **RLS**: `profiles`, `entries`, `posts` 세 테이블 모두 RLS ON. `rls_auto_enable()` 이벤트 트리거가 신규 테이블에
  자동으로 RLS를 켜는 안전망 역할.
- **역할 상승 차단**: RLS뿐 아니라 **컬럼 단위 GRANT**로 이중 차단됨 — `authenticated`는 `profiles.role`에 UPDATE
  권한 자체가 없고 `display_name`/`share_*` 컬럼만 있음. 환자가 자기 role을 doctor로 바꾸는 PATCH는 RLS 평가 전에
  권한 오류로 거부됨. `handle_new_user()`도 client meta에서 role을 읽지 않고 항상 기본값 `patient`.
- **entries**: INSERT/SELECT만 정책 존재(본인 것만), UPDATE/DELETE 정책 없음 → 사실상 추가 전용/불변.
- **의사 조회**: `get_patient_report_entries` RPC가 SECURITY DEFINER + 내부 `is_doctor()` 체크로 이중 보호,
  원문 대화 미노출, 공유 미설정 필드는 null. anon이 직접 호출해도 `auth.uid()`가 없어 0행.
- **advisor**: security/performance 모두 CRITICAL/HIGH 없음, WARN만: `set_updated_at` search_path 미고정,
  4개 SECURITY DEFINER 함수의 anon/authenticated EXECUTE 과다 노출(3/4는 실질적으로 악용 불가하나 불필요한 권한),
  leaked-password protection 꺼짐. 성능 WARN은 정보성(auth.uid() 반복 호출 등).
- **접근권한 관련 기존 구조 없음**: `is_doctor` 외에 `approved`/`beta`/`access_status`류 컬럼·함수가 전혀 없음 —
  closed-beta 게이트는 신규로 설계해야 함(요청서 6절 그대로 유효).
- **가입 사용자**: `auth.users` 총 3명, `auth.identities` provider 구성은 kakao 3 / email 1(한 계정은 카카오+이메일
  둘 다 연결된 것으로 보임). 실제 이메일/UID는 기록하지 않음. 브라우저 조사 중 우연히 실사용자 세션(display name
  "건희")이 로그인된 상태로 확인됨 — 이는 이번 감사가 만든 상태가 아니라 이전에 로그인된 세션이며, 접근권한 설계 시
  **이 기존 계정들에 자동으로 신규 권한을 부여하지 않는다**(요청서 명시 사항과 일치).
- **스키마 드리프트**: `list_migrations`가 완전히 비어 있음 — `SUPABASE_보안강화_20260619.sql`이 CLI 마이그레이션이
  아니라 SQL Editor로 수동 적용된 것으로 보이며, 실제 라이브 스키마와는 내용이 일치함(코드 드리프트 아님, 다만
  마이그레이션 이력 트래킹이 안 되고 있음).
- **무관한 테이블 발견**: `posts`(title/content/author_id 등, RLS 있음, 0 rows)는 CLAUDE.md 어디에도 설명되지 않는
  마음기록과 무관한 잔재로 보임 — 삭제 여부는 사용자 판단 필요(운영 스키마 변경은 Hard Stop이라 이번 작업에서는
  건드리지 않음, USER ACTION PACK에 후보로만 남김).
- Storage 버킷 0개(미사용), Edge Functions는 Postgres 카탈로그로는 확인 불가(대시보드/CLI 확인 필요).

---

## C. 인증 흐름 (운영 사이트 `https://mindhub.forblune.com` 실측)

- 무로그인 데모: 클릭 시 네트워크 로그에 백엔드 GET `/`(warm-up ping)만 찍히고 `/chat`·`/extract` POST나 Supabase
  쓰기가 전혀 없음 — 코드 감사와 일치.
- `doctor.html?demo=1`: 완전 비로그인, Supabase REST 호출 0건, 가상 환자로 명확히 라벨링됨.
- 가짜 계정으로 1회 로그인 시도 → Supabase Auth REST가 `400 invalid_credentials`, 화면에는
  "로그인 실패: 이메일/비밀번호를 확인해 주세요"만 노출(계정 존재 여부 비노출, 안전).
- 카카오 로그인 버튼 → `kauth.kakao.com/oauth/authorize`로 정상 리다이렉트, `redirect_uri`가
  `https://vhxvqtbemahbcbrbnkcv.supabase.co/auth/v1/callback`로 올바르게 스코프됨(1회 리다이렉트만 확인, 로그인은
  완료하지 않음).
- **결론(요청서 C절 핵심 질문에 대한 답)**: 그렇다, 지금 누구나 이메일/비밀번호 또는 카카오로 가입해 실제 채팅 앱에
  들어갈 수 있다. `/chat`·`/extract`는 "유효한 로그인"만 확인하지 "승인된 사용자"인지는 확인하지 않는다.

---

## D. Render 백엔드 (`https://mindhub-mvp.onrender.com`)

- `/health`: 200 "ok", 정보 노출 없음.
- 허용되지 않은 Origin → `/chat`·`/extract`·`/adoption-consult` 모두 인증·요금 발생 전에 **403 origin_not_allowed**로
  즉시 차단 확인.
- 허용 Origin이지만 인증 없음/가짜 토큰 → **401**(login_required / invalid_session), Solar 호출 전에 차단 확인.
- `/adoption-consult` 필수 필드 누락 → **400 invalid_consultation_input**(OpenAI 호출 전 차단).
- 약 40KB 본문 → **413 body_too_large**(요청 파싱 단계에서 차단, LLM 호출 안 됨).
- Rate limit 실제 작동 확인(429 + Retry-After) — 다만 **연속 요청 간 잔여 카운트가 단조 감소하지 않고 들쭉날쭉함**.
  Render 프록시 홉/Cloudflare 경유로 `req.ip` 판별이 흔들리거나 인스턴스 재시작 등으로 인메모리 버킷이 기대만큼
  일관되지 않을 가능성 — /chat·/extract도 같은 `makeRateLimiter`를 쓰므로 동일 약점 가능성 있음(직접 검증은
  실제 인증 토큰이 필요해 이번 감사 범위 밖).
- 에러 응답은 항상 안전한 JSON(`{error, message}`)이고 스택트레이스·내부 경로 노출 없음.
- **긴급 발견(요청 범위 밖, 사실 확인 중 발견)**: `server.js:344`의 `express.static(path.join(__dirname, ".."))`가
  저장소 루트 전체를 정적 서빙 중 — 운영 서버에서 `.git/HEAD`, `.git/logs/HEAD`, `.git/index`,
  `.git/refs/heads/main`, `.git/packed-refs`가 실제 git 내부 콘텐츠로 200 응답하는 것을 확인(Render의 clone 커밋
  reflog까지 노출). `backend/server.js`, `backend/adoption-consultation.js`, `SUPABASE_보안강화_20260619.sql`,
  `CLAUDE.md` 등도 그대로 읽힘. GitHub 저장소가 이미 public이라 "새로운 비밀 유출"은 아니지만, rate limit 값·검증
  로직·프롬프트 등 구현 세부가 GitHub을 거치지 않고 운영 origin에서 바로 노출되는 불필요한 공격 표면이다.
  → `docs/security/MINDHUB_PUBLIC_DEMO_SAFETY.md`와 이슈 `fix/backend-static-exposure`로 별도 추적, 코드는 이번
  작업에서 고치고 실제 재배포는 USER ACTION PACK으로 넘긴다(Render 운영 재배포는 Hard Stop).

---

## E. GitHub 저장소 (`forblune/mindhub-mvp`)

- 기본 브랜치 `main` 확인. 열린 issue 0, 열린 PR 0.
- `codex/*` 원격 브랜치 5개 존재 — 전부 2026-06-19 마지막 커밋, `origin/main` 대비 0 ahead / 21~29 behind
  (이미 merge되었거나 완전히 뒤처진 것으로 보임). **읽기만 했고 건드리지 않음.**
- `origin/main`에는 `.github/workflows/ci.yml`이 없다고 GitHub MCP가 보고했는데, 로컬에는 존재한다 — 이는 버그가
  아니라 **로컬 main이 origin보다 31커밋 앞서 있고(위 요약 참고) 그 커밋 안에 CI 워크플로 추가가 포함돼 있어서
  아직 push되지 않았기 때문**. 두 감사 결과가 서로 모순되지 않음.

---

## 종합 위험도 정리

| 위험 | 심각도 | 상태 |
|---|---|---|
| 승인 없는 자가 가입 → 실제 환자 앱 진입 | 높음 (요청서 핵심 목표) | 미해결, 신규 구현 필요 |
| Render가 `.git`·백엔드 소스 전체를 정적 서빙 | 높음 (감사 중 발견) | 코드 수정 예정, 재배포는 Hard Stop |
| rate limiter 카운트 불일치(프록시/인스턴스 원인 추정) | 중간 | 문서화, 이번 범위에서 구조 변경은 보류 |
| `posts` 테이블 잔재 | 낮음 | 사용자 판단 필요, 운영 스키마 변경은 Hard Stop |
| 도입 상담이 리드 캡처가 아님(이메일 미발송) | 중간 (요청서 핵심 목표) | 신규 구현 필요 |
| Supabase RLS/역할 상승 | 없음 | 이미 견고 |
| 무로그인 데모의 네트워크/DB 격리 | 없음 | 이미 견고 |
| 의사 화면의 비공개 필드 차단 | 없음 | 이미 견고(RPC 레벨) |

## 수정 범위(다음 단계로 이어짐)
1. `feat/closed-beta-access` — Supabase 접근권한 구조 신설 + app.html 게이트.
2. `fix/backend-static-exposure` — 정적 서빙 루트 축소(신규 발견, 긴급).
3. `feat/adoption-inquiry-email` — 실제 리드 캡처 + 이메일 발송(Resend, mock transport 포함).
4. `chore/solar-runtime-update` — `SOLAR_MODEL` 기본값 `solar-pro3`로 갱신.
5. `docs/mindhub-public-safety-copy` — 공개 홈페이지 섹션/문구 정리, 안전 고지 강화.

## 운영 변경이 필요한 항목(전부 USER ACTION PACK으로 넘김, Hard Stop)
- Supabase Auth: 신규 가입 정책, 이메일 확인 정책, Site/Redirect URL 재확인.
- Render: `SOLAR_MODEL`, `RESEND_API_KEY`, `ADOPTION_TO_EMAIL`, `ADOPTION_FROM_EMAIL` 등록/갱신, 재배포.
- `posts` 테이블 삭제 여부 결정.
- 기존 계정(auth.users 3명) 중 누구에게 closed-beta 권한을 수동 부여할지 결정.
