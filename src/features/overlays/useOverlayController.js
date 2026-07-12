const { useCallback, useState } = React;

export function useOverlayController() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState(null);
  const [vaultHealthOpen, setVaultHealthOpen] = useState(false);
  const [novelImportDialog, setNovelImportDialog] = useState(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [appNotice, setAppNotice] = useState(null);
  const [conflictNotice, setConflictNotice] = useState(null);
  const [versionTargetId, setVersionTargetId] = useState(null);
  const [reminderCenterOpen, setReminderCenterOpen] = useState(false);

  const showAppNotice = useCallback((title, message, tone = 'error') => {
    setAppNotice({ title, message: message || 'The operation could not be completed.', tone });
  }, []);
  const setPaletteOpenForMode = useCallback((mode, nextValue) => {
    setPaletteMode(current => {
      const currentlyOpen = current === mode;
      const shouldOpen = typeof nextValue === 'function' ? nextValue(currentlyOpen) : !!nextValue;
      if (shouldOpen) return mode;
      return currentlyOpen ? null : current;
    });
  }, []);
  const setCommandPaletteOpen = useCallback(nextValue => setPaletteOpenForMode('mixed', nextValue), [setPaletteOpenForMode]);
  const setQuickSwitcherOpen = useCallback(nextValue => setPaletteOpenForMode('notes', nextValue), [setPaletteOpenForMode]);
  const commandPaletteOpen = paletteMode === 'mixed';
  const quickSwitcherOpen = paletteMode === 'notes';

  return {
    settingsOpen,
    setSettingsOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    quickSwitcherOpen,
    setQuickSwitcherOpen,
    vaultHealthOpen,
    setVaultHealthOpen,
    novelImportDialog,
    setNovelImportDialog,
    captureOpen,
    setCaptureOpen,
    deleteTargetId,
    setDeleteTargetId,
    appNotice,
    setAppNotice,
    conflictNotice,
    setConflictNotice,
    versionTargetId,
    setVersionTargetId,
    reminderCenterOpen,
    setReminderCenterOpen,
    showAppNotice,
  };
}
