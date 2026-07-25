# Git 전체 이력 시크릿 감사 (2026-07-25)

> 대상: `forblune/mindhub-mvp` 저장소의 **모든 ref, 모든 커밋, 모든 파일 버전**(삭제된 파일의 과거 버전 포함)
> 범위: 커밋 115개 / blob 264개 (바이너리·대용량 3개 제외)
> 원칙: **실제 시크릿 값을 이 문서·로그·터미널 출력 어디에도 남기지 않는다.** 종류·파일·커밋만 기록한다.
> 저장소 상태: **PUBLIC** (2026-06-18 생성) — 커밋된 것은 이미 공개된 것으로 간주해야 한다.

## 결론

| 항목 | 결과 |
|---|---|
| **실제 시크릿 커밋 이력** | **0건** |
| **키 회전 필요** | **없음** |
| **Git 이력 재작성 필요** | **없음** |
| 커밋된 자격증명 | Supabase **anon key만** (공개 설계, RLS로 보호) |

CRITICAL 등급 패턴 11종이 전 이력에서 **한 건도** 검출되지 않았습니다.

## 검사 방법

현재 워킹트리만 보는 것이 아니라, 객체 데이터베이스의 모든 blob을 열거해 검사했습니다.
이렇게 하면 "커밋했다가 다음 커밋에서 지운" 파일도 잡힙니다(Git 이력에는 그대로 남으므로).

```
git rev-list --objects --all
  | git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize) %(rest)'
  → blob 264개 → 각 blob 내용을 패턴 15종으로 검사
```

> **감사 도구 자체의 신뢰성**: 1차 스크립트는 패턴 목록 구분자로 `|`를 사용했는데 정규식 내부의
> `|`(alternation)와 충돌해 일부 패턴이 깨진 채 평가됐습니다("parentheses not balanced").
> 보안 감사에서 패턴이 조용히 건너뛰어지면 결과가 거짓 안심이 되므로, 구분자를 TAB으로 바꾸고
> **실행 전에 15개 패턴이 모두 컴파일되는지 검증하는 단계를 추가**한 뒤 재실행했습니다.
> 아래 결과는 재실행 기준입니다.
>
> 같은 이유로, blob 열거가 0건을 반환했을 때도 "clean"으로 판정하지 않고 원인을 추적했습니다
> (`git cat-file --batch-check`는 포맷에 `%(rest)`가 있을 때만 입력을 `<sha> <path>`로 분리합니다).
> 깨진 파이프라인의 빈 결과와 진짜 clean은 겉보기가 같으므로, blob 수가 기대값과 일치하는지 확인했습니다.

## CRITICAL 패턴 — 전부 0건

