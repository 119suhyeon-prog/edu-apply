// app.js – 화면 동작 (입력 받기, 목록 그리기, 버튼 이벤트)
// 규칙 판정은 logic.js, 저장과 최종 판정은 Supabase DB가 맡는다.

let list = [];          // inq_list (화면용 모양)
let selectedId = '';    // 상세 패널에 열린 문의

// ===== 저장 위치 : Supabase DB =====
// Supabase를 부르는 곳은 이 구역의 함수뿐이다.

// config.js 점검 : 아직 안 채웠거나, 비밀 키를 넣었으면 연결하지 않는다
function checkConfig() {
  if (SUPABASE_URL.includes('여기에') || SUPABASE_KEY.includes('여기에')) {
    return 'config.js에 Supabase 주소와 공개용 키를 넣어 주세요.';
  }
  let role = '';
  try { role = JSON.parse(atob(SUPABASE_KEY.split('.')[1])).role; } catch (e) { /* 새 형식 키 */ }
  if (SUPABASE_KEY.startsWith('sb_secret_') || role === 'service_role') {
    return '비밀 키(Secret · service_role)가 들어 있습니다! 지우고 공개용 키(Publishable · anon)로 바꾸세요.';
  }
  return '';
}

let db = null;
const configProblem = checkConfig();
if (!configProblem) {
  try {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error('Supabase 연결 설정 오류 :', e.message);
  }
}

// DB 한 줄 → 화면에서 쓰는 모양 (3회차 이름으로)
function fromRow(r) {
  return {
    id: r.id, channel: r.channel, type: r.type, title: r.title, content: r.content, owner: r.owner,
    receivedDate: r.received_date, dueDate: r.due_date, status: r.status, answer: r.answer,
    answeredAt: r.answered_at, answeredDate: r.answered_at ? formatDate(new Date(r.answered_at)) : '',
  };
}

// DB가 보낸 거부 이유를 화면 메시지로
function dbError(error) {
  if (error.code === '42501') return new Error('이 칸은 바꿀 수 없습니다. (DB 권한)');
  return new Error(error.message);
}

// 전체 불러오기
async function loadData() {
  if (!db) throw new Error(configProblem || 'Supabase에 연결하지 못했습니다. config.js의 주소를 확인해 주세요.');
  const { data, error } = await db.from('inq_list').select('*');
  if (error) throw dbError(error);
  list = data.map(fromRow);
}

// 문의 1건 등록 → DB가 정한 접수번호를 돌려준다
async function insertInquiry(inquiry) {
  const { channel, type, title, content, owner } = inquiry;
  const { data, error } = await db.from('inq_list')
    .insert({ channel, type, title, content, owner })
    .select('id')
    .single();
  if (error) throw dbError(error);
  await loadData();
  return data.id;
}

// 상태·답변 고치기
async function updateInquiry(id, fields) {
  const { error } = await db.from('inq_list').update(fields).eq('id', id);
  if (error) {
    await loadData().catch(() => {});
    throw dbError(error);
  }
  await loadData();
}

// 삭제 (번호는 다시 쓰지 않는다)
async function deleteInquiry(id) {
  const { error } = await db.from('inq_list').delete().eq('id', id);
  if (error) throw dbError(error);
  await loadData();
}
// ===== 저장 위치 끝 =====


// ---- 화면 도우미 ----
function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn('요소 없음: ' + id);
  return el;
}

function make(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text; // 입력값은 항상 textContent로 표시
  if (className) el.className = className;
  return el;
}

function showMessage(text, type) {
  const box = $('msgBox');
  if (!box) return;
  box.textContent = text;
  box.className = 'msg ' + (type || '');
}


