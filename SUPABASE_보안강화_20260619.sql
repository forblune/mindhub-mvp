-- 마음기록 MVP: 역할 상승 차단 + 환자 공유 설정 DB 강제
-- Supabase SQL Editor에서 프로젝트 1회 실행.

begin;

-- 1) 환자별 공유 설정. 안전(red_flag/evidence)은 제품 고지대로 항상 포함.
alter table public.profiles
  add column if not exists share_initialized boolean not null default false,
  add column if not exists share_sleep boolean not null default true,
  add column if not exists share_med boolean not null default true,
  add column if not exists share_stressor boolean not null default true,
  add column if not exists share_mood boolean not null default true;

-- 2) 신규 가입 프로필 생성 트리거를 확실히 복구하고 기존 인증 사용자를 백필.
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
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'name',
    u.raw_user_meta_data->>'nickname',
    split_part(u.email, '@', 1),
    '사용자'
  )
from auth.users u
on conflict (id) do nothing;

-- 3) 역할 판별 함수의 search_path 고정.
create or replace function public.is_doctor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles
    where id = auth.uid() and role = 'doctor'
  );
$$;

revoke all on function public.is_doctor() from public;
grant execute on function public.is_doctor() to authenticated;

-- 4) 본인 행 전체 UPDATE를 막고, 환자가 바꿔도 되는 열만 허용.
--    role은 Supabase 관리자/서비스 역할만 변경할 수 있다.
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "own profile update allowed fields" on public.profiles;

revoke update on table public.profiles from authenticated;
grant update (
  display_name,
  share_initialized,
  share_sleep,
  share_med,
  share_stressor,
  share_mood
) on table public.profiles to authenticated;

create policy "own profile update allowed fields"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- 5) 의사가 entries 원자료를 직접 SELECT하는 정책 제거.
drop policy if exists "doctor select all entries" on public.entries;

-- 6) 환자 공유 설정을 DB에서 적용한 의사용 읽기 전용 RPC.
--    비공개 필드는 NULL, 일반 대화 원문은 항상 미전송,
--    안전 근거 원문만 red_flag=true일 때 전달한다.
create or replace function public.get_patient_report_entries(target_patient uuid)
returns table (
  created_at timestamptz,
  text text,
  sleep_h numeric,
  med_taken boolean,
  mood int,
  stressor text,
  red_flag boolean,
  evidence text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    e.created_at,
    null::text as text,
    case when p.share_initialized and p.share_sleep then e.sleep_h else null end as sleep_h,
    case when p.share_initialized and p.share_med then e.med_taken else null end as med_taken,
    case when p.share_initialized and p.share_mood then e.mood else null end as mood,
    case when p.share_initialized and p.share_stressor then e.stressor else null end as stressor,
    e.red_flag,
    case when e.red_flag then e.evidence else null end as evidence
  from public.entries e
  join public.profiles p on p.id::text = e.patient_id
  where p.id = target_patient
    and public.is_doctor()
  order by e.created_at asc;
$$;

revoke all on function public.get_patient_report_entries(uuid) from public;
grant execute on function public.get_patient_report_entries(uuid) to authenticated;

commit;
