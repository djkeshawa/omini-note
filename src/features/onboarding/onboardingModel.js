const ONBOARDING_TIP_IDS = Object.freeze(['new-note', 'linking', 'checkboxes']);
const ONBOARDING_TIP_ID_SET = new Set(ONBOARDING_TIP_IDS);

function isOnboardingNote(note = {}) {
  const id = String(note.id || '');
  const title = String(note.title || '');
  const body = String(note.body || '');
  const firstRunWelcome = id === 'n1'
    && title === 'Welcome to VispNote'
    && (body.includes('Write · Connect · Act.') || body.includes('write, connect, and act'));
  const vaultWelcome = title.startsWith('Welcome to ') && body.includes('This is your new vault');
  return firstRunWelcome
    || vaultWelcome
    || id.startsWith('onboarding_')
    || ['novel_act_1', 'novel_chapter_1', 'novel_scene_1'].includes(id);
}

function parseDismissedOnboardingTips(value = '') {
  return new Set(String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(id => ONBOARDING_TIP_ID_SET.has(id)));
}

function dismissOnboardingTip(value, tipId) {
  const dismissed = parseDismissedOnboardingTips(value);
  if (ONBOARDING_TIP_ID_SET.has(tipId)) dismissed.add(tipId);
  return ONBOARDING_TIP_IDS.filter(id => dismissed.has(id)).join(',');
}

function contextualOnboardingTip({ notes = [], selectedNote = null, dismissed = '' } = {}) {
  const hidden = parseDismissedOnboardingTips(dismissed);
  const meaningfulNotes = (notes || []).filter(note => !isOnboardingNote(note));
  if (!meaningfulNotes.length && !hidden.has('new-note')) {
    return {
      id: 'new-note',
      placement: 'sidebar',
      title: 'Start with one useful note',
      body: 'Create a note and write the thought you want to keep. No setup needed.',
    };
  }
  if (!selectedNote || isOnboardingNote(selectedNote)) return null;
  const body = String(selectedNote.body || '');
  const hasWikiLink = /\[\[[^\]\n]+\]\]/.test(body);
  if (!hidden.has('linking') && !hasWikiLink) {
    return {
      id: 'linking',
      placement: 'editor',
      title: 'Connect this thought',
      body: 'Type [[ to link another note. The connection stays plain Markdown.',
    };
  }
  const hasCheckbox = /^\s*[-*]\s+\[[ xX]\]\s+/m.test(body);
  if (!hidden.has('checkboxes') && !hasCheckbox) {
    return {
      id: 'checkboxes',
      placement: 'editor',
      title: 'Turn it into action',
      body: 'Type - [ ] for a checkbox. Open tasks appear in Today.',
    };
  }
  return null;
}

function excludeOnboardingFromToday({ notes = [], tasks = [], reminders = [], links = [] } = {}) {
  const onboardingIds = new Set((notes || []).filter(isOnboardingNote).map(note => note.id));
  const keepItem = item => !onboardingIds.has(item?.noteId);
  return {
    notes: (notes || []).filter(note => !onboardingIds.has(note.id)),
    tasks: (tasks || []).filter(keepItem),
    reminders: (reminders || []).filter(keepItem),
    links: (links || []).filter(link => !onboardingIds.has(link?.source) && !onboardingIds.has(link?.target)),
  };
}

export {
  ONBOARDING_TIP_IDS,
  contextualOnboardingTip,
  dismissOnboardingTip,
  excludeOnboardingFromToday,
  isOnboardingNote,
  parseDismissedOnboardingTips,
};
