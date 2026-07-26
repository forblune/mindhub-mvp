# Closed-beta 접근권한 구조

> 목적: "로그인 성공"과 "실제 환자 앱 사용 허가"를 분리한다. 기본값은 항상 거부(default deny)이며,
> 지정된 테스트 계정만 채팅·기록 저장을 사용할 수 있다. 클라이언트 UI만 숨기는 방식이 아니라
> Supabase RLS + 백엔드 서버 측 검증에서 강제한다.

## 설계 결정: `app_access_grants` 별도 테이블

`profiles.access_status` 컬럼 방식과 비교했고, 아래 기준으로 **별도 테이블(B안)** 을 선택했다.

| 기준 | `profiles.access_status` 컬럼 | `app_access_grants` 테이블(선택) |
|---|---|---|
| 역할과 접근권한 분리 | `role`과 같은 테이블에 섞임 | 완전히 분리된 개념·테이블 |
| 감사 가능성 | 컬럼 하나로는 이력 남기기 어려움 | `granted_by`/`granted_at`/`revoked_at`/`note`로 자연스러운 이력 |
| RLS 단순성 | profiles RLS에 조건 추가 | `is_doctor()`와 동일한 SECURITY DEFINER 함수 패턴 재사용 |
| 기관 파일럿 확장성 | 컬럼 추가로 계속 늘어남 | 테이블 확장(만료일, 기관 스코프 등)이 자연스러움 |

`profiles`는 이미 `role`(patient/doctor) 컬럼이 컬럼 단위 GRANT로 보호되고 있어(감사에서 확인,
`docs/audit/MINDHUB_RECOVERY_AUDIT.md` B절), 여기에 접근권한까지 얹으면 "역할"과 "접근 허가"라는
서로 다른 두 개념이 한 테이블·한 정책에 뒤섞인다. doctor 역할이 곧 closed-beta 접근을 의미하지
않도록(요청서 6절: "기존 역할 doctor와 closed-beta access를 분리") 의도적으로 분리했다.

## 스키마

`supabase/migrations/20260725120000_closed_beta_access.sql` (운영에는 미적용, read-only 감사 기반 설계).

```
app_access_grants
  id          uuid primary key
  user_id     uuid unique references auth.users(id)
  status      text check in ('pending','approved','revoked'), default 'pending'
  granted_by  uuid references auth.users(id)
  granted_at  timestamptz
  revoked_at  timestamptz
  note        text
  created_at / updated_at
```

- 행이 없거나 `status != 'approved'`면 접근 불가 — **행 부재 자체가 거부 상태**.
- `handle_new_user()` 트리거가 신규 가입자를 항상 `'pending'`으로 자동 등록(감사 목적, 자동 승인 아님).
- 기존 가입자(감사 시점 `auth.users` 3명)도 마이그레이션이 `'pending'`으로만 백필한다 —
  **기존 사용자에게 자동 권한 부여 금지** 요구사항을 그대로 지킨다.

## RLS·권한

- `app_access_grants`: `authenticated`/`anon`에게 테이블 권한을 전부 REVOKE한 뒤 `SELECT`만 다시 GRANT.
  정책은 "본인 행만 SELECT" 하나뿐 — INSERT/UPDATE/DELETE 정책은 아예 만들지 않는다.
  → 신규 행 생성은 `handle_new_user()`(SECURITY DEFINER)로만, 승인/회수는 **service_role만** 가능.
- `has_beta_access()`: `is_doctor()`와 동일한 SECURITY DEFINER/`stable`/`search_path` 고정 패턴.
  `auth.uid()` 기준으로 본인이 `approved`인지만 반환.
- `entries`의 `patient insert own`/`patient select own` 정책에 `has_beta_access()` 조건을 추가.
  anon key로 REST API를 직접 두드려도(앱을 거치지 않아도) 승인되지 않은 계정은 막힌다 —
  요청서의 "직접 API 호출도 차단" 요구사항.

## 정적 SQL 검증

