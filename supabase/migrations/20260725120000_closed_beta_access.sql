-- MindHub closed-beta 접근권한 구조
-- 목적: 로그인(auth.users)은 이미 누구나 가능하지만(가입 자체는 별도 Hard Stop 항목으로 잠금),
--       "로그인 성공"과 "실제 환자 앱 사용 허가"를 분리한다. 기본값은 항상 거부(default deny)이며,
--       service_role/관리자가 수동으로 승인한 계정만 채팅·기록 저장을 사용할 수 있다.
--
-- 설계 결정: profiles.access_status 컬럼 대신 별도 app_access_grants 테이블을 선택.
--   - 역할(profiles.role: patient/doctor)과 제품 접근권한(closed-beta)을 완전히 분리해,
--     의사 역할이 곧 접근 허가를 의미하지 않도록 한다(둘은 독립적으로 부여됨).
--   - granted_by/granted_at/revoked_at/note로 감사 이력을 자연스럽게 남길 수 있다(컬럼 하나로는 어려움).
--   - 향후 기관 파일럿 확장(기관 단위 초대, 만료일 등) 시 컬럼 추가보다 테이블 확장이 더 유연하다.
--
-- 운영 프로젝트에는 이 파일을 자동 적용하지 않는다(Supabase MCP는 read-only로만 사용).
-- 기존 SUPABASE_보안강화_20260619.sql과 동일하게 SQL Editor에서 수동 실행하는 것을 전제로 작성했다
-- (이 프로젝트는 Supabase CLI 마이그레이션 이력을 트래킹하지 않는 것으로 감사에서 확인됨 — docs/audit 참고).

begin;

-- 1) 접근권한 테이블. 행이 없거나 status != 'approved'면 접근 불가(기본 거부).
create table if not exists public.app_access_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','approved','revoked')),
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz,
  revoked_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.set_app_access_grants_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_access_grants_set_updated_at on public.app_access_grants;
create trigger app_access_grants_set_updated_at
before update on public.app_access_grants
for each row execute function public.set_app_access_grants_updated_at();

-- 2) 신규 가입자를 'pending'(=미승인)으로 자동 등록해 감사 목록에 항상 나타나게 한다.
--    승인은 절대 자동으로 일어나지 않는다 — status는 여기서 항상 'pending'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'nickname',
      split_part(new.email, '@', 1),
      '사용자'
    )
  )
  on conflict (id) do nothing;

  insert into public.app_access_grants (user_id, status)
  values (new.id, 'pending')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

-- 트리거는 이미 SUPABASE_보안강화_20260619.sql에서 생성돼 있음 — 함수 본문만 갱신되면 되므로
-- 여기서는 안전하게 재생성만 한다(중복 트리거 방지).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 3) 기존 가입자를 백필하되 전부 'pending'으로만 넣는다 — 자동 승인 금지.
insert into public.app_access_grants (user_id, status)
select u.id, 'pending'
from auth.users u
on conflict (user_id) do nothing;

-- 4) RLS: 본인 행만 조회 가능. INSERT/UPDATE/DELETE 정책은 의도적으로 만들지 않는다
--    (아래 REVOKE로 authenticated/anon은애초에 쓰기 권한이 없음 — service_role만 변경 가능).
alter table public.app_access_grants enable row level security;

revoke all on table public.app_access_grants from authenticated, anon;
grant select on table public.app_access_grants to authenticated;

drop policy if exists "own access status select" on public.app_access_grants;
create policy "own access status select"
on public.app_access_grants
for select
to authenticated
using (auth.uid() = user_id);

-- 5) 승인 여부 판별 함수 — is_doctor()와 동일한 SECURITY DEFINER 패턴(재귀 RLS 회피, search_path 고정).
create or replace function public.has_beta_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1
    from public.app_access_grants
    where user_id = auth.uid() and status = 'approved'
  );
$$;

revoke all on function public.has_beta_access() from public;
grant execute on function public.has_beta_access() to authenticated;

-- 6) entries 직접 API 호출 차단: 로그인만으로는 부족하고 승인(has_beta_access)까지 있어야
--    본인 임상 신호를 쓰거나 읽을 수 있다. anon key로 REST를 직접 두드려도 동일하게 막힌다.
--    (의사 조회는 get_patient_report_entries RPC를 통해서만 이뤄지며, 이 RPC는 SECURITY DEFINER로
--     이 정책과 무관하게 계속 동작한다 — 회귀 없음.)
drop policy if exists "patient insert own" on public.entries;
create policy "patient insert own"
on public.entries
for insert
to authenticated
with check (patient_id = auth.uid()::text and public.has_beta_access());

drop policy if exists "patient select own" on public.entries;
create policy "patient select own"
on public.entries
for select
to authenticated
using (patient_id = auth.uid()::text and public.has_beta_access());

commit;

-- ────────────────────────────────────────────────────────────────
-- ROLLBACK (수동 실행용 — 이 마이그레이션에는 포함되지 않음, 필요 시에만 아래를 직접 실행)
-- ────────────────────────────────────────────────────────────────
-- begin;
--   drop policy if exists "patient insert own" on public.entries;
--   create policy "patient insert own" on public.entries
--     for insert to authenticated with check (patient_id = auth.uid()::text);
--   drop policy if exists "patient select own" on public.entries;
--   create policy "patient select own" on public.entries
--     for select to authenticated using (patient_id = auth.uid()::text);
--   drop function if exists public.has_beta_access();
--   drop trigger if exists app_access_grants_set_updated_at on public.app_access_grants;
--   drop function if exists public.set_app_access_grants_updated_at();
--   drop table if exists public.app_access_grants;
--   -- handle_new_user()는 SUPABASE_보안강화_20260619.sql 버전(app_access_grants insert 없는 버전)으로
--   -- create or replace 하여 되돌린다.
-- commit;
