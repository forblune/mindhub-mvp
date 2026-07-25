# 자율 복구 루프 워크로그 (2026-07-25)

각 사이클: 계획 → 실행 → 검증 → 발견 → 수정 → 다음 판단

---

## 사이클 1 — 현재 상태 재검증 (Phase A)

- **계획**: 전달받은 상태를 맹신하지 않고 Git·GitHub·코드 실제 상태 재확인
- **실행**: 브랜치·커밋·PR·Issue 조회, 코드의 Supabase ref·Render URL·Solar 기본값·신규 엔드포인트 확인
- **검증**: `rc/mindhub-recovery` clean, origin/main 대비 48커밋, PR #16~#23 병합, PR #24 OPEN,
  Issue #11~#15 OPEN, ref `vhxvqtbemahbcbrbnkcv` 일치, `solar-pro3` 적용, `/adoption-inquiry` 존재
- **발견**: Issue가 열려 있는 것은 정상(rc 병합은 자동 close 트리거가 아님)
- **다음 판단**: 전달된 상태와 실제가 일치. Phase B로.

## 사이클 2 — 긴급 hotfix 분리 (Phase B)

- **계획**: `origin/main`에서 분기해 정적 노출 수정만 cherry-pick
- **실행**: `hotfix/render-static-file-exposure` 생성, `e5447c5` cherry-pick(정확히 3파일)
- **검증**: RC 식별자 8종(`app_access_grants`, `has_beta_access`, `solar-pro3`, `RESEND_API_KEY`,
  `adoption-inquiry`, `signupClosedNotice` 등) diff에 **0건** 확인 → 범위 오염 없음
- **발견**: cherry-pick으로 RC의 `require.main` 가드·`module.exports`가 따라오지 않음.
  이는 PR #21(테스트 추출) 산물이므로 hotfix에서 제외되는 것이 옳음.
- **다음 판단**: 확장 우회 검증으로.

## 사이클 3 — 차단·우회 검증

- **계획**: 완료 조건 경로 + 요청된 우회 변형 전수 검증
- **실행**: 로컬 실서버 기동, 허용 4경로 / 차단 18경로 / traversal 8종 / 대소문자 3종 /
  중복 slash / 디렉터리 / query string / null byte / 5개 HTTP 메서드 / HEAD
- **검증**: 허용 200, 차단 전부 404, 차단 응답 본문은 Express 기본 404 페이지(~150B)로 **파일 내용 0**
- **발견**: `OPTIONS /package.json` → 204. CORS preflight 응답이며 본문 없음 → 무해로 판정
- **수정**: 없음(설계가 이미 안전 — allowlist 검사가 `path.join` 앞)
- **다음 판단**: PR #25 생성 후 Phase C로

## 사이클 4 — Git 이력 시크릿 감사 (Phase C), 1차 실패

- **계획**: 모든 ref·커밋·blob 대상 패턴 스캔
- **실행**: blob 264개 열거 후 패턴 12종 검사
- **발견 (중대)**: **감사 도구 자체가 고장.** 패턴 목록 구분자 `|`가 정규식 내부 alternation과 충돌해
  "parentheses not balanced"로 일부 패턴이 **조용히 건너뛰어짐**. 보안 감사에서 이건 거짓 안심이 됨.
- **수정**: 구분자를 TAB으로 교체 + **실행 전 15개 패턴 컴파일 검증 단계 추가**
- **다음 판단**: 재실행

## 사이클 5 — 시크릿 감사 재실행, 2차 실패

- **실행**: 패턴 15종 전부 컴파일 확인 후 재스캔 → CRITICAL 0건, JWT/service_role REVIEW 검출
- **발견 (중대)**: JWT role 판별 파이프라인이 **0건 반환**. 그런데 "0건"은 진짜 clean과
  깨진 파이프라인이 구분되지 않음 → clean으로 판정하지 않고 원인 추적
