# Supabase 연결 복구 계획

> 대상 프로젝트: ref `vhxvqtbemahbcbrbnkcv` (조직 Forblune, 대시보드 표시명 "MindBridge")
> 조사 방법: Supabase MCP **read-only** + 운영 사이트 실측 + 코드 리딩. 운영 스키마·데이터·Auth 설정은 변경하지 않음.

## 결론 먼저: "연결 고장"은 없었다

이 작업은 "Supabase 연결과 인증 구조를 복구한다"는 전제로 시작했지만, **감사 결과 복구가 필요한 연결
불일치는 존재하지 않았다.** 이 문서는 그 근거를 남기고, 원래 의심했던 항목을 하나씩 검증 결과와 함께
정리한다. 실제로 고장난 것은 연결이 아니라 **접근 통제의 부재**였고, 그건 별도 문서
(`CLOSED_BETA_ACCESS.md`)에서 다룬다.

### 의심 항목별 검증 결과

| 의심했던 항목 | 실제 상태 | 판정 |
|---|---|---|
| `SUPABASE_URL` 불일치 | `app.html:627`, `doctor.html:219`, `backend/server.js:84` 전부 `https://vhxvqtbemahbcbrbnkcv.supabase.co` | 일치 ✅ |
| project ref 불일치 | 위 URL의 ref가 지정된 ref와 동일. 운영 사이트 네트워크 로그에서도 동일 호스트로 호출됨 | 일치 ✅ |
| 공개 anon/publishable key 손상 | 프론트에 임베드된 anon key로 실제 Auth 호출이 정상 동작(가짜 계정 로그인 시도가 `400 invalid_credentials`로 정상 거절됨 — 키가 깨졌으면 `401 invalid api key`가 났을 것) | 정상 ✅ |
| Site URL / Redirect URL 오설정 | 카카오 로그인 진입 시 `redirect_uri`가 `https://vhxvqtbemahbcbrbnkcv.supabase.co/auth/v1/callback`, `redirect_to`가 `https://mindhub.forblune.com/app.html`로 올바르게 스코프됨(리다이렉트 1홉만 확인, 로그인 미완료) | 정상 ✅ |
| provider redirect 오설정 | 위와 동일하게 카카오 authorize 엔드포인트로 정상 이동 | 정상 ✅ |
| Render의 Supabase 환경변수 | `/chat`·`/extract`가 Bearer 토큰 검증 단계까지 정상 도달(가짜 토큰에 `401 invalid_session` 반환) → `SUPABASE_URL`·`SUPABASE_ANON_KEY`가 백엔드에서 정상 동작 중 | 정상 ✅ |
| RLS 미적용 | `profiles`·`entries`·`posts` 세 테이블 모두 `relrowsecurity = true` | 정상 ✅ |
| 역할 상승 가능성 | RLS뿐 아니라 **컬럼 단위 GRANT**로 이중 차단. `authenticated`는 `profiles.role`에 UPDATE 권한이 아예 없고 `display_name`/`share_*`만 보유 → 환자가 자기 role을 doctor로 바꾸는 PATCH는 RLS 평가 전에 권한 오류로 거절됨 | 정상 ✅ |
| `handle_new_user` 트리거 소실 | `on_auth_user_created` (AFTER INSERT ON `auth.users`) 존재. client metadata에서 role을 읽지 않고 항상 기본값 `patient` | 정상 ✅ |
| `is_doctor()` / `get_patient_report_entries()` 소실 | 둘 다 존재. 후자는 SECURITY DEFINER + 내부 `is_doctor()` 체크, 원문 대화(`text`)는 항상 null 반환, 미공유 필드는 null | 정상 ✅ |

### 진짜 문제였던 것

1. **접근 통제 부재** — 로그인만 하면 누구나 실제 환자 앱에 진입 가능.
   `is_doctor` 외에 `approved`/`beta`/`access_status`류 개념이 스키마·코드 어디에도 없었다.
   → `CLOSED_BETA_ACCESS.md`, 마이그레이션 `supabase/migrations/20260725120000_closed_beta_access.sql`
2. **마이그레이션 이력 미추적** — `list_migrations`가 완전히 비어 있는데 라이브 스키마는
   `SUPABASE_보안강화_20260619.sql`의 의도와 일치. SQL Editor로 수동 적용된 것으로 보인다.
   코드 드리프트는 아니지만 이력이 없어 재현·롤백 근거가 약하다.

