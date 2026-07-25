# MindHub 복구 RC 상태

> 마지막 갱신: 2026-07-25 (자율 복구 루프)
> 상태 단위: `NOT_STARTED` / `IN_PROGRESS` / `REVIEW` / `PASS` / `BLOCKED` / `HARD_STOP`

## 기준점

| 항목 | 값 |
|---|---|
| 운영 main | `dca3adc` (이번 작업 내용 **미반영**) |
| RC 브랜치 | `rc/mindhub-recovery` |
| 긴급 hotfix | `hotfix/render-static-file-exposure` (base: main) |
| 열린 PR | **#25** hotfix→main, **#24** rc→main (둘 다 미병합) |
| 병합 완료 PR | #16~#23 (전부 rc 내부) |
| 열린 Issue | #11~#15 (rc→main 병합 시 자동 close 예정) |
| Supabase | ref `vhxvqtbemahbcbrbnkcv` — 마이그레이션 **미적용**, `app_access_grants` 없음 |

**현재 운영에 남아 있는 위험**: 저장소 정적 파일(`.git` 포함) 노출, 무제한 신규 가입.

---

## 작업별 상태

### T1. 운영 저장소 파일 노출 긴급 차단 — `PASS`(코드) / `HARD_STOP`(배포)

- **목적**: Render가 `express.static(__dirname/..)`로 저장소 전체(`.git`, 백엔드 소스, SQL)를 서빙하는 문제 차단.
- **시작 기준 커밋**: `dca3adc` (origin/main)
- **변경 파일**: `backend/server.js`(static 마운트 → allowlist 라우트), `backend/static-files.js`(신규),
  `backend/static-files.test.js`(신규) — main 대비 3파일 45줄 추가.
- **테스트**: backend 16/16 PASS. 실제 ephemeral 서버로 허용 4경로 200 / 차단 18경로 404 확인.
  우회 시도(traversal 8종·대소문자·중복 slash·query·null byte·5개 HTTP 메서드) 전부 차단, 본문 유출 0.
- **증거**: PR #25 본문의 검증 표
- **현재 상태**: PR #25 생성, **미병합**. 코드는 완료.
- **남은 위험**: 배포 전까지 운영에서 계속 노출됨.
- **다음 작업**: 사용자 승인 → main 병합 → Render 배포 (USER ACTION STEP 1)

### T2. Git 전체 이력 시크릿 감사 — `PASS`

- **목적**: 커밋 이력에 실제 시크릿이 들어간 적 있는지 확인, 키 회전 필요 여부 판정.
- **범위**: 모든 ref / 커밋 115개 / blob 264개 (삭제된 파일의 과거 버전 포함)
- **결과**: **CRITICAL 0건.** 커밋된 자격증명은 Supabase anon key뿐(고유 2개, 둘 다 `role=anon`,
  올바른 project ref). **service_role 토큰 0건.** 키 회전·이력 재작성 불필요.
- **증거**: `docs/security/GIT_HISTORY_SECRET_AUDIT.md`
- **남은 위험**: 없음. 예방 목적의 CI 시크릿 스캐너 도입은 권고 사항으로만 기록.

### T3. hotfix ↔ RC 동기화 시뮬레이션 — `PASS`

- **목적**: hotfix가 main에 병합된 뒤 RC와 충돌하는지, 기능이 중복 적용되는지 사전 확인.
- **방법**: `git merge-tree` + 로컬 임시 브랜치 실제 병합(원격 미변경, 검증 후 삭제)
- **결과**:
  - hotfix → main: **충돌 없음**, `origin/main`의 직계 자손이라 fast-forward 가능.
  - 갱신된 main → RC: `backend/server.js` 1곳 충돌. 원인은 사소함 — `isPublicStaticFile` require는
    충돌 구간 **밖에서 자동 병합**되고, 충돌은 "RC에만 있는 추가 require들을 hotfix가 삭제하려는 것인지"
    git이 판단 못 해서 발생. **HEAD(RC) 쪽 유지**로 해결.
  - 해결 후 **트리 해시가 RC와 완전히 동일**(`38c811d44f19`) → 기능 중복 적용 없음, 회귀 없음,
    PR #24 diff는 자연스럽게 축소됨.
