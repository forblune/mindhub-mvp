# MindHub 운영 전환 런북 (배포 순서 · 검증 · 롤백)

> 이 문서는 **dry-run 계획**입니다. 실제 실행은 사용자가 승인·수행합니다.
> Secret 값은 각 서비스 입력창에 **직접** 입력하세요. 채팅·이슈·커밋·이 문서에 값을 적지 마세요.

## 왜 두 단계로 나누는가

지금 운영에서 진행 중인 위험은 두 가지이고 시급성이 다릅니다.

1. **저장소 파일 노출** — 이미 열려 있고, 고치는 데 환경변수·DB·프런트 변경이 전혀 필요 없습니다.
2. **무제한 가입** — 고치려면 Supabase 마이그레이션·계정 승인·Auth 설정·Render 환경변수가 함께 맞물립니다.

1번을 2번이 준비될 때까지 기다리게 하면 노출이 불필요하게 길어집니다. 그래서 1번을 최소 범위 hotfix로
분리했습니다(PR #25, main 대비 3파일). 롤백 표면도 코드 한 곳뿐입니다.

---

# STEP 1 — 긴급: 저장소 파일 노출 차단

**대상**: PR #25 `hotfix/render-static-file-exposure` → `main`

### 배포 전 기록 (롤백용)

- [ ] 현재 main SHA: `dca3adc`
- [ ] 현재 Render 배포 ID: Render → `mindhub-mvp` → Deploys → 최상단 항목 ID를 적어 둔다
- [ ] (환경변수는 변경하지 않으므로 기록 불필요)

### 실행

1. PR #25 diff 확인 — `backend/server.js`, `backend/static-files.js`, `backend/static-files.test.js` **3개 파일만**이어야 함
2. PR #25 병합 (`main`으로)
3. Render → `mindhub-mvp` → 자동 배포 대기 (또는 **Manual Deploy → Deploy latest commit**)
4. 배포 로그에 `solar proxy on <포트>` 출력 확인

### 배포 후 확인

```bash
# 차단돼야 함 → 전부 404
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/.git/HEAD
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/.git/index
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/.git/packed-refs
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/backend/server.js
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/package.json

# 살아 있어야 함
curl -s https://mindhub-mvp.onrender.com/health          # → ok
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/index.html   # → 200
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/app.html     # → 200
curl -s -o /dev/null -w "%{http_code}\n" https://mindhub-mvp.onrender.com/doctor.html  # → 200
```

### 성공 기준

`.git`·소스 경로 전부 404 · 공개 4파일 200 · `/health`가 `ok` · `https://mindhub.forblune.com` 정상 표시

> 참고: 첫 요청은 Render 무료 티어 cold start로 ~30초 걸릴 수 있습니다. 타임아웃을 노출 실패로 오해하지 마세요.

### 실패 시 롤백

Render → Deploys → 위에 기록한 이전 배포 → **Rollback**. 환경변수·DB·프런트를 건드리지 않았으므로 즉시 원복됩니다.
필요하면 `main`에서 해당 커밋 revert 후 재배포.

---

# STEP 2 — 전체 RC 전환

**순서가 중요합니다.** 아래 순서를 지키지 않으면 **본인 계정도 앱에 들어갈 수 없게 됩니다.**

```
마이그레이션 → 내 계정 승인 → 로그인 확인 → 그 다음에 가입 차단
```

가입 차단을 먼저 하면, 승인 절차를 확인하지 못한 상태로 잠길 수 있습니다.

## 2-1. Supabase 마이그레이션

**변경 전 확인**: Table Editor에 `app_access_grants` 테이블이 **없어야** 합니다(있으면 이미 적용된 것).

1. `supabase/migrations/20260725120000_closed_beta_access.sql` 내용 검토
2. Supabase → **SQL Editor** → New query → 전체 붙여넣기 → **Run**
   (파일 하단 `ROLLBACK` 주석 블록은 실행되지 않습니다 — 전부 주석입니다)
3. 오류 없이 완료 확인

**변경 후 확인** (SQL Editor에서):

```sql
-- 테이블 생성됐고, 기존 사용자가 전부 pending인지 (자동 승인이 없어야 정상)
select status, count(*) from public.app_access_grants group by status;
-- 기대: pending = (기존 사용자 수), approved = 0

-- 함수·정책 확인
select proname from pg_proc where proname in ('has_beta_access','handle_new_user','is_doctor');
select tablename, policyname from pg_policies where tablename in ('entries','app_access_grants') order by 1,2;
```

## 2-2. 내 테스트 계정 승인 (가입 차단보다 **먼저**)

Table Editor → `app_access_grants` → 본인 계정 행:

- `status` → `approved`
- `granted_at` → 현재 시각

또는 SQL Editor에서 (이메일은 본인 것으로 교체, 이 문서에는 적지 마세요):

```sql
update public.app_access_grants
set status = 'approved', granted_at = now()
where user_id = (select id from auth.users where email = '<본인 이메일>');
-- 반드시 "UPDATE 1"이 나와야 합니다. "UPDATE 0"이면 승인되지 않았습니다.
```

**확인**: `select status from public.app_access_grants where status='approved';` → 승인한 계정만 나와야 함

## 2-3. 승인 계정 로그인 검증 (아직 가입 차단 전)

- `https://mindhub.forblune.com/app.html` → 승인 계정으로 로그인 → **채팅 화면 진입 성공**
- 미승인 계정이 있으면 그것으로도 로그인 → **"로그인은 확인됐지만 현재 테스트 이용 권한이 없습니다"** 화면
- 여기서 진입이 안 되면 **다음 단계로 넘어가지 말고** 2-2를 다시 확인하세요.

## 2-4. Supabase Auth 가입 차단

1. **Authentication → Sign In / Providers → Email**: "Allow new users to sign up" **OFF**
2. 같은 화면에서 **Anonymous sign-ins OFF** 확인
3. **Kakao provider는 켜 둔 채 유지** — 기존 테스트 계정이 사용합니다. 신규 카카오 가입자는
   `pending`으로 등록되어 앱에 들어올 수 없으므로 켜 두어도 안전합니다.
4. **Authentication → URL Configuration**: Site URL `https://mindhub.forblune.com/app.html`,
   Redirect URLs에 해당 주소 포함 확인
5. (권고) **Authentication → Attack Protection** → leaked password protection **ON**

**확인**: 로그아웃 상태에서 새 이메일로 가입 시도 → 거절

## 2-5. Resend 설정

1. resend.com 가입
2. **Domains** → 발신 도메인 검증 (또는 단일 발신 주소 검증)
3. **API Keys** → 키 생성 → 복사해서 **다음 단계에서 Render 입력창에 직접 붙여넣기**

## 2-6. Render 환경변수

Render → `mindhub-mvp` → **Environment**

**변경 전**: 현재 값들을 안전한 곳에 기록(롤백용). 값을 저에게 알리지 마세요.

| 이름 | 내용 |
|---|---|
| `UPSTAGE_API_KEY` | 현재 사용 중인 Upstage 키로 갱신 |
| `SOLAR_MODEL` | `solar-pro3` |
| `RESEND_API_KEY` | 2-5에서 발급한 키 (신규) |
| `ADOPTION_TO_EMAIL` | 문의를 받을 운영자 이메일 (신규) |
| `ADOPTION_FROM_EMAIL` | Resend에서 검증한 발신 주소 (신규) |
| `SUPABASE_URL` | 값 확인만 |
| `SUPABASE_ANON_KEY` | 값 확인만 (비어 있으면 인증이 깨집니다) |
| `ALLOWED_ORIGINS` | `https://mindhub.forblune.com` 포함 확인 |

## 2-7. hotfix를 RC에 동기화

STEP 1에서 hotfix가 main에 들어갔으므로 RC에 반영합니다. 시뮬레이션에서 검증된 절차입니다.

```bash
git checkout rc/mindhub-recovery
git pull --ff-only origin rc/mindhub-recovery
git fetch origin main
git merge origin/main
# → backend/server.js 1곳 충돌 예상 (예상된 것이며 해결법이 정해져 있음)
```

충돌 해결: **HEAD(RC) 쪽을 유지**하고 충돌 마커만 제거합니다. hotfix 쪽은 이 구간에 새로 기여하는 내용이
없습니다(`isPublicStaticFile` require는 충돌 구간 밖에서 이미 자동 병합됨).

해결 후 확인:

```bash
grep -c "^<<<<<<<\|^=======\|^>>>>>>>" backend/server.js   # → 0
grep -c "app.use(express.static" backend/server.js          # → 0 (주석 언급만 남음)
grep -c "isPublicStaticFile" backend/server.js              # → 2
node -c backend/server.js
git diff origin/rc/mindhub-recovery --stat                  # → 변경 없음(트리 동일)이면 정상
cd backend && npm test && cd .. && npm run build && npm run test:e2e
git commit && git push origin rc/mindhub-recovery
```

## 2-8. PR #24 병합 및 배포

1. PR #24 최신 상태에서 CI 통과 확인
2. PR #24 병합 → **GitHub Pages 프론트 자동 배포**
3. Render 재배포 (환경변수 변경 시 자동 재배포됨, 아니면 Manual Deploy)

**배포 전 기록**: 병합 직전 main SHA, 현재 Render 배포 ID

## 2-9. 운영 smoke test

| 항목 | 기대 |
|---|---|
| `/health` | `ok` |
| `/.git/HEAD` | 404 (STEP 1 유지 확인) |
| 공개 홈페이지 | 정상, `현재 공개 범위` 섹션 표시 |
| 무로그인 가상 데모 | 4단계 완주, 109 위기 카드 표시 |
| `doctor.html?demo=1` | 가상 리포트 표시, "가상" 라벨 |
| 신규 이메일 가입 | **차단** |
| 미승인 계정 로그인 | 제한 안내 화면 |
| 승인 계정 로그인 | 채팅 진입 성공 |
| **실제 Solar 호출** | 채팅 1건 — **최대 1회** |
| **실제 상담 이메일** | 도입 상담 폼 1건 제출 → 수신 확인 — **최대 1회** |
| 콘솔 에러 | 0건 |
| 모바일(360px) | 가로 스크롤 없음 |
| 의료 안전 문구 | "진단·치료 아님" 고지 표시 |

추가로 미승인 계정에서 직접 API 호출이 막히는지 확인(승인 계정 토큰이 아닌 미승인 계정 토큰 사용):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mindhub-mvp.onrender.com/chat \
  -H "Origin: https://mindhub.forblune.com" -H "Content-Type: application/json" \
  -H "Authorization: Bearer <미승인 계정 토큰>" -d '{"messages":[{"role":"user","content":"test"}]}'
# → 403 (beta_access_required)
```

---

## 롤백 대상 요약

| 대상 | 방법 | 비고 |
|---|---|---|
| STEP 1 코드 | Render Deploys → 이전 배포 Rollback | 가장 단순, 부작용 없음 |
| STEP 2 프론트 | `main`을 병합 직전 SHA로 revert → Pages 재배포 | |
| STEP 2 백엔드 | Render Deploys → 이전 배포 Rollback | |
| Render 환경변수 | 2-6에서 기록한 이전 값으로 복원 | |
| Supabase 마이그레이션 | 마이그레이션 파일 하단 `ROLLBACK` 주석 블록의 SQL 실행 | **`handle_new_user()` 복원이 포함돼 있어야 함** — 이것 없이 테이블만 지우면 신규 가입이 전부 깨집니다(로컬에서 재현·수정 완료) |
| Auth 가입 설정 | sign-up을 다시 ON | |
| 계정 승인 | `status`를 `pending`/`revoked`로 되돌림 | `revoked`로 두면 이력이 남아 감사에 유리 |

## 롤백 순서 주의

Supabase 롤백과 코드 롤백을 **함께** 해야 합니다. 마이그레이션만 되돌리고 코드를 두면
프런트가 없는 `has_beta_access()` RPC를 호출해 로그인 후 오류가 납니다. 반대로 코드만 되돌리면
`entries` RLS의 beta 조건이 남아 승인되지 않은 계정이 기록을 저장할 수 없습니다.
가장 안전한 순서는 **코드 롤백 → 마이그레이션 롤백**입니다(코드가 먼저 RPC를 안 부르게 됨).
