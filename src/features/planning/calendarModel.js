function calendarCleanTaskText(value = '', helpers = window.MN_APP_HELPERS || {}) {
  if (helpers.agendaCleanActionText) return helpers.agendaCleanActionText(value);
  return String(value || '').replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
    .replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/g, '').trim();
}

function calendarTaskContent(text, date = '', time = '', deferUntil = '', helpers = window.MN_APP_HELPERS || {}) {
  if (helpers.agendaBuildTaskContent) return helpers.agendaBuildTaskContent(text, date, time, deferUntil);
  const clean = calendarCleanTaskText(text, helpers);
  const cleanDate = String(date || '').trim();
  const cleanTime = String(time || '').trim();
  const cleanDefer = String(deferUntil || '').trim();
  return [
    cleanDate ? `${clean} @remind ${[cleanDate, cleanTime].filter(Boolean).join(' ')}` : clean,
    cleanDefer ? `@defer ${cleanDefer}` : '',
  ].filter(Boolean).join(' ');
}

function calendarReminderDateParts(date = new Date()) {
  const value = new Date(date);
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  const hh = String(value.getHours()).padStart(2, '0');
  const min = String(value.getMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function calendarUpdateMarkdownLine(line, nextText, checked) {
  const match = String(line || '').match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
  if (!match) return nextText;
  const box = checked == null ? match[2] : checked ? 'x' : ' ';
  return `${match[1]}- [${box}] ${nextText}`;
}

export { calendarCleanTaskText, calendarTaskContent, calendarReminderDateParts, calendarUpdateMarkdownLine };
