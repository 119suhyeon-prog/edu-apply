const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let inquiryList = [];
let selectedInquiryId = null;

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) console.error(`요소 없음: ${id}`);
  return element;
}

// 저장 위치: Supabase 호출은 이 구역의 함수에서만 합니다.
async function loadData() {
  const { data, error } = await supabaseClient
    .from("inq_list")
    .select("id, channel, type, title, content, owner, received_date, due_date, status, answer, answered_at")
    .order("received_date", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    channel: row.channel,
    type: row.type,
    title: row.title,
    content: row.content,
    owner: row.owner,
    receivedDate: row.received_date,
    dueDate: row.due_date,
    status: row.status,
    answer: row.answer,
    answeredAt: row.answered_at
  }));
}

async function insertInquiry(inquiry) {
  const { error } = await supabaseClient.from("inq_list").insert({
    channel: inquiry.channel,
    type: inquiry.type,
    title: inquiry.title,
    content: inquiry.content,
    owner: inquiry.owner
  });
  if (error) throw error;
}

async function updateInquiry(id, fields) {
  const allowedFields = {};
  if (Object.hasOwn(fields, "answer")) allowedFields.answer = fields.answer;
  if (Object.hasOwn(fields, "status")) allowedFields.status = fields.status;
  if (Object.keys(allowedFields).length === 0) throw new Error("변경할 답변 내용이 없습니다.");
  const { error } = await supabaseClient.from("inq_list").update(allowedFields).eq("id", id);
  if (error) throw error;
}

async function deleteInquiry(id) {
  const { error } = await supabaseClient.from("inq_list").delete().eq("id", id);
  if (error) throw error;
}

function showMessage(text, type = "success") {
  const message = getElement("msgBox");
  if (!message) return;
  message.textContent = text;
  message.className = type === "error" ? "message error" : "message";
}

function updateDuePreview() {
  const preview = getElement("duePreview");
  if (preview) preview.textContent = calcDueDate(todayStr(), true);
}

function renderTable() {
  const table = getElement("inquiryTable");
  if (!table) return;
  table.replaceChildren();

  const emptyState = document.querySelector('[data-role="empty-state"]');
  if (emptyState) emptyState.hidden = inquiryList.length > 0;

  for (const inquiry of sortByReceived(inquiryList)) {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.dataset.inquiryId = inquiry.id;

    const values = [
      { text: inquiry.id, className: "inquiry-id" },
      { text: formatDate(inquiry.receivedDate) },
      { text: `${inquiry.type} · ${inquiry.title}`, className: "inquiry-title" },
      { text: inquiry.owner },
      { text: formatDate(inquiry.dueDate) },
      { text: inquiry.status, className: "status-label" }
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      if (value.className === "inquiry-title") {
        const title = document.createElement("strong");
        title.textContent = inquiry.title;
        const type = document.createElement("span");
        type.textContent = inquiry.type;
        const titleWrap = document.createElement("div");
        titleWrap.className = value.className;
        titleWrap.append(type, title);
        cell.append(titleWrap);
      } else {
        cell.textContent = value.text;
        if (value.className) cell.className = value.className;
      }
      row.append(cell);
    }

    row.addEventListener("click", () => openDetail(inquiry.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(inquiry.id);
      }
    });
    table.append(row);
  }
}

function renderAll() {
  renderTable();
  if (selectedInquiryId && inquiryList.some((inquiry) => inquiry.id === selectedInquiryId)) {
    openDetail(selectedInquiryId);
  } else if (selectedInquiryId) {
    selectedInquiryId = null;
    const panel = getElement("detailPanel");
    if (panel) panel.hidden = true;
  }
}

function openDetail(id) {
  const inquiry = inquiryList.find((item) => item.id === id);
  const panel = getElement("detailPanel");
  const meta = document.querySelector('[data-role="detail-meta"]');
  const content = document.querySelector('[data-role="detail-content"]');
  const answer = getElement("answerInput");
  if (!inquiry || !panel || !meta || !content || !answer) return;

  selectedInquiryId = id;
  meta.replaceChildren();
  for (const [label, value] of [
    ["접수번호", inquiry.id],
    ["접수경로", inquiry.channel],
    ["문의유형", inquiry.type],
    ["접수일", formatDate(inquiry.receivedDate)],
    ["담당자", inquiry.owner],
    ["답변기한", formatDate(inquiry.dueDate)]
  ]) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    group.append(term, description);
    meta.append(group);
  }
  content.textContent = inquiry.content || "내용이 입력되지 않았습니다.";
  answer.value = inquiry.answer || "";
  answer.disabled = inquiry.status === "답변완료";
  panel.hidden = false;
}

async function addInquiry(event) {
  event.preventDefault();
  const form = getElement("inquiryForm");
  const addButton = getElement("addBtn");
  if (!form || !addButton) return;

  const inquiry = {
    channel: getElement("channelSelect").value,
    type: getElement("typeSelect").value,
    title: getElement("titleInput").value.trim(),
    content: getElement("contentInput").value.trim(),
    owner: getElement("ownerInput").value.trim()
  };
  if (!form.reportValidity()) return;

  addButton.disabled = true;
  try {
    await insertInquiry(inquiry);
    form.reset();
    updateDuePreview();
    await reloadData();
    showMessage("문의가 등록되었습니다.");
  } catch (error) {
    showMessage(`등록하지 못했습니다: ${error.message}`, "error");
  } finally {
    addButton.disabled = false;
  }
}

async function saveAnswer() {
  if (!selectedInquiryId) return;
  const answer = getElement("answerInput");
  if (!answer || answer.disabled) return;
  try {
    await updateInquiry(selectedInquiryId, { answer: answer.value.trim() });
    await reloadData();
    showMessage("답변을 저장했습니다.");
  } catch (error) {
    showMessage(`답변을 저장하지 못했습니다: ${error.message}`, "error");
  }
}

async function removeInquiry() {
  if (!selectedInquiryId) return;
  const inquiry = inquiryList.find((item) => item.id === selectedInquiryId);
  if (!inquiry || !window.confirm(`${inquiry.id} 문의를 삭제할까요? 삭제한 접수번호는 다시 사용되지 않습니다.`)) return;
  try {
    await deleteInquiry(inquiry.id);
    selectedInquiryId = null;
    const panel = getElement("detailPanel");
    if (panel) panel.hidden = true;
    await reloadData();
    showMessage("문의를 삭제했습니다.");
  } catch (error) {
    showMessage(`삭제하지 못했습니다: ${error.message}`, "error");
  }
}

async function reloadData() {
  const reloadButton = getElement("reloadBtn");
  if (reloadButton) reloadButton.disabled = true;
  try {
    inquiryList = await loadData();
    renderAll();
    return true;
  } catch (error) {
    showMessage(`불러오지 못했습니다: ${error.message}`, "error");
    return false;
  } finally {
    if (reloadButton) reloadButton.disabled = false;
  }
}

function bindEvents() {
  getElement("inquiryForm")?.addEventListener("submit", addInquiry);
  getElement("reloadBtn")?.addEventListener("click", reloadData);
  document.querySelector('[data-action="save-answer"]')?.addEventListener("click", saveAnswer);
  document.querySelector('[data-action="remove"]')?.addEventListener("click", removeInquiry);
  document.querySelector('[data-action="close-detail"]')?.addEventListener("click", () => {
    selectedInquiryId = null;
    getElement("detailPanel").hidden = true;
  });
}

bindEvents();
updateDuePreview();
reloadData();