# Supabase 연동 설계 — 환자 → 의사 데이터 전달

> 목적: 지금은 데이터가 한 브라우저(localStorage·메모리) 안에만 있어 *환자 기기 → 의사 기기*로 넘어가지 않는다.
> Supabase(공용 DB)를 붙여, 환자 앱이 추출한 임상 신호를 저장하고 의사 대시보드가 읽어오게 한다.
> 이 문서는 Claude Code가 구현할 수 있도록 스키마·흐름·연동 지점·보안·폴백을 정의한다.

---

## 0. 설계 원칙 준수 (CLAUDE.md)

- **진단 안 함**: DB엔 추출된 원시 신호만 저장(진단명·판단 없음).
- **위험 감지는 프론트 규칙 기반(`RISK_WORDS`) 유지**: `red_flag`는 클라이언트에서 계산해 저장만 함. Supabase/네트워크에 의존하지 않는다.
- **Solar 키는 백엔드에만**: 이건 그대로. Supabase의 **anon public key**는 성격이 다름 → 아래 보안 절 참고.
- **데모 안 깨짐(폴백 필수)**: `SUPABASE_URL`이 비었거나 호출 실패 시, 기존 localStorage·메모리 동작으로 자동 폴백. Supabase는 "있으면 더 좋은" 레이어.
- **의사 추가 업무 0**: 의사는 읽기만. 리포트는 Red Flag만 부각.
- **가상 데이터**: 데모는 전부 가상 환자.

---

## 1. 접근 방식 결정

**권장: 프론트에서 supabase-js로 직접 읽기/쓰기 (anon key + RLS).**
- 백엔드 변경 없음, 구현 가장 단순. 발표 일정(6/22)에 적합.
- 환자 앱이 신호를 insert, 의사 뷰가 select.

(대안: 백엔드 server.js가 service_role 키로 대신 쓰기 — 더 엄격하지만 엔드포인트 추가 필요. 실서비스 전환 시 고려. 데모는 권장안으로 충분.)

---

## 2. 보안 메모 (중요 — 원칙 3과 충돌 아님)

- **anon public key는 프론트에 넣어도 된다.** 이건 공개되도록 설계된 키이고, 보호는 **RLS(Row Level Security)** 정책이 담당한다. Solar/Upstage 키처럼 "새어나가면 안 되는 비밀"이 아니다.
- **절대 프론트에 넣지 말 것: `service_role` 키.** 백엔드(Render env)에서만 사용.
- 데모는 가상 데이터 전제라 관대한 정책을 쓰되, 실서비스 전환 시엔 인증(Supabase Auth) + 사용자별 RLS로 잠가야 함(아래 6절).

---

## 3. DB 스키마 (Supabase SQL Editor에서 실행)

```sql
-- 임상 신호 1행 = 환자 메시지 1건에서 추출한 결과
create table if not exists entries (
  id          uuid primary key default gen_random_uuid(),
  patient_id  text not null,                 -- 어느 (가상) 환자인지
  created_at  timestamptz not null default now(),
  text        text,                          -- 원문 (red_flag 근거용)
  sleep_h     numeric,
  med_taken   boolean,
  mood        int,
  stressor    text,
  red_flag    boolean not null default false,
  evidence    text
);

-- 조회 성능
create index if not exists entries_patient_idx on entries (patient_id, created_at);

-- RLS 켜기
alter table entries enable row level security;

-- 데모 정책(가상 데이터 전제): anon이 insert/select 허용
create policy "demo_insert" on entries for insert to anon with check (true);
create policy "demo_select" on entries for select to anon using (true);
```

> 실서비스라면 위 두 정책 대신 `auth.uid()` 기반으로 본인/담당 환자만 접근하도록 좁혀야 함.

---

## 4. 프론트 연동 (app.html — Claude Code 구현)

### 4-1. 라이브러리 + 설정
`</head>` 전 또는 스크립트 상단에:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```
`BACKEND_URL` 근처에 설정 추가:
```js
/* 비우면 클라우드 저장 끔 → 기존 localStorage·메모리로 폴백(데모 안 깨짐). */
const SUPABASE_URL = "";       // 예: "https://xxxx.supabase.co"
const SUPABASE_ANON = "";      // anon public key (공개 가능 — RLS가 보호)
const sb = (SUPABASE_URL && SUPABASE_ANON && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON) : null;