| 패턴 | 결과 |
|---|---|
| OpenAI key (`sk-…`) | 0건 |
| OpenAI project key (`sk-proj-…`) | 0건 |
| Anthropic key (`sk-ant-…`) | 0건 |
| Resend key (`re_…`) | 0건 |
| Upstage key (`up_…`) | 0건 |
| AWS access key (`AKIA…`) | 0건 |
| Google API key (`AIza…`) | 0건 |
| GitHub PAT (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`) | 0건 |
| Slack token (`xox…`) | 0건 |
| Stripe key (`sk_live_`/`sk_test_`) | 0건 |
| Private key block (`BEGIN … PRIVATE KEY`) | 0건 |

`.env`·`credentials.json`·`*.pem`·`*.key`·`id_rsa` 류 파일이 커밋된 이력도 없습니다
(`.env.example`만 존재하며, 모든 과거 버전이 **이름만 있고 값이 없는** 상태입니다).

## REVIEW 검출건 triage

### 1. JWT — 실제 검출, 그러나 시크릿 아님 ✅

전 이력에서 **고유 JWT 2개**가 발견됐고, 둘 다 디코드해 확인했습니다(토큰·서명은 출력하지 않고 payload 필드만):

| | role | ref | 발급(iat) | 만료(exp) |
|---|---|---|---|---|
| JWT#1 | `anon` | `vhxvqtbemahbcbrbnkcv` | 2026-06-09 | 2036-06-09 |
| JWT#2 | `anon` | `vhxvqtbemahbcbrbnkcv` | 2026-06-09 | 2036-06-09 |

- **`service_role` 토큰은 0건.** 이것이 이 감사에서 가장 중요한 판정입니다 — service_role은 RLS를
  전부 우회하므로 커밋됐다면 즉시 회전이 필요했습니다.
- `anon` key는 Supabase가 **클라이언트에 노출되도록 설계한 공개 키**이며 보호는 RLS가 담당합니다.
  프론트엔드 SPA에서는 숨길 방법이 원리적으로 없습니다. 따라서 회전 대상이 아닙니다.
- 위치: `app.html`, `doctor.html`(프론트에 의도적으로 임베드), `backend/server.js`의 과거 1개 버전.
  후자는 **이미 제거**되어 현재는 환경변수에서만 읽습니다(과거 손상된 폴백값이 apikey 검증을 깨뜨려
  '세션 만료' 버그를 유발한 이력이 있어 의도적으로 제거됨 — `backend/server.js` 주석 참고).
- 최초 도입 커밋: `23d5285` (2026-06-19) "feat(app): Supabase 클라우드 저장/읽기 활성화 (URL + anon key)"
- **노출 기간**: 2026-06-19부터 현재까지, PUBLIC 저장소. 의도된 공개이므로 사고가 아닙니다.

### 2. `service_role` 문자열 — false positive ✅

`README.md`, `SUPABASE_연동_설계.md`, `app.html`, `개발일지.md`, 신규 문서·마이그레이션에서 검출됐지만,
`service_role` 뒤에 실제 JWT가 붙은 형태는 **0건**입니다. 전부 다음과 같은 **산문·주석 언급**입니다:

- "**절대 프론트에 넣지 말 것: `service_role` 키**"
- "승인/회수는 **service_role만** 가능"
- "Upstage·OpenAI·`service_role` 등 실제 비밀 키는 **환경변수에만**"

즉 "이 키를 쓰지 말라"는 경고문이 패턴에 걸린 것으로, 오히려 올바른 보안 문서화의 흔적입니다.

### 3. Kakao 32-hex key — 0건 ✅

이전 운영 사이트 조사에서 카카오 OAuth **client_id**(REST API 키)가 리다이렉트 URL에 보였으나,
이는 카카오가 클라이언트에 노출하도록 설계한 공개 앱 키이고 **저장소에는 커밋돼 있지 않습니다**.
카카오 **Client Secret**은 Supabase 콘솔에만 있고 이력에서 검출되지 않았습니다.

### 4. Password/token 할당문 — 0건 ✅

`password = "..."` 형태의 하드코딩 자격증명이 없습니다.

## 권장 후속 작업

키 회전이나 이력 재작성은 **불필요**합니다. 대신 예방 관점의 권고만 남깁니다.

1. **(권고) 커밋 전 시크릿 스캔 자동화** — CI에 `gitleaks`/`trufflehog` 같은 스캐너를 추가하면
   향후 실수로 커밋되는 것을 병합 전에 잡을 수 있습니다. 현재는 수동 스캔만 있습니다.
2. **(권고) anon key를 환경변수/빌드 치환으로 이동** — 보안상 필수는 아니지만(공개 키이므로),
   프로젝트를 옮길 때 3개 파일을 손으로 고쳐야 하는 유지보수 부담이 있습니다. 우선순위는 낮습니다.
3. **(이미 조치됨) 운영 서버의 저장소 노출 차단** — 이력에 시크릿이 없더라도, Render가 `.git`을
   서빙하던 문제는 별개의 실제 위험이었습니다. `hotfix/render-static-file-exposure`에서 수정했으며
   운영 배포가 필요합니다(`docs/rc/MINDHUB_RECOVERY_STATUS.md` 참고).

## 재현 방법

이 감사는 되돌릴 수 있고 재현 가능합니다. 스캐너는 저장소에 커밋하지 않았고(일회성 분석 스크립트),
동일 결론을 얻으려면 위 "검사 방법"의 blob 열거 + 패턴 검사를 반복하면 됩니다.
검증 시 **반드시 패턴 컴파일 확인과 blob 수 확인을 먼저** 하십시오 — 그것 없이는 빈 결과를
clean으로 오해할 수 있습니다.