- **테스트**: 시뮬레이션 병합 상태에서 backend 65/65, e2e 44/44, static PASS
- **다음 작업**: 실제 병합 시 위 해결 방식 적용(절차는 `docs/rc/DEPLOYMENT_RUNBOOK.md`)

### T4. Supabase closed-beta 마이그레이션 최종 검토 — `PASS`(검증) / `HARD_STOP`(운영 실행)

- **목적**: 기본 거부 접근 통제가 실제로 의도대로 동작하는지, 롤백이 실제로 되는지 확인.
- **변경 파일**: `supabase/migrations/20260725120000_closed_beta_access.sql`
- **테스트**: 로컬 임시 PostgreSQL 16에 라이브 스키마 재현(Supabase의 `ALTER DEFAULT PRIVILEGES`,
  `service_role BYPASSRLS` 포함) → **25개 시나리오 전부 PASS**, 2회 연속 적용해 **멱등성 확인**.
- **검증 중 발견해 수정한 결함 2건**:
  1. `service_role`에 명시적 GRANT가 없어 Supabase 기본 권한에 암묵 의존 → 설정이 다르면
     **아무도 승인할 수 없는 잠금 상태** 위험. 명시적 GRANT 추가.
  2. ROLLBACK 블록이 `handle_new_user()` 복원을 주석으로만 언급 → 실행하면 트리거가 삭제된 테이블을
     참조해 **신규 가입 전면 실패**. 실제로 재현 후, 함수 복원을 테이블 삭제보다 먼저 수행하도록 포함.
     수정 후 "롤백 후 신규 가입 정상 동작"까지 확인.
- **증거**: `docs/architecture/CLOSED_BETA_ACCESS.md` 확장 검증 절
- **남은 위험**: 의사 계정은 beta 승인 없이도 리포트 조회 가능(의도된 설계, 근거는 위 문서에 명시).
- **다음 작업**: 사용자가 SQL Editor에서 실행 (USER ACTION STEP 2)

### T5. Auth 가입 차단 절차 — `PASS`(코드·문서) / `HARD_STOP`(대시보드 설정)

- **목적**: 신규 가입을 막고 지정 계정만 진입, 잠금 사고 방지 순서 확립.
- **코드 검증**:
  - 프런트: 가입 폼 컨트롤이 **DOM에 존재하지 않음**(`authPw2`/`authHint` 없음, CSS 숨김 아님).
  - 프런트: 로그인 성공 후 `has_beta_access()` 재확인 → 미승인 시 제한 안내 화면.
  - 백엔드: `/chat`·`/extract`에 `requireBetaAccess` 적용(미승인 403 `beta_access_required`).
  - DB: `entries` RLS에 `has_beta_access()` 조건 → anon key로 REST 직접 호출도 차단.
- **테스트**: e2e 8건(가입 차단 UI), backend 5건(requireBetaAccess), DB 매트릭스 25건
- **다음 작업**: 대시보드 설정 (USER ACTION STEP 2) — **순서 주의: 승인 먼저, 가입 차단 나중**

### T6. Solar Pro 3 전환 준비 — `PASS`

- **목적**: 기본 모델 갱신과 장애 시 안전 동작 확인.
- **변경 파일**: `backend/server.js`(기본값 `solar-pro3`), `.env.example`, `README.md`, `backend/README_배포.md`
- **테스트**: 신규 `backend/solar-failure.integration.test.js` **8/8 PASS** — 실제 HTTP로 검증:
  Upstage 401→502, 429→502, 5xx→502, 타임아웃→504, 네트워크 오류→500(업스트림 원문·내부 경로 미노출),
  형식 깨진 응답→모든 신호 null(추측 금지), 범위 초과 값→경계 검사로 폐기,
  **요청 모델이 `SOLAR_MODEL`(기본 `solar-pro3`) 그대로 전달되고 몰래 다른 모델로 대체되지 않음**.
- **실제 Solar 호출**: **0회** (전부 스텁)
- **다음 작업**: Render 환경변수 등록 + 운영 smoke test에서 **최대 1회** 호출