// ---- F-01 · F-02 등록 ----
async function addInquiry() {
  const inquiry = {
    channel: $('channelSelect').value,
    type: $('typeSelect').value,
    title: $('titleInput').value.trim(),
    content: $('contentInput').value.trim(),
    owner: $('ownerInput').value.trim(),
  };
  if (!inquiry.title || !inquiry.owner) {
    showMessage('제목과 담당자를 입력해 주세요.', 'error');
    return;
  }
  $('addBtn').disabled = true;
  try {
    const no = await insertInquiry(inquiry);
    $('inquiryForm').reset();
    updateDuePreview();
    showMessage(`${no} 로 접수했습니다.`, 'ok');
    selectedId = no;
  } catch (e) {
    showMessage('등록하지 못했습니다 : ' + e.message, 'error');
  }
  $('addBtn').disabled = false;
  renderAll();
}

// 등록 폼 아래 '예상 답변기한' (최종 기한은 DB가 정한다)
function updateDuePreview() {
  const box = $('duePreview');
  if (box) box.textContent = `오늘 접수하면 예상 답변기한 : ${calcDueDate(todayStr())} (토·일 제외 3일)`;
}

// ---- F-04 상태 변경 ----
async function changeStatus(id, to) {
  const q = list.find(x => x.id === id);
  if (!q) return;
  const answer = $('answerInput') ? $('answerInput').value : q.answer;
  if (!canChangeStatus(q.status, to, answer)) {              // R-03 · R-04 미리 안내
    showMessage(nextStatus(q.status) !== to
      ? `「${q.status}」에서 「${to}」(으)로는 바꿀 수 없습니다. 한 단계씩 바꿉니다.`
      : '답변내용을 입력해야 답변완료로 바꿀 수 있습니다.', 'error');
    return;
  }
  const fields = to === '답변완료' ? { status: to, answer: answer.trim() } : { status: to };
  try {
    await updateInquiry(id, fields);
    showMessage(`${id} → ${to}`, 'ok');
  } catch (e) {
    showMessage('상태를 바꾸지 못했습니다 : ' + e.message, 'error');
  }
  renderAll();
}

// F-03 답변만 저장 (상태는 그대로)
async function saveAnswer(id) {
  try {
    await updateInquiry(id, { answer: $('answerInput').value.trim() });
    showMessage(`${id} 답변을 저장했습니다.`, 'ok');
  } catch (e) {
    showMessage('답변을 저장하지 못했습니다 : ' + e.message, 'error');
  }
  renderAll();
}

// F-08 삭제
async function removeInquiry(id) {
  try {
    await deleteInquiry(id);
    selectedId = '';
    showMessage(`${id} 를 삭제했습니다. 이 번호는 다시 쓰지 않습니다.`, 'ok');
  } catch (e) {
    showMessage('삭제하지 못했습니다 : ' + e.message, 'error');
  }
  renderAll();
}

// F-09 다른 사람이 등록한 문의 다시 읽기
async function reloadData() {
  try {
    await loadData();
    showMessage('최신 목록을 불러왔습니다.', 'ok');
  } catch (e) {
    showMessage('데이터를 불러오지 못했습니다 : ' + e.message, 'error');
  }
  renderAll();
}


// ---- 화면 그리기 ----
// F-05 요약 카드
function renderSummary() {
  const box = $('summaryCards');
  if (!box) return;
  const s = summarize(list, todayStr());
  box.replaceChildren();
  for (const [label, value, cls] of [
    ['오늘 접수', s.todayCount, ''], ['처리중', s.inProgress, ''],
    ['기한초과', s.overdue, s.overdue ? 'alert' : ''], ['이번 주 답변완료', s.weekDone, ''],
  ]) {
    const card = make('div', undefined, 'sum-card ' + cls);
    card.append(make('div', label, 'muted'), make('div', value + '건', 'count'));
    box.append(card);
  }
}

