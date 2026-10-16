// logic.js – 계산·판정 규칙만 둔다 (화면을 다루는 코드 금지)
// 규칙 번호는 PRD.md 6장을 따른다. 최종 판정은 DB(supabase_setup.sql)가 하고, 여기서는 미리 안내한다.

const STATUS_FLOW = ['접수', '처리중', '답변완료'];

// ---- 날짜 (toISOString 금지 : 한국 시간에서 하루가 밀림) ----
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return formatDate(new Date());
}

function parseDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

// R-02 답변기한 : 접수일 다음 날부터 (토·일 빼고) 3일째
function calcDueDate(receivedDate, skipWeekend = true) {
  if (!skipWeekend) return addDays(receivedDate, 3);
  let d = receivedDate;
  let n = 0;
  while (n < 3) {
    d = addDays(d, 1);
    const day = parseDate(d).getDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6) n++;
  }
  return d;
}

// R-05 기한초과 : 오늘이 답변기한보다 뒤이고 답변완료가 아님
function isOverdue(inquiry, today) {
  return inquiry.status !== '답변완료' && String(today) > String(inquiry.dueDate);
}

// 다음 상태 (마지막이면 빈 문자열)
function nextStatus(from) {
  const i = STATUS_FLOW.indexOf(from);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : '';
}

// R-03 한 단계씩만 · R-04 답변완료는 답변이 있어야
function canChangeStatus(from, to, answer) {
  if (nextStatus(from) !== to) return false;
  if (to === '답변완료' && String(answer ?? '').trim() === '') return false;
  return true;
}

// R-06 이번 주 : 오늘이 속한 주의 월요일~일요일
function isThisWeek(date, today) {
  if (!date) return false;
  const day = parseDate(today).getDay();
  const monday = addDays(today, day === 0 ? -6 : 1 - day);
  const sunday = addDays(monday, 6);
  return date >= monday && date <= sunday;
}

// 요약 카드 4개
function summarize(list, today) {
  return {
    todayCount: list.filter(q => q.receivedDate === today).length,
    inProgress: list.filter(q => q.status === '처리중').length,
    overdue: list.filter(q => isOverdue(q, today)).length,
    weekDone: list.filter(q => q.status === '답변완료' && isThisWeek(q.answeredDate, today)).length,
  };
}

// F-06 검색(제목·내용) + 상태 필터
function filterList(list, keyword, status) {
  const k = String(keyword ?? '').trim().toLowerCase();
  return list.filter(q =>
    (!status || q.status === status) &&
    (!k || String(q.title).toLowerCase().includes(k) || String(q.content).toLowerCase().includes(k)));
}

// F-07 문의유형별 건수 (많은 순)
function countByType(list) {
  const counts = {};
  for (const q of list) counts[q.type] = (counts[q.type] || 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'ko'));
}

// 접수 최신순 (같은 날이면 번호 큰 순)
function sortByReceived(list) {
  return [...list].sort((a, b) =>
    b.receivedDate.localeCompare(a.receivedDate) || b.id.localeCompare(a.id));
}
