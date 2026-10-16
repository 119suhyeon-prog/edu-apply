-- supabase_setup.sql – 교육 신청 현황 관리 (4회차 예제 1)
-- 사용법 : Supabase → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
-- 여러 번 실행해도 됩니다. 실행할 때마다 처음 상태(가상 신청 8건)로 되돌아갑니다.
-- "Potential issue detected" 확인 창이 뜨면 [Run query]를 누르세요. (아래 drop 때문)

-- ============ 1. 표 ============
drop table if exists public.edu_apps;
drop table if exists public.edu_courses;

create table public.edu_courses (
  course   text primary key,
  capacity int  not null default 5 check (capacity between 1 and 100)
);

create table public.edu_apps (
  id         bigint generated always as identity primary key,
  course     text not null references public.edu_courses (course),
  date       date not null,
  hours      int  not null check (hours > 0),
  name       text not null check (length(btrim(name)) > 0),
  team       text not null,
  status     text not null default '신청' check (status in ('신청', '이수', '취소')),
  created_at timestamptz not null default now()
);

-- R-01 중복 : 같은 과정·같은 이름의 '취소 아닌' 신청은 하나만
create unique index edu_apps_no_dup on public.edu_apps (course, name) where status <> '취소';


-- ============ 2. 업무 규칙 (DB가 최종 판정) ============

-- 신청이 들어올 때 : 공백 제거 → 과정 자동 등록 → R-02 정원 → R-01 중복
create or replace function public.edu_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  cnt int;
begin
  new.name       := btrim(new.name);
  new.course     := btrim(new.course);
  new.status     := '신청';
  new.created_at := now();

  -- 처음 보는 과정이면 정원 5명으로 등록
  insert into edu_courses (course) values (new.course) on conflict (course) do nothing;

  -- 같은 과정에 동시에 들어온 신청은 여기서 한 줄로 세운다 (마지막 한 자리 동시 신청 대비)
  select capacity into cap from edu_courses where course = new.course for update;

  select count(*) into cnt from edu_apps where course = new.course and status <> '취소';
  if cnt >= cap then
    raise exception '정원 마감 : 「%」은 정원 %명이 모두 찼습니다.', new.course, cap;
  end if;

  if exists (select 1 from edu_apps where course = new.course and name = new.name and status <> '취소') then
    raise exception '중복 신청 : % 님은 이미 「%」에 신청했습니다.', new.name, new.course;
  end if;

  return new;
end;
$$;

create trigger edu_apps_before_insert
  before insert on public.edu_apps
  for each row execute function public.edu_before_insert();

-- R-04 상태 변경 : 신청 → 이수, 신청 → 취소만
create or replace function public.edu_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not (old.status = '신청' and new.status in ('이수', '취소')) then
    raise exception '상태 변경 불가 : 「%」 상태는 「%」(으)로 바꿀 수 없습니다.', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger edu_apps_before_update
  before update on public.edu_apps
  for each row execute function public.edu_before_update();


-- ============ 3. 누가 무엇을 할 수 있나 (RLS + 칸별 권한) ============
alter table public.edu_courses enable row level security;
alter table public.edu_apps    enable row level security;

create policy "edu_과정_읽기"     on public.edu_courses for select using (true);
create policy "edu_과정_정원변경" on public.edu_courses for update using (true) with check (true);
create policy "edu_신청_읽기"     on public.edu_apps    for select using (true);
create policy "edu_신청_등록"     on public.edu_apps    for insert with check (true);
create policy "edu_신청_상태변경" on public.edu_apps    for update using (true) with check (true);

-- R-06 : 공개용 키로는 읽기·신청·상태·정원만. 이름 고치기와 삭제는 안 됨
revoke all on public.edu_courses, public.edu_apps from anon, authenticated;
grant select on public.edu_courses, public.edu_apps to anon, authenticated;
grant insert (course, date, hours, name, team) on public.edu_apps to anon, authenticated;
grant update (status)   on public.edu_apps    to anon, authenticated;
grant update (capacity) on public.edu_courses to anon, authenticated;


-- ============ 4. 가상 데이터 (3회차와 같은 8건) ============
insert into public.edu_courses (course, capacity) values
  ('정보보안 기본', 5),
  ('생성형 AI 실무', 5),
  ('보고서 작성 기초', 5);

insert into public.edu_apps (course, date, hours, name, team) values
  ('정보보안 기본',   '2026-09-24', 3, '김가상', '기획팀'),
  ('정보보안 기본',   '2026-09-24', 3, '이가상', '안전팀'),
  ('정보보안 기본',   '2026-09-24', 3, '박가상', '운영팀'),
  ('생성형 AI 실무',  '2026-10-16', 7, '김가상', '기획팀'),
  ('생성형 AI 실무',  '2026-10-16', 7, '최가상', '안전팀'),
  ('생성형 AI 실무',  '2026-10-16', 7, '정가상', '운영팀'),
  ('생성형 AI 실무',  '2026-10-16', 7, '한가상', '기획팀'),
  ('보고서 작성 기초', '2026-11-05', 4, '오가상', '운영팀');

-- 새 신청은 항상 '신청'으로 들어가므로, 지난 과정의 상태는 규칙(R-04)대로 바꿔 둔다
update public.edu_apps set status = '이수' where course = '정보보안 기본' and name in ('김가상', '이가상');
update public.edu_apps set status = '취소' where course = '정보보안 기본' and name = '박가상';

-- 확인 : 아래 결과에 8줄이 나오면 성공
select id, course, date, name, status from public.edu_apps order by date, id;
