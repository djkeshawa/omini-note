import TODAY_MODEL from './todayModel.js';
import { storage } from '../../shared/storageUtils.js';
import { mnAiContentFingerprint } from '../../ai/aiOwnership.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

const EMPTY_DIGEST = Object.freeze({ staleTodos: [], unlinkedNotes: [], resurfacedNotes: [] });
const EMPTY_REVIEW_STATE = Object.freeze({ version: TODAY_MODEL.REVIEW_STATE_VERSION, items: {} });

function reviewStateKey(vaultId) {
  return `mn:todayReviewState:${String(vaultId || 'local')}`;
}

function readReviewState(key) {
  return TODAY_MODEL.normalizeTodayReviewState(storage.getJson(key, EMPTY_REVIEW_STATE));
}

export function useTodayController({
  view, notes, tasks, reminders, links, weekStart, helpers, ai, vaultId, assistanceEnabled = false,
}) {
  const [recap, setRecap] = useState(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapError, setRecapError] = useState('');
  const recapSequence = useRef(0);
  const stateKey = reviewStateKey(vaultId);
  const [reviewStore, setReviewStore] = useState(() => ({ key: stateKey, value: readReviewState(stateKey) }));

  useEffect(() => {
    setReviewStore(current => (
      current.key === stateKey ? current : { key: stateKey, value: readReviewState(stateKey) }
    ));
  }, [stateKey]);

  const reviewState = reviewStore.key === stateKey ? reviewStore.value : readReviewState(stateKey);

  const dailyNote = useMemo(() => (
    helpers.rollupFindDailyNote
      ? helpers.rollupFindDailyNote(notes)
      : notes.find(note => String(note.title || '').trim() === (helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10))) || null
  ), [helpers, notes]);

  const agendaItems = useMemo(() => {
    const today = helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10);
    const items = tasks
      .filter(item => !item?.checked)
      .filter(item => !(helpers.agendaIsDeferred && helpers.agendaIsDeferred(item)))
      .filter(item => item?.remindAt?.date === today)
      .sort((a, b) => String(a.remindAt?.time || '').localeCompare(String(b.remindAt?.time || ''))
        || String(a.label || a.text || '').localeCompare(String(b.label || b.text || '')));
    return helpers.digestUniqueActionItems ? helpers.digestUniqueActionItems(items, { limit: 5 }) : items.slice(0, 5);
  }, [helpers, tasks]);

  const aiContext = useMemo(() => (
    view === 'today' && assistanceEnabled && helpers.contextualAiBuildTodayRecapContext
      ? helpers.contextualAiBuildTodayRecapContext({ notes, tasks, reminders, agendaItems, links, weekStart: weekStart || 'monday' })
      : null
  ), [agendaItems, assistanceEnabled, helpers, links, notes, reminders, tasks, view, weekStart]);
  const recapOwner = `${vaultId || ''}:${helpers.todayIsoDate ? helpers.todayIsoDate() : new Date().toISOString().slice(0, 10)}:${mnAiContentFingerprint(JSON.stringify(aiContext || null))}`;
  const recapOwnerRef = useRef(recapOwner);
  recapOwnerRef.current = recapOwner;

  useEffect(() => {
    recapSequence.current++;
    setRecap(null);
    setRecapBusy(false);
    setRecapError('');
  }, [recapOwner]);

  const digest = useMemo(() => {
    if (view !== 'today' || !helpers.digestStaleTodoItems) return EMPTY_DIGEST;
    const excludeIds = new Set([
      ...agendaItems.map(item => item.noteId),
      ...(aiContext?.notes || []).map(note => note.id),
    ].filter(Boolean));
    notes.forEach(note => {
      if (note?.id && TODAY_MODEL.noteTouchesToday(note)) excludeIds.add(note.id);
    });
    const eligibleTasks = helpers.agendaIsDeferred
      ? tasks.filter(item => !helpers.agendaIsDeferred(item))
      : tasks;
    const staleTodos = helpers.digestStaleTodoItems(eligibleTasks, notes, { limit: 5 });
    const unlinkedNotes = helpers.digestUnlinkedRecentNotes(notes, links, { limit: 10 })
      .filter(note => !excludeIds.has(note.id))
      .slice(0, 5);
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

  const actionableCount = useMemo(() => TODAY_MODEL.todayActionableCount({ tasks, reminders }), [reminders, tasks]);

  const reviewItems = useMemo(() => TODAY_MODEL.todayReviewItems({
    staleTasks: digest.staleTodos,
    unlinkedNotes: digest.unlinkedNotes,
    resurfacedNotes: digest.resurfacedNotes,
    reviewState,
    limit: 3,
  }), [digest, reviewState]);

  const updateReviewItem = useCallback((itemId, action) => {
    setReviewStore(current => {
      const base = current.key === stateKey ? current.value : readReviewState(stateKey);
      const value = TODAY_MODEL.updateTodayReviewState(base, itemId, action);
      storage.setJson(stateKey, value);
      return { key: stateKey, value };
    });
  }, [stateKey]);

  const dismissReviewItem = useCallback(itemId => updateReviewItem(itemId, 'dismissed'), [updateReviewItem]);
  const snoozeReviewItem = useCallback(itemId => updateReviewItem(itemId, 'snoozed'), [updateReviewItem]);

  const generateRecap = useCallback(async () => {
    if (!aiContext || !helpers.contextualAiBuildTodayRecapPrompt || !helpers.contextualAiBuildTodayRecapResult) {
      setRecapError('Today AI recap is unavailable in this build.');
      return null;
    }
    if (!ai?.chat) {
      setRecapError('AI chat is unavailable in this build.');
      return null;
    }
    const requestId = ++recapSequence.current;
    const requestOwner = recapOwner;
    const ownsRequest = () => (
      requestId === recapSequence.current &&
      requestOwner === recapOwnerRef.current
    );
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
      if (!ownsRequest()) return null;
      const result = helpers.contextualAiBuildTodayRecapResult({
        aiText: String(response.value?.answer || response.answer || '').trim(),
        context: aiContext,
        status,
        createdAt: new Date().toISOString(),
      });
      setRecap(result);
      return result;
    } catch (error) {
      if (!ownsRequest()) return null;
      setRecapError(error?.message || String(error) || 'AI recap failed.');
      return null;
    } finally {
      if (ownsRequest()) setRecapBusy(false);
    }
  }, [ai, aiContext, helpers, recapOwner]);

  return {
    dailyNote,
    agendaItems,
    aiContext,
    digest,
    actionableCount,
    reviewItems,
    dismissReviewItem,
    snoozeReviewItem,
    recap,
    recapBusy,
    recapError,
    generateRecap,
  };
}
