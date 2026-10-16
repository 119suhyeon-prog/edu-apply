-- supabase_setup.sql – 문의 접수 현황판 (4회차 예제 2)
-- 예제 1과 같은 Supabase 프로젝트(academy)에서 실행합니다. 예제 1의 edu_ 표는 건드리지 않습니다.
-- 사용법 : SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
-- 여러 번 실행해도 됩니다. 실행할 때마다 처음 상태(가상 문의 12건)로 되돌아갑니다.
-- "Potential issue detected" 확인 창이 뜨면 [Run query]를 누르세요. (아래 drop 때문)

-- ============ 1. 표 ============
drop table if exists public.inq_list;
drop table if exists public.inq_seq;

-- 연도별 마지막 접수번호 (화면에서는 쓰지 않음)
create table public.inq_seq (
  year    int primary key,
  last_no int not null
);

create table public.inq_list (
  id            text primary key,                      -- Q-2026-001 (DB가 발급)
  channel       text not null check (channel in ('전화', '메일', '방문')),
  type          text not null check (type in ('제도문의', '시스템오류', '자료요청', '기타')),
  title         text not null check (length(btrim(title)) > 0),
  content       text not null default '',
  owner         text not null check (length(btrim(owner)) > 0),
  received_date date not null,
  due_date      date not null,
  status        text not null default '접수' check (status in ('접수', '처리중', '답변완료')),
  answer        text not null default '',
  answered_at   timestamptz
);


-- ============ 2. 업무 규칙 (DB가 최종 판정) ============

-- R-02 답변기한 : 접수일 다음 날부터 토·일을 빼고 3일째
create or replace function public.inq_due_date(received date)
returns date
language plpgsql
immutable
as $$
declare
  d date := received;
  n int  := 0;
begin
  while n < 3 loop
    d := d + 1;
    if extract(isodow from d) < 6 then  -- 1=월 … 5=금
      n := n + 1;
    end if;
  end loop;
  return d;
end;
$$;

-- 문의가 들어올 때 : 접수일·답변기한·상태를 DB가 정하고, R-01 접수번호 발급
create or replace function public.inq_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y  int;
  no int;
begin
  new.received_date := coalesce(new.received_date, (now() at time zone 'Asia/Seoul')::date);
  new.due_date      := inq_due_date(new.received_date);
  new.status        := '접수';
  new.answer        := '';
  new.answered_at   := null;
  new.title         := btrim(new.title);
  new.owner         := btrim(new.owner);

  -- 번호는 '지금 건수 + 1'이 아니라 연도별 번호표에서 뽑는다 (삭제해도 재사용 안 함, 동시 등록에도 안 겹침)
  y := extract(year from new.received_date);
  insert into inq_seq (year, last_no) values (y, 1)
    on conflict (year) do update set last_no = inq_seq.last_no + 1
    returning last_no into no;

  new.id := 'Q-' || y || '-' || lpad(no::text, 3, '0');
  return new;
end;
$$;

create trigger inq_list_before_insert
  before insert on public.inq_list
  for each row execute function public.inq_before_insert();

-- R-03 상태 순서 · R-04 답변 필수, 답변완료 후 수정 불가
create or replace function public.inq_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = '답변완료' then
    raise exception '수정 불가 : 답변완료된 문의(%)는 더 이상 고칠 수 없습니다.', old.id;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = '접수'   and new.status = '처리중')
         or (old.status = '처리중' and new.status = '답변완료')) then
      raise exception '상태 변경 불가 : 「%」에서 「%」(으)로는 바꿀 수 없습니다. 접수 → 처리중 → 답변완료 순서로 한 단계씩 바꿉니다.', old.status, new.status;
    end if;
    if new.status = '답변완료' then
      if length(btrim(coalesce(new.answer, ''))) = 0 then
        raise exception '답변 필요 : 답변내용을 입력해야 답변완료로 바꿀 수 있습니다.';
      end if;
      new.answered_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger inq_list_before_update
  before update on public.inq_list
  for each row execute function public.inq_before_update();


-- ============ 3. 누가 무엇을 할 수 있나 (RLS + 칸별 권한) ============
alter table public.inq_list enable row level security;
alter table public.inq_seq  enable row level security;   -- 정책 없음 = 화면에서 접근 불가