- **원인**: `git cat-file --batch-check`는 포맷에 `%(rest)`가 있을 때만 입력을 `<sha> <path>`로 분리.
  인라인 버전에서 누락 → 전체 blob이 객체명 해석 실패
- **수정**: `%(rest)` 추가, 단계별 출력 건수 확인 습관화
- **다음 판단**: 재실행

## 사이클 6 — 시크릿 감사 확정

- **검증**: blob 264개, 고유 JWT **2개** 모두 디코드 → 전부 `role=anon`, ref 일치, **service_role 0건**.
  `service_role` 문자열 검출은 전부 "이 키를 쓰지 말라"는 산문 → false positive.
  Kakao 32-hex 0건, password 할당 0건, `.env` 커밋 이력 없음(`.env.example`은 모든 버전이 값 없음)
- **판정**: **키 회전 불필요, 이력 재작성 불필요**
- **문서**: `docs/security/GIT_HISTORY_SECRET_AUDIT.md` (감사 도구 버그 2건도 정직하게 기록)
- **다음 판단**: Phase D로

## 사이클 7 — hotfix ↔ RC 동기화 시뮬레이션 (Phase D)

- **계획**: 원격 미변경으로 병합 순서 시뮬레이션
- **실행**: `git merge-tree` → 임시 브랜치 `sim/rc-after-hotfix`에서 실제 병합
- **검증**: hotfix→main 충돌 없음·fast-forward 가능. main→RC는 `backend/server.js` 1곳 충돌
- **발견**: 충돌은 사소함 — `isPublicStaticFile` require는 충돌 구간 밖에서 자동 병합되고,
  충돌은 "RC 전용 require들을 hotfix가 삭제하려는지" git이 판단 못 한 것
- **수정**: HEAD(RC) 유지로 해결 → **트리 해시가 RC와 완전 동일**(`38c811d44f19`) = 기능 중복 0, 회귀 0
- **검증**: 병합 상태에서 backend 65/65, e2e 44/44, static PASS. 임시 브랜치 삭제, 원격 무변경 확인
- **다음 판단**: Phase E로

## 사이클 8 — 마이그레이션 확장 검증 (Phase E), 결함 2건 발견

- **계획**: 25개 시나리오(pending/approved/revoked/행없음/타인/cascade/의사RPC/멱등성)
- **실행**: 로컬 Postgres 16에 라이브 스키마 재현 후 매트릭스 실행
- **발견 1 (중대)**: 테스트 10~12·17~18 실패. 1차 원인은 stub이 Supabase의
  `ALTER DEFAULT PRIVILEGES`·`service_role BYPASSRLS`를 재현하지 않은 것.
  **그런데 stub을 고친 뒤에도 남는 진짜 문제**: 마이그레이션이 `service_role`을 주석에서만 언급하고
  명시적 GRANT가 없어 Supabase 기본 설정에 암묵 의존 → 설정이 다르면
  **아무도 승인할 수 없어 운영자까지 잠기는** 상황 가능
- **수정 1**: `grant select, insert, update, delete ... to service_role` 명시 추가.
  아울러 승인 UPDATE가 **조용히 0행** 갱신되는 것을 성공으로 오해하지 않도록 검증 9b 추가
  (사이클 5의 "빈 결과 = clean 아님" 교훈을 테스트에 반영)
- **발견 2 (중대)**: 롤백이 `handle_new_user()` 복원을 주석으로만 언급 → 실행하면 트리거가
  삭제된 테이블 참조 → **신규 가입 전면 실패**. 로컬에서 실제 재현
- **수정 2**: 롤백 블록에 함수 복원을 **테이블 삭제보다 먼저** 포함. 수정 후
  "롤백 → 신규 가입 정상 동작"까지 확인
- **최종 검증**: 클린 DB에서 마이그레이션 2회(멱등) + 매트릭스 **25/25 PASS, FAIL 0**
- **다음 판단**: Phase G로

## 사이클 9 — Solar 장애 처리 검증 (Phase G), 1차 실패

