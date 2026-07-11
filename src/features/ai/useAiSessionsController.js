const { useCallback, useEffect, useMemo, useRef, useState } = React;

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
    if (!activeSession && sessions[0]) setActiveSessionId(sessions[0].id);
  }, [activeSession, sessions]);

  const updateActiveSession = useCallback((updater) => {
    setSessions(previous => previous.map(session => {
      if (session.id !== (activeSessionIdRef.current || previous[0]?.id)) return session;
      const next = typeof updater === 'function' ? updater(session) : updater;
      const title = sessionTitle({ ...session, ...(next || {}) });
      return { ...session, ...(next || {}), title, updatedAt: new Date().toISOString() };
    }));
  }, [sessionTitle]);

  const createChat = useCallback(() => {
    const session = newSession();
    setSessions(previous => [session, ...previous]);
    setActiveSessionId(session.id);
    setSeed('');
    navigateView('ai');
  }, [navigateView, newSession]);

  const deleteChat = useCallback((id) => {
    const target = sessions.find(session => session.id === id);
    if (target?.pending) return;
    const next = sessions.filter(session => session.id !== id);
    if (!next.length) {
      setSessions([]);
      setActiveSessionId('');
      return;
    }
    const nextActive = pickActiveSession(next, activeSessionId);
    setSessions(next);
    if (id === activeSessionId || !nextActive || nextActive.id !== activeSessionId) {
      setActiveSessionId(nextActive?.id || '');
    }
  }, [activeSessionId, pickActiveSession, sessions]);

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
        setActiveSessionId(nextActive.id);
      } else {
        const session = newSession();
        setSessions([session, ...next]);
        setActiveSessionId(session.id);
      }
      return;
    }
    setSessions(next);
  }, [activeSessionId, newSession, pickActiveSession, sessions]);

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
    setActiveSessionId,
    open,
    updateActiveSession,
    createChat,
    deleteChat,
    renameChat,
    archiveChat,
    notifyComplete,
  };
}
