const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Today renders a calm empty surface and progressively discloses populated sections', () => {
  const panel = read('src/features/today/components/TodayPanel.jsx');
  assert.equal((panel.match(/Create daily note/g) || []).length, 1);
  assert.match(panel, /data-mn-today-empty=\{emptyToday \? 'true' : 'false'\}/);
  assert.match(panel, /aria-label="Quick task"/);
  assert.match(panel, /!!visibleAgendaItems\.length &&/);
  assert.match(panel, /!!reviewItems\.length &&/);
  assert.match(panel, /!!todayTasks\.length &&/);
  assert.match(panel, /!!todayReminders\.length &&/);
  assert.match(panel, /Review past days/);
  assert.match(panel, /aria-label=\{`Snooze \$\{item\.title\} for 7 days`\}/);
  assert.match(panel, /aria-label=\{`Dismiss \$\{item\.title\}`\}/);
  assert.match(panel, /\['yesterday', 'Yesterday'\], \['week', 'This week'\], \['month', 'This month'\]/);
  assert.doesNotMatch(panel, /Needs attention|No agenda items today|No open loops for this range|No reminders due in this range/);
  assert.doesNotMatch(panel, /stat\('notes'|stat\('tasks'|stat\('reminders'/);
});

test('Today wiring uses actionable work for the badge and vault-scoped review controls', () => {
  const appView = read('src/app/AppView.jsx');
  const controller = read('src/features/today/useTodayController.js');
  const sidebar = read('src/panels/sidebar.jsx');
  const sidebarRow = read('src/panels/SidebarNavRow.jsx');
  assert.match(appView, /todayCount=\{model\.todayActionableCount \?\? 0\}/);
  assert.match(appView, /reviewItems=\{model\.todayReviewItems \|\| \[\]\}/);
  assert.match(appView, /onDismissReviewItem=\{model\.dismissTodayReviewItem\}/);
  assert.match(appView, /onSnoozeReviewItem=\{model\.snoozeTodayReviewItem\}/);
  assert.match(appView, /featureState\.showAskAi && assistanceEnabled \? generateTodayAiRecap : null/);
  assert.match(appView, /todayAiRecap=\{assistanceEnabled \? todayAiRecap : null\}/);
  assert.match(controller, /mn:todayReviewState:/);
  assert.match(controller, /TODAY_MODEL\.todayActionableCount/);
  assert.match(controller, /TODAY_MODEL\.todayReviewItems/);
  assert.match(controller, /TODAY_MODEL\.noteTouchesToday/);
  assert.match(controller, /view === 'today' && assistanceEnabled && helpers\.contextualAiBuildTodayRecapContext/);
  assert.match(sidebar, /SidebarNavRow/);
  assert.match(sidebarRow, /role="button"/);
  assert.match(sidebarRow, /event\.key !== 'Enter' && event\.key !== ' '/);
});