- **계획**: 코드 읽기보다 강한 증거로 실패 매트릭스를 실제 HTTP 검증
- **실행**: `global.fetch` 스텁으로 인증·권한은 통과, Solar만 실패시키는 통합 테스트 8건 작성
- **발견**: 8건 전부 실패, Solar에 도달조차 못 함
- **원인**: `beta-access.js`·`supabase-auth.js`가 `fetchImpl = fetch` **기본 인자를 모듈 생성 시점에
  평가**해 원본 fetch를 캡처 → 나중에 `global.fetch`를 바꿔도 무효
- **수정**: `require("./server")` **전에** 가변 핸들러로 위임하는 고정 스텁 설치
- **검증**: **8/8 PASS**. 401→502, 429→502, 5xx→502, 타임아웃→504, 네트워크→500,
  형식 깨진 응답→전부 null(추측 금지), 범위 초과→폐기, **모델 대체 없음**.
  업스트림 원문·내부 경로 미노출 확인. 실제 Upstage 호출 **0회**
- **간섭 확인**: 전체 73/73, 3회 반복 안정
- **다음 판단**: Release Review로

## 사이클 10 — 독립 Release Review (Phase J)

- **RR1/RR4 (가장 중요)**: 미승인 계정이 과금을 유발할 수 있는가 →
  실제 서버 기동해 미승인 토큰으로 호출: `/chat`·`/extract` **403 `beta_access_required`**,
  **Solar 호출 0회**. 미들웨어 순서 읽기가 아니라 실행으로 증명
- **RR2**: `entries` INSERT·SELECT **양쪽** 정책에 `has_beta_access()` 적용 확인
- **RR3**: 마이그레이션이 `profiles.role`을 전혀 건드리지 않음(언급은 주석 1건) → 역할·접근권한 분리 유지
- **RR5**: 문의 실패 로그에 `reason`·`status`만 기록, 문의 전문·이메일 주소 없음
- **RR6**: 진단 단정 표현 0건. `처방` 8건은 전부 금지 고지문 / 환자가 자기 처방약을 직접 입력하는
  선택 필드 / "의료진에게 확인하라"는 위임 답변 → 처방 행위 없음
- **RR7/RR8**: 3개 화면에 안전 고지 존재, 위기 자원 109 표시
- **결과**: 범위 내 신규 결함 없음(사이클 8·9에서 발견한 4건은 이미 수정)

---

## 이 루프에서 발견해 수정한 문제 요약

| # | 문제 | 심각도 | 수정 |
|---|---|---|---|
| 1 | 마이그레이션이 `service_role`에 명시적 GRANT 없음 → 잠금 사고 위험 | 높음 | 명시적 GRANT 추가 |
| 2 | 롤백이 신규 가입을 깨뜨림(`handle_new_user` 미복원) | 높음 | 함수 복원을 롤백에 포함 |
| 3 | 시크릿 감사 도구의 패턴이 조용히 건너뛰어짐 | 높음(감사 신뢰성) | TAB 구분자 + 컴파일 검증 |
| 4 | blob 열거 파이프라인이 빈 결과 → clean 오판 위험 | 중간(감사 신뢰성) | `%(rest)` 추가 + 건수 확인 |

3·4번은 제품 코드가 아니라 **감사 도구**의 결함이지만, 보안 결론을 뒤집을 수 있어 같은 비중으로 기록했습니다.

## 반복된 교훈

**빈 결과와 성공은 구분되지 않는다.** 이 루프에서 세 번 같은 함정을 만났습니다 —
시크릿 스캔이 0건 반환(파이프라인 고장), 승인 UPDATE가 0행 갱신(권한 부족), 그리고 QA에서
`chatVisible: true` 오탐. 매번 "결과가 기대와 다르면 도구를 먼저 의심"하는 쪽으로 처리했고,
9b 검증처럼 **행 수·건수를 명시적으로 확인하는 단계**를 테스트에 남겼습니다.