// F-03 목록 (F-05 기한초과 강조, F-06 검색·필터)
function renderTable() {
  const body = $('inquiryTable');
  if (!body) return;
  const today = todayStr();
  const rows = sortByReceived(filterList(list, $('searchInput').value, $('statusFilter').value));
  body.replaceChildren();
  for (const q of rows) {
    const tr = make('tr');
    if (isOverdue(q, today)) tr.className = 'overdue';
    if (q.id === selectedId) tr.classList.add('selected');
    tr.append(make('td', q.id), make('td', q.receivedDate), make('td', q.channel), make('td', q.type),
      make('td', q.title), make('td', q.owner), make('td', q.dueDate));
    const st = make('td');
    st.append(make('span', q.status, 'badge st-' + q.status));
    tr.append(st);
    tr.addEventListener('click', () => { openDetail(q.id); renderTable(); });
    body.append(tr);
  }
  if (rows.length === 0) {
    const tr = make('tr');
    const td = make('td', '조건에 맞는 문의가 없습니다.', 'muted');
    td.colSpan = 8;
    tr.append(td);
    body.append(tr);
  }
}

// F-03 상세·답변 패널 (F-04 상태 버튼, F-08 삭제)
function openDetail(id) {
  selectedId = id;
  const panel = $('detailPanel');
  if (!panel) return;
  panel.replaceChildren();
  const q = list.find(x => x.id === id);
  if (!q) {
    panel.append(make('p', '목록에서 문의를 누르면 여기에 상세가 보입니다.', 'muted'));
    return;
  }
  const done = q.status === '답변완료';
  panel.append(make('h3', `${q.id} · ${q.title}`));
  const info = make('dl');
  for (const [k, v] of [['접수일', q.receivedDate], ['답변기한', q.dueDate], ['접수경로', q.channel],
    ['문의유형', q.type], ['담당자', q.owner], ['상태', q.status]]) {
    info.append(make('dt', k), make('dd', v));
  }
  panel.append(info, make('p', q.content || '(내용 없음)', 'content'));

  const answer = make('textarea');
  answer.id = 'answerInput';
  answer.rows = 4;
  answer.placeholder = '답변내용';
  answer.value = q.answer;
  answer.disabled = done;
  panel.append(answer);

  const buttons = make('div', undefined, 'detail-buttons');
  const saveBtn = make('button', '답변 저장', 'small ghost');
  saveBtn.disabled = done;
  saveBtn.addEventListener('click', () => saveAnswer(q.id));
  buttons.append(saveBtn);
  const next = nextStatus(q.status);
  if (next) {
    const nextBtn = make('button', `→ ${next}`, 'small');
    nextBtn.addEventListener('click', () => changeStatus(q.id, next));
    buttons.append(nextBtn);
  }
  const delBtn = make('button', '삭제', 'small danger');
  delBtn.addEventListener('click', () => removeInquiry(q.id));
  buttons.append(delBtn);
  panel.append(buttons);
  if (done) panel.append(make('p', '답변완료된 문의는 고칠 수 없습니다.', 'muted'));
}

// F-07 유형별 막대 (CSS)
function renderChart() {
  const box = $('typeChart');
  if (!box) return;
  box.replaceChildren();
  const counts = countByType(list);
  const max = Math.max(1, ...counts.map(c => c.count));
  for (const { type, count } of counts) {
    const row = make('div', undefined, 'bar-row');
    const bar = make('div', undefined, 'bar');
    bar.style.width = (count / max * 100) + '%';
    row.append(make('span', type, 'bar-label'), bar, make('span', count + '건', 'bar-value'));
    box.append(row);
  }
}

function renderAll() {
  renderSummary();
  renderTable();
  renderChart();
  openDetail(selectedId);
}

document.addEventListener('DOMContentLoaded', async () => {
  $('inquiryForm').addEventListener('submit', e => { e.preventDefault(); addInquiry(); });
  $('searchInput').addEventListener('input', renderTable);
  $('statusFilter').addEventListener('change', renderTable);
  $('reloadBtn').addEventListener('click', reloadData);
  updateDuePreview();
  try {
    await loadData();
  } catch (e) {
    showMessage('데이터를 불러오지 못했습니다 : ' + e.message, 'error');
  }
  renderAll();
});
