const NOVELIST_STRUCTURE_TAGS = Object.freeze(['novel-act', 'novel-chapter', 'novel-scene']);

const SUPPORT_TYPE_DEFAULTS = Object.freeze({
  'novel-character': {
    label: 'Character',
    sectionTitle: 'Characters',
    body: 'want:: \nneed:: \nsecret:: \nchange:: ',
  },
  'novel-location': {
    label: 'Location',
    sectionTitle: 'Locations',
    body: 'mood:: \nsensory-details:: \nrules-or-constraints:: ',
  },
  'novel-plot': {
    label: 'Plot Thread',
    sectionTitle: 'Plot Threads',
    body: 'status:: IDEA\n- Promise\n- Setup\n- Payoff',
  },
  'novel-research': {
    label: 'Research',
    sectionTitle: 'Research',
    body: 'source:: \n## Notes\n- ',
  },
  'novel-revision': {
    label: 'Revision Note',
    sectionTitle: 'Revision Notes',
    body: 'status:: IDEA\n## Notes\n- ',
  },
});

function titleFromNovelistTag(tagName) {
  return String(tagName || '')
    .replace(/^novel-/, '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Note';
}

function pluralizeNovelistLabel(label) {
  if (/s$/i.test(label)) return label;
  if (/y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

function normalizeSupportingTypeTag(raw) {
  const clean = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]+/g, '').replace(/^-+|-+$/g, '');
  if (!clean) return '';
  return clean.startsWith('novel-') ? clean : `novel-${clean}`;
}

function buildSupportingTypes(tags) {
  const structureTags = new Set(NOVELIST_STRUCTURE_TAGS);
  return (tags || [])
    .filter(tag => tag?.name?.startsWith('novel-') && !structureTags.has(tag.name))
    .filter((tag, index, items) => items.findIndex(item => item.name === tag.name) === index)
    .map(tag => {
      const fallbackLabel = titleFromNovelistTag(tag.name);
      const defaults = SUPPORT_TYPE_DEFAULTS[tag.name] || {};
      return {
        tag: tag.name,
        label: defaults.label || fallbackLabel,
        sectionTitle: defaults.sectionTitle || pluralizeNovelistLabel(fallbackLabel),
        body: defaults.body || '## Notes\n- ',
      };
    });
}

function uniqueNovelistTitle(base, notes) {
  const existing = new Set((notes || []).map(note => String(note.title || '').toLowerCase()));
  if (!existing.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index++) {
    const next = `${base} ${index}`;
    if (!existing.has(next.toLowerCase())) return next;
  }
  return `${base} ${Date.now().toString(36)}`;
}

function readNovelistOrder(note, noteOrderValue) {
  if (typeof noteOrderValue === 'function') return noteOrderValue(note);
  const raw = String(note?.body || '').match(/^\s*-?\s*order::\s*(.*)$/im)?.[1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function nextNovelistOrder(kind, parent, model) {
  const { acts, chapters, scenes, childrenForAct, childrenForChapter, readOrder } = model;
  const nextAfter = (items, step, base) => {
    let maxOrder = null;
    for (const item of items) {
      const value = readOrder(item);
      if (value == null) continue;
      maxOrder = maxOrder == null ? value : Math.max(maxOrder, value);
    }
    return maxOrder != null ? maxOrder + step : base + step;
  };
  if (kind === 'act') return nextAfter(acts, 100, 0);
  if (kind === 'chapter') {
    const base = readOrder(parent) ?? 100;
    return nextAfter(parent ? childrenForAct(parent) : chapters, 10, base);
  }
  const base = readOrder(parent) ?? 100;
  return nextAfter(parent ? childrenForChapter(parent) : scenes, 1, base);
}

function buildNovelistTemplates(supportingTypes) {
  return [
    { title: 'Act', tags: ['novel-act'], body: 'status:: OUTLINE\norder:: \npurpose:: \n## Chapters' },
    { title: 'Chapter', tags: ['novel-chapter'], body: 'status:: OUTLINE\norder:: \nact:: \n## Scenes' },
    { title: 'Scene', tags: ['novel-scene'], body: 'status:: DRAFT\norder:: \nchapter:: \npov:: \nsetting:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.' },
    ...supportingTypes.map(type => ({ title: type.label, tags: [type.tag], body: type.body })),
  ];
}

export {
  NOVELIST_STRUCTURE_TAGS,
  buildNovelistTemplates,
  buildSupportingTypes,
  nextNovelistOrder,
  normalizeSupportingTypeTag,
  readNovelistOrder,
  uniqueNovelistTitle,
};
