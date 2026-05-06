(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_APP_HELPERS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const NOTE_TEMPLATES = [
    { id: 'daily', title: 'Daily Note', noteTitle: '{date}', tags: ['daily'], body: '# {date}\n\n## Focus\n- \n\n## Notes\n- \n\n## Tasks\n- [ ] \n' },
    { id: 'meeting', title: 'Meeting Note', noteTitle: 'Meeting - {date}', tags: ['meeting'], body: '# Meeting - {date}\n\nAttendees:: \n\n## Agenda\n- \n\n## Notes\n- \n\n## Decisions\n- \n\n## Actions\n- [ ] \n' },
    { id: 'project', title: 'Project Plan', noteTitle: 'Project plan', tags: ['project'], body: '# Project plan\n\nstatus:: TODO\n\n## Outcome\n\n## Milestones\n- \n\n## Next Actions\n- [ ] \n' },
    { id: 'reading', title: 'Reading Note', noteTitle: 'Reading note', tags: ['reading'], body: '# Reading note\n\nAuthor:: \nSource:: \n\n## Summary\n\n## Highlights\n- \n\n## Follow-up\n- [ ] \n' },
    { id: 'novel-scene', title: 'Novel Scene', noteTitle: 'Scene', tags: ['novel-scene'], body: 'status:: DRAFT\npov:: \nsetting:: \npurpose:: \n\n::: plot-points\n- Opening beat\n:::\n\nDraft the scene here.\n' },
  ];

  function todayIsoDate(now = new Date()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  function expandTemplate(template, values = {}) {
    const source = template || NOTE_TEMPLATES[0];
    const date = values.date || todayIsoDate(values.now);
    const replaceTokens = (value) => String(value || '').replaceAll('{date}', date);
    return {
      id: source.id,
      title: source.title || 'Untitled',
      noteTitle: replaceTokens(source.noteTitle || source.title || 'Untitled'),
      body: replaceTokens(source.body || ''),
      tags: Array.isArray(source.tags) ? [...source.tags] : [],
    };
  }

  function templateById(templateId) {
    return NOTE_TEMPLATES.find(item => item.id === templateId) || NOTE_TEMPLATES[0];
  }

  function filterCommands(commands = [], query = '', limit = 12) {
    const q = String(query || '').trim().toLowerCase();
    return (commands || [])
      .filter(cmd => cmd && cmd.enabled !== false)
      .map(cmd => {
        const hay = `${cmd.title || ''} ${cmd.section || ''} ${cmd.keywords || ''}`.toLowerCase();
        const score = !q ? 0 : hay.includes(q) ? hay.indexOf(q) : 9999;
        return { cmd, score };
      })
      .filter(item => !q || item.score < 9999)
      .sort((a, b) => a.score - b.score || String(a.cmd.title || '').localeCompare(String(b.cmd.title || '')))
      .slice(0, limit)
      .map(item => item.cmd);
  }

  function decorateNotesWithSearchDetails(notes = [], searchDetails = new Map()) {
    const details = searchDetails instanceof Map
      ? searchDetails
      : new Map(Object.entries(searchDetails || {}));
    return (notes || []).map(note => {
      const detail = details.get(note.id);
      return detail ? { ...note, __searchSnippet: detail.snippet, __matchedFields: detail.matchedFields } : note;
    });
  }

  function normalizeWorkflowStatus(raw, states = [], normalizeId) {
    const id = typeof normalizeId === 'function'
      ? normalizeId(raw)
      : String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
    return (states || []).some(state => state.id === id) ? id : '';
  }

  function workflowNotePreview(note) {
    return String(note?.body || '')
      .split('\n')
      .filter(line => !/^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line))
      .join('\n')
      .replace(/^#{1,4}\s+.*/gm, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[`*>#]/g, '')
      .replace(/-\s+\[[ x]\]/g, '')
      .replace(/-\s+/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 180);
  }

  function collectWorkflowNotes(notes = [], states = [], options = {}) {
    const safeStates = states || [];
    const stateIds = safeStates.map(s => s.id);
    const counts = Object.fromEntries(stateIds.map(id => [id, 0]));
    const byState = Object.fromEntries(stateIds.map(id => [id, []]));
    const noteIdsByState = Object.fromEntries(stateIds.map(id => [id, new Set()]));
    const archivedNotes = [];
    const propertyValue = typeof options.propertyValue === 'function'
      ? options.propertyValue
      : (body, key) => {
        const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(body || '').match(new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im'));
        return match ? String(match[1] || '').trim() : '';
      };

    (notes || []).forEach(note => {
      const workflow = normalizeWorkflowStatus(propertyValue(note.body || '', 'status'), safeStates, options.normalizeId);
      if (!workflow || !Object.prototype.hasOwnProperty.call(counts, workflow)) return;
      const item = {
        id: note.id,
        noteId: note.id,
        noteTitle: note.title,
        title: note.title,
        noteTags: note.tags || [],
        text: workflowNotePreview(note),
        kind: 'note',
        workflow,
        modifiedAt: note.modifiedAt || note.date,
      };
      if (note.workflowArchived) {
        archivedNotes.push({
          id: note.id,
          title: note.title,
          tags: note.tags || [],
          workflow,
          workflowCount: 1,
        });
        return;
      }
      counts[item.workflow]++;
      noteIdsByState[item.workflow].add(note.id);
      byState[item.workflow].push(item);
    });

    return {
      counts,
      byState,
      noteIdsByState,
      archivedNotes,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    };
  }

  function reminderKey(item) {
    return [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
  }

  function collectReminderItems(notes = [], parser, walk) {
    if (!parser?.parse) return [];
    const out = [];
    (notes || []).forEach(note => {
      const pushItem = (text, meta = {}) => {
        const remindAt = parser.parse(text);
        if (!remindAt) return;
        out.push({
          noteId: note.id,
          noteTitle: note.title,
          text: parser.strip ? parser.strip(text) : String(text || '').replace(remindAt.raw, '').trim(),
          remindAt,
          ...meta,
        });
      };
      if (note.blocks?.length && typeof walk === 'function') {
        walk(note.blocks, block => {
          if (block.kind === 'todo' && block.checked) return;
          pushItem(block.content || '', { blockId: block.id });
        });
        return;
      }
      String(note.body || '').split('\n').forEach((line, lineIndex) => {
        if (/^\s*-\s+\[[xX]\]/.test(line)) return;
        pushItem(line, { line: lineIndex });
      });
    });
    return out.map(item => ({ ...item, key: reminderKey(item) }));
  }

  function reminderDisplayDate(item) {
    const at = item?.remindAt?.at;
    if (!at) return '';
    return at.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function reminderStatusLabel(status) {
    if (status === 'due') return 'Due';
    if (status === 'snoozed') return 'Snoozed';
    return 'Upcoming';
  }

  return {
    NOTE_TEMPLATES,
    todayIsoDate,
    expandTemplate,
    templateById,
    filterCommands,
    decorateNotesWithSearchDetails,
    normalizeWorkflowStatus,
    workflowNotePreview,
    collectWorkflowNotes,
    reminderKey,
    collectReminderItems,
    reminderDisplayDate,
    reminderStatusLabel,
  };
});
