function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  return formatDate(new Date());
}

function addDays(value, amount) {
  const date = parseDate(value);
  if (!date || !Number.isInteger(amount)) return "";
  date.setDate(date.getDate() + amount);
  return formatDate(date);
}

function calcDueDate(receivedDate, skipWeekend = true) {
  let date = parseDate(receivedDate);
  if (!date) return "";
  let businessDays = 0;
  while (businessDays < 3) {
    date.setDate(date.getDate() + 1);
    if (!skipWeekend || (date.getDay() !== 0 && date.getDay() !== 6)) businessDays += 1;
  }
  return formatDate(date);
}

function sortByReceived(list) {
  return [...list].sort((left, right) => {
    const dateOrder = String(right.receivedDate || "").localeCompare(String(left.receivedDate || ""));
    return dateOrder || String(right.id || "").localeCompare(String(left.id || ""));
  });
}