로컬 임시 PostgreSQL 인스턴스(homebrew, 이번 세션에서만 기동 후 폐기)에 감사에서 확인된 실제 스키마를
최소 재현(`auth.users`, `public.profiles`, `public.entries`, `is_doctor()`)한 뒤 마이그레이션을 실행하고
다음을 실제로 검증했다(운영 프로젝트는 전혀 건드리지 않음, read-only MCP만 사용):

- 신규 가입 → `app_access_grants` 행이 자동으로 `pending` 생성됨.
- `pending` 상태에서 `has_beta_access()` → `false`, `entries` INSERT 시도 → RLS 위반으로 차단.
- `service_role`이 `status='approved'`로 갱신 → `has_beta_access()` → `true`, `entries` INSERT 성공.
- `authenticated` 역할이 자기 자신의 `app_access_grants` 행을 UPDATE 시도 → 권한 거부(테이블 GRANT 자체가 없음).
- 기존 가입자를 백필해도 `approved`가 아닌 `pending`으로만 들어감(자동 승인 없음).

## 백엔드(server.js) 방어

Supabase RLS는 `entries` 테이블 직접 접근만 막는다. `/chat`은 DB에 아무것도 쓰지 않고 Solar를 그대로
프록시하므로, RLS만으로는 미승인 계정의 `/chat` 호출(=실제 과금)을 막지 못한다. 그래서 백엔드에도
`requireBetaAccess` 미들웨어를 추가해 `/chat`·`/extract` 양쪽에서 이중으로 막는다
(`requireAllowedOrigin → requireAuthenticatedUser → requireBetaAccess → rate limiter` 순서).

## 프론트(app.html) 게이트

- 회원가입 탭·카카오 로그인 버튼: "현재 신규 가입을 받지 않습니다" 상태로 비활성화(CSS 숨김만이 아니라
  실제 제출 차단 + 안내 문구).
- 로그인 성공 후 `boot()`에서 `has_beta_access()` RPC를 한 번 더 호출해 확인:
  - 권한 있음 → 기존 채팅 진입.
  - 권한 없음 → "로그인은 확인됐지만 현재 테스트 이용 권한이 없습니다." 안내 화면(채팅 UI 미노출).
- anon key가 공개 설계이므로 이 프론트 체크는 UX용 안내일 뿐이고, 실제 차단은 위 RLS·백엔드 이중 게이트가 담당한다.

## 운영 적용 시 필요한 것 (Hard Stop, USER ACTION PACK으로 이관)

- 마이그레이션을 Supabase SQL Editor에서 실제 실행.
- 지정된 테스트 계정에 한해 `app_access_grants.status`를 `'approved'`로 수동 변경(Table Editor 또는 SQL).
- Supabase Auth 프로젝트 설정에서 신규 가입 자체도 차단(이 마이그레이션은 "가입 후 접근"만 막고,
  "가입 자체"는 막지 않음 — 가입 차단은 Auth 프로젝트 설정의 몫).

---

## 확장 검증 (2026-07-25, 자율 복구 루프)

로컬 임시 PostgreSQL 16에 라이브 스키마를 재현(`auth.users`, `profiles`, `entries`, `is_doctor()`,
`get_patient_report_entries()`, Supabase의 `ALTER DEFAULT PRIVILEGES`와 `service_role BYPASSRLS`까지)한 뒤
**25개 시나리오를 전부 통과**했습니다. 운영 프로젝트에는 적용하지 않았습니다.

| # | 시나리오 | 결과 |
|---|---|---|
| 1-3 | 신규 가입 → pending 자동 등록, profiles 행 생성, role은 항상 `patient` | PASS |
| 4-5 | pending: `has_beta_access()`=false, `entries` INSERT 차단 | PASS |
| 6 | pending: 본인 status 조회는 가능 | PASS |
| 7 | pending: 자기 자신을 approved로 UPDATE 불가 | PASS |
| 8-9 | 타인 grant 행 조회 불가, anon 조회 0건 | PASS |
| 9b | **service_role의 승인 UPDATE가 실제로 1행을 갱신** | PASS |
| 10-12 | approved: 접근 허용, `entries` INSERT/SELECT 성공 | PASS |
| 13 | approved라도 타인 `entries`는 조회 불가 | PASS |
| 14-15 | revoked: 즉시 차단, 기존 기록도 조회 불가 | PASS |
| 16 | grant 행이 아예 없으면 기본 거부 | PASS |
| 17-20 | 의사 RPC 회귀 없음, 원문 대화 항상 null, red_flag 근거는 전달, 비의사는 0행 | PASS |
| 21 | `has_beta_access()` `search_path` 고정 | PASS |
| 22 | `auth.users` 삭제 시 grant cascade 삭제 | PASS |
| 23 | `authenticated`는 SELECT만 보유(INSERT/UPDATE/DELETE 없음) | PASS |
| 24 | `status` CHECK 제약이 임의 값 거부 | PASS |

