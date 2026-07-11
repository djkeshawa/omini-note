const { useCallback, useMemo, useState } = React;

const EMPTY_DIGEST = Object.freeze({ staleTodos: [], unlinkedNotes: [], resurfacedNotes: [] });

export function useTodayController({ view, notes, tasks, reminders, links, weekStart, helpers, ai }) {
  const [recap, setRecap] = useState(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapError, setRecapError] = useState('');

  const dailyNote = useMemo(() => (
    helpers.rollupFindDailyNote
      ? helpers.rollupFindDailyNote(notes)
      : notes.find(note => String(note.title || '').trim() === (helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10))) || null
  ), [helpers, notes]);

  const agendaItems = useMemo(() => {
    const today = helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10);
    const items = tasks
      .filter(item => !(helpers.agendaIsDeferred && helpers.agendaIsDeferred(item)))
      .filter(item => item?.remindAt?.date === today)
      .sort((a, b) => String(a.remindAt?.time || '').localeCompare(String(b.remindAt?.time || ''))
        || String(a.label || a.text || '').localeCompare(String(b.label || b.text || '')));
    return helpers.digestUniqueActionItems ? helpers.digestUniqueActionItems(items, { limit: 5 }) : items.slice(0, 5);
  }, [helpers, tasks]);

  const aiContext = useMemo(() => (
    helpers.contextualAiBuildTodayRecapContext
      ? helpers.contextualAiBuildTodayRecapContext({ notes, tasks, reminders, agendaItems, links, weekStart: weekStart || 'monday' })
      : null
  ), [agendaItems, helpers, links, notes, reminders, tasks, weekStart]);

  const digest = useMemo(() => {
    if (view !== 'today' || !helpers.digestStaleTodoItems) return EMPTY_DIGEST;
    const excludeIds = new Set([
      ...agendaItems.map(item => item.noteId),
      ...(aiContext?.notes || []).map(note => note.id),
    ].filter(Boolean));
    const staleTodos = helpers.digestStaleTodoItems(tasks, notes, { limit: 5 });
    const unlinkedNotes = helpers.digestUnlinkedRecentNotes(notes, links, { limit: 5 });
    staleTodos.forEach(item => item.noteId && excludeIds.add(item.noteId));
    unlinkedNotes.forEach(note => note.id && excludeIds.add(note.id));
    return {
      staleTodos,
      unlinkedNotes,
      resurfacedNotes: helpers.digestResurfacedNotes
        ? helpers.digestResurfacedNotes(notes, links, { limit: 5, excludeIds: [...excludeIds] })
        : [],
    };
  }, [agendaItems, aiContext, helpers, links, notes, tasks, view]);

  const generateRecap = useCallback(async () => {
    if (!aiContext || !helpers.contextualAiBuildTodayRecapPrompt || !helpers.contextualAiBuildTodayRecapResult) {
      setRecapError('Today AI recap is unavailable in this build.');
      return null;
    }
    if (!ai?.chat) {
      setRecapError('AI chat is unavailable in this build.');
      return null;
    }
    setRecapBusy(true);
    setRecapError('');
    try {
      let status = null;
      try {
        const statusResult = await ai.status?.();
        if (statusResult?.ok) status = statusResult.value;
      } catch {}
      const response = await ai.chat({
        messages: [
          { role: 'system', content: 'You create concise source-linked daily recaps. Keep facts separate from suggestions. Do not claim facts that are not in the supplied context.' },
          { role: 'user', content: helpers.contextualAiBuildTodayRecapPrompt(aiContext) },
        ],
        timeoutMs: 60000,
        maxTokens: 900,
      });
      if (!response?.ok) throw new Error(response?.error || 'AI recap failed.');
      if (response.value && response.value.ok === false) throw new Error(response.value.error || 'AI recap failed.');
      const result = helpers.contextualAiBuildTodayRecapResult({
        aiText: String(response.value?.answer || response.answer || '').trim(),
        context: aiContext,
        status,
        createdAt: new Date().toISOString(),
      });
      setRecap(result);
      return result;
    } catch (error) {
      setRecapError(error?.message || String(error) || 'AI recap failed.');
      return null;
    } finally {
      setRecapBusy(false);
    }
  }, [ai, aiContext, helpers]);

  return { dailyNote, agendaItems, aiContext, digest, recap, recapBusy, recapError, generateRecap };
}
