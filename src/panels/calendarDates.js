// Date maths for the agenda: keys are the `YYYY-MM-DD` strings the rest of the
// app stores reminders under, so every conversion goes through here rather than
// each caller reaching for its own `toISOString().slice(0, 10)`.

function mnCalendarDateKey(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mnCalendarDateFromKey(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function mnCalendarMonthDays(anchor, weekStart = 'monday') {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  const startDay = weekStart === 'sunday' ? first.getDay() : (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - startDay);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: day,
      key: mnCalendarDateKey(day),
      inMonth: day.getMonth() === anchor.getMonth(),
      today: mnCalendarDateKey(day) === mnCalendarDateKey(new Date()),
    };
  });
}

function mnCalendarItemDateKey(item) {
  return item?.remindAt?.date || '';
}

function mnCalendarTimeText(item) {
  return item?.remindAt?.time || 'all day';
}

const MN_CALENDAR_DATES = {
  mnCalendarDateKey,
  mnCalendarDateFromKey,
  mnCalendarMonthDays,
  mnCalendarItemDateKey,
  mnCalendarTimeText,
};
export default MN_CALENDAR_DATES;
export { mnCalendarDateKey, mnCalendarDateFromKey, mnCalendarMonthDays, mnCalendarItemDateKey, mnCalendarTimeText };