create policy "inq_읽기" on public.inq_list for select using (true);
create policy "inq_등록" on public.inq_list for insert with check (true);
create policy "inq_수정" on public.inq_list for update using (true) with check (true);
create policy "inq_삭제" on public.inq_list for delete using (true);

-- R-07 : 공개용 키로는 읽기·등록·삭제, 그리고 상태·답변 고치기만
revoke all on public.inq_list, public.inq_seq from anon, authenticated;
grant select, delete on public.inq_list to anon, authenticated;
grant insert (channel, type, title, content, owner) on public.inq_list to anon, authenticated;
grant update (status, answer) on public.inq_list to anon, authenticated;


-- ============ 4. 가상 문의 12건 (문의자 정보 없음, 담당자는 가상 이름) ============
insert into public.inq_list (received_date, channel, type, title, content, owner) values
  ('2026-09-29', '전화', '제도문의',   '연차 이월 기준 문의',       '올해 남은 연차를 내년으로 넘길 수 있는지 문의',   '김가상'),
  ('2026-09-30', '메일', '자료요청',   '9월 운영회의 회의록 요청',   '9월 운영회의 회의록 사본을 받고 싶다는 요청',     '이가상'),
  ('2026-10-05', '방문', '시스템오류', '출입증 발급 화면 오류',     '출입증 신청 화면에서 저장 버튼이 눌리지 않음',     '박가상'),
  ('2026-10-06', '메일', '제도문의',   '출장 여비 정산 기한',       '출장 다녀온 뒤 며칠 안에 정산해야 하는지',       '최가상'),
  ('2026-10-07', '전화', '기타',       '주차 등록 차량 변경',       '등록 차량을 바꾸는 방법 문의',                   '정가상'),
  ('2026-10-08', '메일', '시스템오류', '그룹웨어 로그인 지연',     '아침 시간대 로그인이 1분 이상 걸림',             '김가상'),
  ('2026-10-08', '전화', '자료요청',   '교육 이수증 재발급',       '작년 교육 이수증을 다시 받을 수 있는지',         '한가상'),
  ('2026-10-12', '방문', '제도문의',   '유연근무 신청 절차',       '유연근무 신청서는 어디에 내는지',               '오가상'),
  ('2026-10-12', '메일', '시스템오류', '공용 프린터 스캔 오류',     '3층 프린터 스캔 파일이 메일로 오지 않음',         '윤가상'),
  ('2026-10-12', '전화', '기타',       '회의실 비품 요청',         '대회의실 마이크 배터리 교체 요청',               '이가상'),
  ('2026-10-13', '메일', '자료요청',   '안전점검 양식 요청',       '사무실 안전점검 체크리스트 양식 요청',           '박가상'),
  ('2026-10-13', '전화', '제도문의',   '교육 신청 마감일 문의',     '생성형 AI 실무 과정 신청 마감일 문의',           '최가상');

-- 상태는 규칙(R-03 · R-04)대로 한 단계씩 바꿔 둔다
update public.inq_list set status = '처리중'
 where id in ('Q-2026-001', 'Q-2026-002', 'Q-2026-003', 'Q-2026-005', 'Q-2026-006', 'Q-2026-009', 'Q-2026-010');
update public.inq_list set answer = '당해 연도 미사용 연차는 규정에 따라 처리됩니다. (교육용 가상 답변)', status = '답변완료' where id = 'Q-2026-001';
update public.inq_list set answer = '회의록 사본을 메일로 보냈습니다. (교육용 가상 답변)', status = '답변완료' where id = 'Q-2026-002';
update public.inq_list set answer = '차량 변경은 총무팀 양식으로 신청합니다. (교육용 가상 답변)', status = '답변완료' where id = 'Q-2026-005';
update public.inq_list set answer = '배터리 교체를 마쳤습니다. (교육용 가상 답변)', status = '답변완료' where id = 'Q-2026-010';

-- 확인 : 12줄이 나오고 Q-2026-001의 답변기한이 2026-10-02이면 성공
select id, received_date, due_date, status, title from public.inq_list order by id;