### T7. 기관 도입 상담 이메일 준비 — `PASS`(mock) / `HARD_STOP`(Resend·실발송)

- **목적**: 실제 문의가 운영자 이메일로 전달되는 경로 구축, 실패를 성공으로 위장하지 않음.
- **변경 파일**: `backend/adoption-inquiry.js`, `backend/server.js`(`POST /adoption-inquiry`), `index.html`
- **테스트**: backend 18건 + HTTP 통합 4건. 로컬 실측: 필수 누락 400, 비허용 Origin 403,
  32KB 초과 413, honeypot→발송 시도 없이 200 위장, **Secret 없음→정직한 503**, 6회째 429.
- **정직성**: 브라우저 QA에서 실패 조건을 실제로 만들어 **거짓 성공 표시 0건** 확인
  (상태 배너 `err` + LLM 안내는 로컬 폴백 유지 + 버튼 재활성화).
- **증거**: `docs/architecture/ADOPTION_INQUIRY_EMAIL.md`, `docs/qa/MINDHUB_RECOVERY_QA.md` 7절
- **실제 이메일 발송**: **0회**
- **다음 작업**: Resend 설정 + Render 환경변수 (USER ACTION STEP 2), 운영에서 **최대 1회** 발송 테스트

### T8. 공개 홈페이지·안전 문구 — `PASS`

- **목적**: 실제 의료 서비스로 오해되지 않게, 현재 공개 범위를 명확히.
- **변경 파일**: `index.html`(`#availability` 섹션 추가, CTA 톤 조정), `app.html`, 문서 다수
- **테스트**: e2e 44/44 (`app.html` 링크 3곳 전부 "비공개 테스트 로그인" 라벨 검증 포함)
- **증거**: `docs/security/MINDHUB_PUBLIC_DEMO_SAFETY.md`

### T9. 브라우저 QA — `PASS`

- **목적**: 반응형·접근성·다크모드·오류 상태 검증.
- **결과**: 5개 폭(360/390/640/820/1280) 오버플로 0px, 미명명 입력 0개, 중복 id 0개,
  포커스 링 17/17, 데모의 Supabase·Solar 호출 0건(resource timing 전수 확인),
  로그인 전 환자 데이터 노출 0건, 공개 경로 콘솔 에러 0건.
- **발견·수정 2건**: 다크 모드 제한 카드 대비 회귀(제가 만든 것), 푸터 탭 타깃 18px→24px.
- **오탐 판정 2건**: "로그인 전 채팅 노출"(오버레이가 불투명 전체 덮음, 데이터 0건),
  "포커스 링 없는 버튼"(`disabled`라 애초에 포커스 대상 아님).
- **증거**: `docs/qa/MINDHUB_RECOVERY_QA.md`

### T10. 배포·롤백 dry-run — `PASS`

- **증거**: `docs/rc/DEPLOYMENT_RUNBOOK.md`
- **다음 작업**: 사용자 승인 후 실행

---

## 자동 테스트 현황 (RC 기준)

| 항목 | 결과 |
|---|---|
| `cd backend && npm test` | **73/73 PASS** (3회 반복 안정) |
| `npm run build` (static 검증) | PASS |
| `npm run test:e2e` | **44/44 PASS** (desktop + mobile) |
| DB 마이그레이션 시나리오 | **25/25 PASS** (로컬 임시 Postgres) |
| 시크릿·PII 스캔 | PASS (CRITICAL 0건) |

## HARD_STOP 목록 (사용자 작업 필요)

1. hotfix PR #25 병합 + Render 배포
2. Supabase 마이그레이션 실행
3. 테스트 계정 승인 (**가입 차단보다 먼저**)
4. Supabase Auth 가입 차단 설정
5. Resend 계정·발신 주소 검증·API key
6. Render 환경변수 등록/갱신
7. PR #24 병합 + GitHub Pages·Render 배포
8. 운영 smoke test (실제 Solar 최대 1회, 실제 이메일 최대 1회)

절차는 `docs/rc/DEPLOYMENT_RUNBOOK.md`, 요약은 최종 보고의 USER ACTION PACK.
