const { useCallback, useEffect, useMemo, useRef, useState } = React;

export function updateAiSessionById(sessions, sessionId, updater, sessionTitle, now = () => new Date().toISOString()) {
  if (!sessionId) return sessions;
  return sessions.map(session => {
    if (session.id !== sessionId) return session;
    const next = typeof updater === 'function' ? updater(session) : updater;
    const merged = { ...session, ...(next || {}) };
    return { ...merged, title: sessionTitle(merged), updatedAt: now() };
  });
}

export function useAiSessionsController({
  view,
  navigateView,
  createSession,
  sessionTitle,
  pickActiveSession,
}) {
  const [seed, setSeed] = useState('');
  const openRef = useRef(false);
  const newSession = useCallback(() => createSession(), [createSession]);
  const [sessions, setSessions] = useState(() => [createSession()]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const activeSessionIdRef = useRef('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    openRef.current = view === 'ai';
  }, [view]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const selectSession = useCallback((sessionId) => {
    const nextId = String(sessionId || '');
    activeSessionIdRef.current = nextId;
    setActiveSessionId(nextId);
  }, []);

  const open = useCallback((initialQuery = '') => {
    setNotice(null);
    setSeed(typeof initialQuery === 'string' ? initialQuery : '');
    navigateView('ai');
  }, [navigateView]);

  const activeSession = useMemo(
    () => pickActiveSession(sessions, activeSessionId),
    [activeSessionId, pickActiveSession, sessions]
  );

  useEffect(() => {
    if (!activeSession && sessions[0]) selectSession(sessions[0].id);
  }, [activeSession, selectSession, sessions]);

  const updateSessionById = useCallback((sessionId, updater) => {
    setSessions(previous => updateAiSessionById(previous, sessionId, updater, sessionTitle));
  }, [sessionTitle]);

  const updateActiveSession = useCallback((updater, sessionIdOverride = '') => {
    const sessionId = sessionIdOverride || activeSessionIdRef.current || sessions[0]?.id;
    if (sessionId) updateSessionById(sessionId, updater);
  }, [sessions, updateSessionById]);

  const createChat = useCallback(() => {
    const session = newSession();
    setSessions(previous => [session, ...previous]);
    selectSession(session.id);
    setSeed('');
    navigateView('ai');
  }, [navigateView, newSession, selectSession]);

  const deleteChat = useCallback((id) => {
    const target = sessions.find(session => session.id === id);
    if (target?.pending) return;
    const next = sessions.filter(session => session.id !== id);
    if (!next.length) {
      setSessions([]);
      selectSession('');
      return;
    }
    const nextActive = pickActiveSession(next, activeSessionId);
    setSessions(next);
    if (id === activeSessionId || !nextActive || nextActive.id !== activeSessionId) {
      selectSession(nextActive?.id || '');
    }
  }, [activeSessionId, pickActiveSession, selectSession, sessions]);

  const renameChat = useCallback((id, title) => {
    const next = String(title || 'New chat').slice(0, 80) || 'New chat';
    setSessions(previous => previous.map(session => session.id === id
      ? { ...session, title: next, updatedAt: new Date().toISOString() }
      : session));
  }, []);

  const archiveChat = useCallback((id, archived = true) => {
    const target = sessions.find(session => session.id === id);
    if (target?.pending) return;
    const next = sessions.map(session => session.id === id
      ? { ...session, archived: !!archived, updatedAt: new Date().toISOString() }
      : session);
    if (archived && id === activeSessionId) {
      const nextActive = pickActiveSession(next, activeSessionId, { allowArchivedPreferred: false });
      if (nextActive && !nextActive.archived) {
        setSessions(next);
        selectSession(nextActive.id);
      } else {
        const session = newSession();
        setSessions([session, ...next]);
        selectSession(session.id);
      }
      return;
    }
    setSessions(next);
  }, [activeSessionId, newSession, pickActiveSession, selectSession, sessions]);

  const notifyComplete = useCallback((nextNotice) => {
    if (openRef.current) return;
    setNotice({
      id: `ai_${Date.now().toString(36)}`,
      query: nextNotice?.query || 'AI task completed',
      error: nextNotice?.error || null,
    });
  }, []);

  return {
    seed,
    sessions,
    activeSession,
    notice,
    setNotice,
    setActiveSessionId: selectSession,
    open,
    updateActiveSession,
    updateSessionById,
    createChat,
    deleteChat,
    renameChat,
    archiveChat,
    notifyComplete,
  };
}