### 검증 중 발견해 수정한 결함 2건

**1. `service_role`에 명시적 GRANT가 없었다 (잠금 사고 위험).**
마이그레이션이 `service_role`을 주석에서만 언급하고 실제 권한 부여를 하지 않아, Supabase가 public 스키마에
설정해 둔 기본 권한(`ALTER DEFAULT PRIVILEGES`)에 암묵적으로 의존하고 있었습니다. 그 설정이 다른 프로젝트에서는
**"승인할 수 있는 주체가 아무도 없는" 상태**가 될 수 있고, 그러면 운영자가 자기 테스트 계정조차 승인하지 못해
전원이 잠깁니다. `grant select, insert, update, delete on table public.app_access_grants to service_role;`을
명시적으로 추가했습니다.

> 이 결함은 처음에 "stub 충실도 문제"로 보였습니다. 로컬 stub이 Supabase의 기본 권한과 `BYPASSRLS`를
> 재현하지 않아 테스트가 실패했기 때문입니다. stub을 실제와 같게 고친 뒤에도 **명시적 GRANT가 없다는 사실 자체는
> 남는 위험**이라 판단해 마이그레이션을 고쳤습니다. 아울러 승인 UPDATE가 조용히 0행을 갱신하는 상황을
> 성공으로 오해하지 않도록 "실제로 1행이 갱신됐는지" 확인하는 검증(9b)을 추가했습니다.

**2. ROLLBACK 블록이 실행하면 신규 가입을 깨뜨렸다.**
롤백이 `app_access_grants` 테이블을 삭제하지만 `handle_new_user()`는 그 테이블을 계속 참조하도록 남겨서,
롤백 후 `auth.users` INSERT가 트리거 오류로 실패 → **신규 가입이 전부 깨집니다.** 기존 블록은 주석으로
"수동 복원 필요"라고만 적혀 있었습니다. 실제로 재현한 뒤, 롤백 블록에 마이그레이션 이전 버전
`handle_new_user()` 복원을 **테이블 삭제보다 먼저** 수행하도록 포함시켰습니다.
수정 후 롤백을 실행해 "롤백 후 신규 가입 정상 동작"까지 확인했습니다.

### 알아 두어야 할 의도된 설계 (검증에서 확인)

**의사 계정은 closed-beta 승인 없이도 리포트를 조회할 수 있습니다.** `get_patient_report_entries()`가
SECURITY DEFINER라 `entries` RLS를 우회하기 때문이며, 이는 의도된 동작입니다.

- 근거: `profiles.role = 'doctor'`는 **service_role만 변경할 수 있으므로**(컬럼 단위 GRANT로 강제) 의사 역할 부여
  자체가 이미 관리자의 명시적 승인 행위입니다. 즉 "역할"과 "제품 접근 권한"을 분리한 설계 의도와 일치합니다.
- 위험이 낮은 이유: 의사 경로는 **읽기 전용**이고 환자가 공유하기로 선택한 필드만 보며, Solar를 호출하지 않아
  과금·남용 벡터가 없습니다.
- 다만 closed-beta가 모든 것을 막는다고 오해할 수 있어 여기에 명시합니다. 의사에게도 승인을 요구하려면
  RPC 내부에 `has_beta_access()`를 추가해야 하며, 그 경우 기존 의사 계정도 승인 전까지 리포트를 볼 수 없게 됩니다.