/* (가상) 환자 식별자 — 의사 뷰가 같은 id로 읽어옴. 데모용 고정 or localStorage 보관. */
function patientId(){
  let id = localStorage.getItem('mindhub_pid');
  if(!id){ id = 'demo-' + Math.random().toString(36).slice(2,8); localStorage.setItem('mindhub_pid', id); }
  return id;
}
```

### 4-2. 저장 (기존 `collectSignals`에 한 줄 추가 — fire-and-forget)
기존 `collectSignals(text)`는 그대로 두고, 추출된 `sig`를 클라우드에도 비동기 저장. **채팅·기존 동작 절대 차단 금지.**
```js
async function saveSignalToCloud(text, sig){
  if(!sb) return;                         // 미설정 시 조용히 폴백
  try{
    await sb.from('entries').insert({
      patient_id: patientId(),
      text,
      sleep_h: sig.sleep_h, med_taken: sig.med_taken,
      mood: sig.mood, stressor: sig.stressor,
      red_flag: sig.red_flag, evidence: sig.evidence
    });
  }catch(e){ console.warn('supabase insert failed', e); }  // 실패해도 UX 유지
}
```
`collectSignals` 안에서 `collected.push(...)` 직후 `saveSignalToCloud(text, sig);` 호출(await 안 함).
→ `red_flag`는 프론트 규칙 기반으로 이미 계산된 값이므로 안전은 네트워크와 무관하게 보장됨.

### 4-3. 읽기 (의사용 — 기존 리포트가 메모리 대신 클라우드를 쓸 수 있게)
`aggregate()`가 `collected`(메모리)를 쓰는데, 의사 뷰에선 Supabase에서 같은 환자의 행을 불러와 동일 형태로 변환:
```js
async function loadCloudEntries(pid){
  if(!sb) return null;                    // 폴백 신호
  try{
    const { data, error } = await sb.from('entries')
      .select('*').eq('patient_id', pid).order('created_at',{ascending:true});
    if(error) throw error;
    // aggregate()가 기대하는 {sig:{...}} 형태로 매핑
    return data.map(r => ({ at:r.created_at, text:r.text, sig:{
      sleep_h:r.sleep_h, med_taken:r.med_taken, mood:r.mood,
      stressor:r.stressor, red_flag:r.red_flag, evidence:r.evidence }}));
  }catch(e){ console.warn('supabase select failed', e); return null; }
}
```
의사 리포트 열 때: `const cloud = await loadCloudEntries(pid); const src = cloud ?? collected;` 처럼 **클라우드 있으면 그걸, 없으면 기존 `collected`**를 쓰게 한다(폴백).

---

## 5. 데이터 흐름 (연동 후)

```
[환자 app.html]
  메시지 → /chat(Solar) → 화면 답변
        → getSignals(/extract, 폴백) → sig
        → collected[] (메모리, 기존)         ┐ 둘 다
        → saveSignalToCloud → [Supabase entries] ┘ (sb 없으면 위만)
  위험감지: RISK_WORDS 규칙 기반(프론트, 항상)

[의사 뷰]  ── loadCloudEntries(pid) ──→ [Supabase entries] → aggregate() → 리포트
            (sb 없으면 같은 세션 collected[]로 폴백)
```

---

## 6. 실서비스 전환 시 (발표엔 불필요, 메모만)
- Supabase Auth 도입 → 환자/의사 계정 분리, RLS를 `auth.uid()`/담당관계로 잠금.
- `text`(원문) 저장 최소화 또는 암호화, 동의·보관기간 정책.
- 백엔드 경유 쓰기(service_role)로 전환해 정책을 서버에서 강제.

---

## 7. 테스트 체크리스트 (Claude Code 구현 후)
- [ ] `SUPABASE_URL` 비우면 기존대로 동작(클라우드 호출 0, 데모 안 깨짐).
- [ ] 채우면 환자 메시지 후 `entries`에 행이 쌓인다(Supabase Table Editor 확인).
- [ ] 저장이 채팅 답변을 **지연시키지 않는다**(fire-and-forget).
- [ ] 저장 실패(잘못된 키 등) 시 `console.warn`만, 채팅·추출은 정상.
- [ ] 의사 뷰가 같은 `patient_id` 행으로 리포트를 그린다.
- [ ] `red_flag`는 여전히 프론트 규칙 기반으로 계산·저장된다.
- [ ] anon key만 프론트에 있고 `service_role` 키는 어디에도 노출되지 않는다.

---

## 8. 준비물
- supabase.com 프로젝트 → **Project URL** + **anon public key** (준비물_체크리스트.md 참고, 기존 것 재사용 가능).
- 위 3절 SQL 실행 → `entries` 테이블 + RLS 정책 생성.
- app.html에 URL·anon key 입력(권장: 발표용으로만, 실서비스 전 잠그기).