---

## 남은 정리 작업 (권고, 운영 변경은 전부 Hard Stop)

### A. 마이그레이션 이력 baseline (권고)

현재 라이브 스키마를 추적 가능한 마이그레이션으로 한 번 baseline 하는 것을 권한다. 그렇게 해두면
이후 변경이 `supabase db push`로 재현·롤백 가능해진다. 이번 작업에서 추가한
`20260725120000_closed_beta_access.sql`도 같은 흐름에 올려두는 것이 좋다.

주의: baseline 자체가 스키마를 바꾸지는 않지만 `supabase_migrations.schema_migrations`에 행을 쓰므로
**운영 프로젝트 대상 실행은 사용자 승인 후에** 해야 한다.

### B. Advisor WARN 정리 (권고, 보안 등급 CRITICAL/HIGH 없음)

read-only advisor 결과는 WARN만 있었다. 실제 악용 가능성 순으로:

1. **`auth_leaked_password_protection` 비활성** — Supabase Auth가 신규/변경 비밀번호를 HaveIBeenPwned
   유출 목록과 대조하지 않는 상태. 대시보드 토글 하나로 켤 수 있어 비용 대비 효과가 가장 크다.
2. **SECURITY DEFINER 함수 4개의 EXECUTE 과다 노출** — `is_doctor`, `get_patient_report_entries`,
   `handle_new_user`, `rls_auto_enable`이 anon/authenticated에 EXECUTE 노출.
   실질 악용 가능성은 낮다(anon이 `get_patient_report_entries`를 불러도 `auth.uid()`가 null이라 0행,
   `handle_new_user`/`rls_auto_enable`은 트리거/이벤트트리거 컨텍스트 밖에서 호출하면 오류). 다만 불필요한
   표면이므로 `REVOKE EXECUTE ... FROM anon` 권고.
3. **`set_updated_at()`의 `search_path` 미고정** — 본문이 `NEW.updated_at = NOW()` 한 줄이라 위험은 낮지만,
   다른 4개 함수처럼 `SET search_path`를 고정하는 것이 일관적이다.

### C. 스키마 위생 (사용자 판단 필요)

- **`posts` 테이블** — `title`/`content`/`author_id` 등을 가진 테이블이 존재하는데 CLAUDE.md의 스키마 설명에
  전혀 없고 마음기록 기능과 무관하며 0행이다. 다른 프로젝트의 잔재로 보인다.
  삭제 여부는 사용자 판단 필요(운영 스키마 변경이므로 Hard Stop). 삭제 전 정말 미사용인지 확인 권고.
- **`entries.patient_id`에 FK 없음** — text 컬럼이고 `auth.users`/`profiles`로의 외래키 제약이 없다.
  무결성은 INSERT 정책의 `patient_id = auth.uid()::text` 조건에만 의존한다. 노출된 API 경로에서는 충분하지만,
  향후 service_role로 직접 쓰는 경로가 생기면 제약이 필요하다.
- **`get_patient_report_entries()`가 담당의 스코프가 아님** — `role='doctor'`인 계정이면 **아무 환자의**
  `target_patient` UUID로 리포트를 조회할 수 있다. 단일 기관 데모 전제에서는 의도된 설계지만,
  다기관·다의사로 확장하기 전에 `care_links` 같은 담당관계 테이블로 좁혀야 한다.

### D. 사용자 수 현황 (집계만)

`auth.users` 총 **3명**, `auth.identities` provider 구성은 kakao 3 / email 1(한 계정이 카카오·이메일 둘 다
연결된 것으로 보임). 실제 이메일·UID는 조사·기록하지 않았다.

Storage 버킷 **0개**(미사용). Edge Functions는 Postgres 카탈로그로 확인 불가하므로 대시보드/CLI 확인 권고.

---

## 이 문서 범위에서 하지 않은 것 (Hard Stop)

- 운영 프로젝트에 마이그레이션 실행
- Supabase Auth 설정 변경(신규 가입 차단, 익명 로그인, 이메일 확인 정책, leaked-password protection)
- Site URL / Redirect URL 변경
- 테스트 계정에 접근권한 부여
- `posts` 테이블 삭제
- 운영 데이터 수정·삭제
- anon/publishable key 값 출력(정책상 값은 기록하지 않음)

위 항목은 `rc → main` PR의 **USER ACTION PACK**에 정확한 UI 경로·검증 방법과 함께 정리한다.
