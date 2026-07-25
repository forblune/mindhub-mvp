# 기관 도입 상담 — 실제 이메일 발송

## 배경

기존 `POST /adoption-consult`는 기관 유형·목표·규모·우선순위 4개 선택지만 받아 OpenAI로 즉석 안내를
생성해 화면에 보여주는 기능이다. 이름·기관명·연락처를 아예 받지 않고, 저장도 이메일 발송도 하지 않는다
(`docs/audit/MINDHUB_RECOVERY_AUDIT.md` A절에서 확인). 즉, 기관 담당자가 상담을 완료해도 MindHub 쪽에서는
누가 문의했는지 알 방법이 없었다.

이 작업은 **같은 모달 폼을 확장**해 실제 리드 캡처 + 이메일 알림을 추가한다. LLM 즉석 안내(`/adoption-consult`)는
그대로 유지하고, 별도로 `POST /adoption-inquiry`를 새로 만들어 운영자 이메일(`ADOPTION_TO_EMAIL`)로 문의를 전달한다.
제출 한 번으로 두 요청이 동시에 나가고, 화면에는 두 결과가 각각 독립적으로 표시된다 —
LLM 안내는 항상 폴백이 있어 실패해도 화면이 비지 않고, 이메일 발송 성공/실패는 별도 상태 배너로 정직하게 보여준다
(발송 실패를 성공으로 위장하지 않음).

## 필드

| 필드 | 필수 | 비고 |
|---|---|---|
| 기관명 (orgName) | ✅ | |
| 기관 유형 (orgType) | ✅ | 기존 select 재사용 |
| 담당자명 (contactName) | ✅ | |
| 업무용 이메일 (email) | ✅ | 클라이언트+서버 양쪽에서 형식 검사 |
| 연락처 (phone) | 선택 | |
| 도입 목적 (purpose) | ✅ | 기존 select("가장 중요한 목표") 재사용 |
| 예상 이용 인원/규모 (scale) | ✅ | 기존 select 재사용 |
| 희망 일정 (timeline) | 선택 | |
| 문의 내용 (message) | ✅ | 기존 "현재 업무와 가장 큰 어려움" textarea를 필수로 전환·재명명 |
| 개인정보 수집·이용 동의 (consent) | ✅ | 체크박스, 미동의 시 제출 불가 |
| (가장 중요한 기준 / priority) | ✅ | LLM 안내 품질을 위해 기존대로 유지, 이메일에는 포함하지 않음 |

주민등록번호·환자 실명·진료기록·의료영상·처방전과 첨부파일은 폼 자체에 입력 UI가 없다(받지 않음).

## 백엔드 구조

- `backend/adoption-inquiry.js` — 순수 함수 모듈(server.js와 분리, 단위 테스트 대상):
  - `normalizeInquiryInput`/`isValidInquiryInput`: 허용 목록·길이 제한(하드 리젝 대신 자르기, 기존 관례와 동일),
    이메일 형식 검사.
  - `isHoneypotTriggered`: 숨김 필드(`website`)가 채워져 있으면 봇으로 판단.
  - `buildInquiryEmail`: 제목·HTML·텍스트 본문 생성. 모든 값을 `escapeHtml`로 이스케이프하고, 제목에 들어가는
    값은 개행을 제거해 헤더/본문 인젝션을 막는다.
  - `createInquiryMailer`: Resend REST API(`https://api.resend.com/emails`) 클라이언트. `fetch`를 주입받아
    테스트 가능(실제 네트워크 호출 없이 성공/실패/타임아웃을 시뮬레이션). `RESEND_API_KEY`·`ADOPTION_FROM_EMAIL`·
    `ADOPTION_TO_EMAIL` 중 하나라도 없으면 `not_configured`를 반환하고 **네트워크 호출 자체를 시도하지 않는다** —
    Secret이 없을 때 성공한 것처럼 보이지 않기 위함(mock이 아니라 정직한 실패).
  - `createDuplicateGuard`: 이메일+기관명+문의내용 해시를 10분간 기억해 중복 제출 시 같은 request id를 재사용.
- `server.js`의 `POST /adoption-inquiry`:
  1. `requireAllowedOrigin` (기존 Origin allowlist 재사용, 로그인 불필요 — 도입 전 방문자 대상)
  2. `inquiryLimiter` (30분/5회, `/adoption-consult`의 10회보다 낮음 — 감사에서 권고한 대로 이메일 발송은
     LLM 답변보다 비용·평판 영향이 커서 별도로 더 낮은 한도)
  3. honeypot 체크 → 채워져 있으면 실제 발송 없이 정상 사용자와 같은 성공 응답(스팸 봇에게 탐지 사실을 알리지 않기 위함)
  4. 입력 검증 → 400
  5. 중복 제출 체크 → 같은 request id 재사용
  6. 이메일 발송 → 실패 시 503 `email_unavailable`, 성공 시 200 + request id
- `express.json({ limit:"32kb" })` 전역 제한을 그대로 사용(첨부파일 업로드 경로 자체가 없음).
- 문의 전문·이메일 주소는 로그에 남기지 않는다(실패 사유·상태코드만 `console.error`).
- DB에는 아무것도 쓰지 않는다(Supabase 호출 없음).

## 프론트(index.html)

- 기존 `#consultForm`에 필드를 추가/재배치. `기관 유형`·`도입 목적`·`예상 이용 인원 또는 규모`는
  기존 select를 그대로 재사용(라벨만 요청서 문구에 맞게 조정)해 `/adoption-consult`용 데이터와 공유한다.
- 숨김 honeypot 필드(`#consultWebsite`, `name="website"`)는 `position:absolute` + `visibility:hidden`
  조합으로 화면·스크린리더·키보드 탭 순서 모두에서 제외(CSS `display:none`만으로는 일부 단순 봇이 그래도
  채우는 경우가 있어, "사람에게는 안 보이지만 DOM에는 존재"하는 상태를 유지).
- 제출 시 `Promise.allSettled`로 `/adoption-consult`(LLM 안내)와 `/adoption-inquiry`(이메일)를 동시에 호출하고,
  결과를 각각 다른 영역에 표시한다 — `#consultOutput`(안내 텍스트, 항상 폴백 있음)과 `#consultStatus`
  (이메일 발송 성공/실패, 폴백 없음 — 실패는 실패로 보여준다).
- 클라이언트 이메일 형식 검사(`type="email"` + JS 정규식)는 서버 검증의 보조일 뿐, 실제 검증은 서버가 한다.

## Mock 발송 테스트

`RESEND_API_KEY`가 없는 로컬 환경에서 실제 curl로 확인한 동작:

```
$ curl -X POST http://localhost:3000/adoption-inquiry -H "Origin: https://mindhub.forblune.com" \
  -H "Content-Type: application/json" -d '{ ...필수 필드... }'
{"error":"email_unavailable","message":"현재 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."}
HTTP 503
```

Secret 없이도 **거짓 성공을 반환하지 않는다.** 검증/오류 흐름 자체는 `backend/adoption-inquiry.test.js`에서
`fetch`를 주입해 성공·실패·타임아웃·`not_configured` 네 가지 경로를 모두 커버한다.

## 이 작업에서 하지 않은 것 (Hard Stop)

- 실제 `RESEND_API_KEY` 발급/등록.
- Render에 `RESEND_API_KEY`/`ADOPTION_TO_EMAIL`/`ADOPTION_FROM_EMAIL` 실제 값 등록.
- 실제 이메일 발송 테스트(최대 1회, 사용자 승인 후).
- 발신 도메인/주소 검증(Resend 대시보드에서 진행 필요).
