import { DS_TYPE } from '../../../shared/designSystem.js';
import TODAY_MODEL from '../todayModel.js';

// A single number and what it counts. Numbers are set in the writing voice —
// they are the sentence the page is making.
function TodayStat({ value, label, tone, T }) {
  return (
    <div>
      <div style={{ ...DS_TYPE.sectionHead, fontSize: 24, color: tone || T.ink }}>{value}</div>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim }}>{label}</div>
    </div>
  );
}

function TodayHeader({ formattedToday, tasks = [], reminders = [], agendaItems = [], groups = [], helpers = {}, T }) {
  const unique = new Map();
  for (const item of [...agendaItems, ...tasks, ...reminders]) {
    const key = helpers.digestActionItemKey?.(item) || item.key || TODAY_MODEL.actionIdentity(item);
    unique.set(key, item);
  }
  const openLoopCount = unique.size;
  const overdueCount = [...unique.values()].filter(item => item.rollupStatus === 'overdue').length;
  const notesWrittenCount = groups.reduce((total, group) => total + group.notes.length, 0);
  const todaySummaryLine = openLoopCount
    ? `${openLoopCount} thing${openLoopCount === 1 ? ' wants' : 's want'} your attention.${overdueCount ? ` ${overdueCount} ${overdueCount === 1 ? 'is' : 'are'} overdue.` : ''}`
    : 'Nothing is waiting on you today.';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22,
    }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 style={{
          margin: 0, ...DS_TYPE.sectionHead, fontSize: 32, lineHeight: 1.1, color: T.ink,
        }}>{formattedToday}</h1>
        <div style={{ marginTop: 6, fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkMed }}>
          {todaySummaryLine}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 22, paddingBottom: 4 }}>
        <TodayStat value={openLoopCount} label="open loops" T={T} />
        <TodayStat value={overdueCount} label="overdue" tone={overdueCount ? T.danger : undefined} T={T} />
        <TodayStat value={notesWrittenCount} label="notes written" T={T} />
      </div>
    </div>
  );
}

export { TodayHeader };
