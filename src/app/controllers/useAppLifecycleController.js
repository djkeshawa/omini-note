function useAppLifecycleController({ HAS_DISK, MN_NOTES_VAULTS_SERVICE, activeVaultId, bootState, canvases, desktopBridge, dirtyNotes, dirtyNotesRef, dirtyRevisionRef, loadVaultBundle, mnNormalizeCustomThemesForApp, navigateView, notes, recordPhase5Metric, selectedId, setActiveCanvas, setActiveVaultId, setCanvases, setCustomThemes, setNotes, setQuery, setSelectedId, setSelectedTag, setSelectedWorkflow, setSettingsOpen, setTags, setTweaks, setVaults, showAppNotice, tags, tagsDirty, tagsRevisionRef, updateDirtyNotes, useCallbackA, useEffectA, useRefA, vaultActivationSeq }) {
  const refreshVaultRegistry = useCallbackA(async ({ reloadActive = false, reason = '', isCurrent = null } = {}) => {
      if (!HAS_DISK) return { ok: true };
      const noteRevision = dirtyRevisionRef.current;
      const tagRevision = tagsRevisionRef.current;
      const activationAtStart = vaultActivationSeq.current;
      // A refresh can span typing and even a completed autosave. Revisions
      // protect those edits after the dirty flags have already been cleared.
      const editsChanged = () => noteRevision !== dirtyRevisionRef.current
        || tagRevision !== tagsRevisionRef.current;
      try {
        const res = await MN_NOTES_VAULTS_SERVICE.listVaults(desktopBridge);
        if (!res.ok) throw new Error(res.error);
        if (isCurrent?.() === false || editsChanged() || activationAtStart !== vaultActivationSeq.current) return { ok: false, stale: true };
        const metas = res.value || res.data?.vaults || [];
        if (!metas.length) throw new Error('No vaults found');
        const validIds = new Set(metas.map(v => v.id));
        const nextActiveId = validIds.has(activeVaultId) ? activeVaultId : metas[0].id;
        const activeChanged = nextActiveId !== activeVaultId;
        const activeHasDirtyNotes = [...dirtyNotesRef.current.values()].some(entry => entry.vaultId === activeVaultId);
        const activeHasUnsavedChanges = activeHasDirtyNotes || tagsDirty.current;
        let activeBundle = null;
  
        if (activeChanged || (reloadActive && nextActiveId && !activeHasUnsavedChanges)) {
          const activationSeq = ++vaultActivationSeq.current;
          activeBundle = await loadVaultBundle(nextActiveId);
          if (activationSeq !== vaultActivationSeq.current || isCurrent?.() === false || editsChanged()) {
            return { ok: false, stale: true };
          }
        }
  
        updateDirtyNotes(cur => {
          let changed = false;
          const next = new Map();
          cur.forEach((entry, key) => {
            if (validIds.has(entry.vaultId)) next.set(key, entry);
            else changed = true;
          });
          return changed ? next : cur;
        });
  
        setVaults(currentVaults => metas.map(meta => {
          const cached = currentVaults.find(v => v.id === meta.id) || {};
          if (activeBundle && meta.id === nextActiveId) {
            return {
              ...meta,
              notes: activeBundle.notes,
              tags: activeBundle.tags,
              lastSelectedId: activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null,
              canvases: activeBundle.canvases,
              novelistMode: activeBundle.novelistMode,
              workflowStates: activeBundle.workflowStates || meta.workflowStates || null,
              novelistAiConfig: activeBundle.novelistAiConfig || meta.novelistAiConfig || null,
            };
          }
          if (!activeChanged && meta.id === activeVaultId) {
            return {
              ...meta,
              notes,
              tags,
              lastSelectedId: selectedId,
              canvases,
              novelistMode: !!meta.novelistMode,
              workflowStates: meta.workflowStates || cached.workflowStates || null,
              novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null,
            };
          }
          return {
            ...meta,
            notes: cached.notes || null,
            tags: cached.tags || null,
            lastSelectedId: cached.lastSelectedId || null,
            canvases: cached.canvases || null,
            novelistMode: !!meta.novelistMode,
            workflowStates: meta.workflowStates || cached.workflowStates || null,
            novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null,
          };
        }));
  
        if (activeBundle) {
          setNotes(activeBundle.notes);
          setTags(activeBundle.tags);
          setCanvases(activeBundle.canvases);
          setActiveVaultId(nextActiveId);
          tagsDirty.current = false;
          if (activeChanged) {
            setActiveCanvas(null);
            setSelectedId(activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null);
            setSelectedTag(null);
            setSelectedWorkflow(null);
            setQuery('');
            navigateView('notes');
            desktopBridge.preferences.setPrefs({ activeVaultId: nextActiveId });
          } else {
            // Same-vault reload: keep the current selection unless the note vanished
            // from disk (e.g. deleted externally), then fall back like a vault switch.
            setSelectedId(current =>
              current && activeBundle.notes.some(n => n.id === current)
                ? current
                : (activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null)
            );
          }
        }
        return { ok: true, vaults: metas, activeVaultId: nextActiveId, reason };
      } catch (e) {
        console.error('refreshVaultRegistry failed', reason, e);
        return { ok: false, error: e.message || String(e) };
      }
    }, [activeVaultId, dirtyNotes, dirtyNotesRef, dirtyRevisionRef, tagsRevisionRef, loadVaultBundle, notes, tags, selectedId, canvases, navigateView]);
  
    // Coming back to the window used to re-read every note body in the vault,
    // ship them all over IPC and re-parse them — on every alt-tab, and twice,
    // because focus and visibilitychange both fired. Now leaving the window
    // takes a cheap fingerprint (per-file metadata, no bodies), and
    // returning compares against it. Nothing moved, nothing reloads. Our own
    // saves happen while focused, so they never trip the comparison.
    const awayStampRef = useRefA(null);
    const stampCheckBusyRef = useRefA(null);
    const stampEffectGenerationRef = useRefA(0);
    const stampRequestSequenceRef = useRefA(0);

    useEffectA(() => {
      if (!HAS_DISK || bootState !== 'ready') return;
      const effectGeneration = ++stampEffectGenerationRef.current;
      awayStampRef.current = null;
      let disposed = false;
      const takeStamp = async () => {
        try {
          const response = await desktopBridge.notes.vaultStamp?.(activeVaultId);
          return response?.ok ? response.value : null;
        } catch { return null; }
      };
      const captureAway = () => {
        if (!activeVaultId) return;
        takeStamp().then(stamp => {
          if (!disposed) awayStampRef.current = stamp;
        });
      };
      const refreshVisible = async () => {
        if (document.visibilityState && document.visibilityState !== 'visible') return;
        if (stampCheckBusyRef.current) return;
        const request = {
          effectGeneration,
          id: ++stampRequestSequenceRef.current,
        };
        stampCheckBusyRef.current = request;
        try {
          const away = awayStampRef.current;
          awayStampRef.current = null;
          const now = away ? await takeStamp() : null;
          const isCurrent = () => (
            !disposed &&
            stampCheckBusyRef.current === request
          );
          if (!isCurrent()) return;
          const unchanged = away && now
            && now.count === away.count
            && now.maxMtimeMs === away.maxMtimeMs
            && typeof now.fingerprint === 'string' && now.fingerprint === away.fingerprint;
          // The vault list itself (names, counts) stays cheap to refresh; the
          // full reload of note bodies only happens when the stamp moved or
          // when there is no stamp to compare against.
          await refreshVaultRegistry({
            reloadActive: !unchanged,
            reason: 'focus',
            isCurrent,
          });
        } finally {
          if (stampCheckBusyRef.current === request) stampCheckBusyRef.current = null;
        }
      };
      window.addEventListener('focus', refreshVisible);
      window.addEventListener('blur', captureAway);
      document.addEventListener('visibilitychange', refreshVisible);
      return () => {
        disposed = true;
        if (stampCheckBusyRef.current?.effectGeneration === effectGeneration) {
          stampCheckBusyRef.current = null;
        }
        awayStampRef.current = null;
        window.removeEventListener('focus', refreshVisible);
        window.removeEventListener('blur', captureAway);
        document.removeEventListener('visibilitychange', refreshVisible);
      };
    }, [bootState, refreshVaultRegistry, activeVaultId]);
  
    useEffectA(() => {
      if (!HAS_DISK || bootState !== 'ready' || !desktopBridge.events?.onVaultFilesChanged) return undefined;
      return desktopBridge.events.onVaultFilesChanged(event => {
        if (!event?.vaultId) return;
        const activeHasDirtyNotes = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
        if (event.vaultId === activeVaultId && (activeHasDirtyNotes || tagsDirty.current)) {
          showAppNotice(
            'File changed outside VispNote',
            'Your unsaved edits are still open. Save them to review the conflict, or reopen the vault to use the disk version.',
            'warn'
          );
          return;
        }
        refreshVaultRegistry({
          reloadActive: event.vaultId === activeVaultId,
          reason: 'external-file-change',
        });
      });
    }, [bootState, dirtyNotes, activeVaultId, refreshVaultRegistry, showAppNotice]);
  
    // A corrupt settings file makes the main process rebuild the vault list
    // from the folders on disk. Say so once, over the real app with the
    // recovered vaults already visible behind it — not on the launch screen,
    // which is the failure state. The marker lives in main-process memory, so
    // the next boot reads a valid config and reports nothing.
    const configRecoveryNoticedRef = useRefA(false);

    useEffectA(() => {
      if (!HAS_DISK || bootState !== 'ready' || configRecoveryNoticedRef.current) return;
      configRecoveryNoticedRef.current = true;
      (async () => {
        try {
          const res = await desktopBridge.preferences.getPrefs();
          const recovery = (res?.ok ? res.value : res)?.configRecovery;
          if (!recovery) return;
          const count = recovery.vaultCount || 0;
          // One string with a swapped opening clause, so the three reasons stay
          // visually identical and cannot drift apart. 'empty' means nothing was
          // damaged and nothing was set aside, so it must claim neither.
          const clause = recovery.reason === 'missing' ? 'was missing'
            : recovery.reason === 'empty' ? 'listed no vaults'
            : 'could not be read';
          // The basename, not the absolute path: the notice shell is a fixed
          // 400px with no scroll, and a screen reader reads every path segment.
          const brokenName = recovery.brokenFileName || String(recovery.brokenFile || '').split(/[\\/]/).pop();
          const setAside = recovery.brokenFile
            ? `\n\nThe damaged file was set aside as ${brokenName}.`
            : '';
          showAppNotice(
            'Your vaults were recovered',
            `VispNote's settings file ${clause}. It rebuilt the vault list from the folders on your disk, so all ${count} vault${count === 1 ? '' : 's'} and your notes are here.${setAside}`,
            'warn'
          );
        } catch (e) {
          console.warn('config recovery notice failed', e);
        }
      })();
    }, [bootState, showAppNotice]);

    // Listen for host tweak-mode messages (still supported)
    useEffectA(() => {
      const handler = (e) => {
        const msg = e.data || {};
        if (msg.type === '__activate_edit_mode') setSettingsOpen(true);
        if (msg.type === '__deactivate_edit_mode') setSettingsOpen(false);
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__edit_mode_available' }, '*');
      return () => window.removeEventListener('message', handler);
    }, []);
  
    const setTweak = useCallbackA((key, val) => {
      setTweaks(t => {
        const next = { ...t, [key]: val };
        window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
        return next;
      });
    }, []);
  
    const importThemeFile = useCallbackA(async () => {
      if (!desktopBridge.preferences?.importThemeFile) {
        const error = 'This build does not expose theme import.';
        showAppNotice('Theme import unavailable', error, 'warn');
        return { ok: false, error };
      }
      try {
        const res = await desktopBridge.preferences.importThemeFile();
        if (!res?.ok) throw new Error(res?.error || 'Could not install theme.');
        const value = res.value || {};
        if (value.canceled) return { ok: true, canceled: true };
        const nextThemes = mnNormalizeCustomThemesForApp(value.customThemes);
        setCustomThemes(nextThemes);
        if (value.theme?.id) setTweak('theme', value.theme.id);
        recordPhase5Metric('theme_installs', { themeId: value.theme?.id });
        showAppNotice('Theme installed', `${value.theme?.name || 'Theme'} is ready.`, 'info');
        return { ok: true, canceled: false, theme: value.theme };
      } catch (e) {
        const error = e.message || String(e);
        showAppNotice('Could not install theme', error);
        return { ok: false, error };
      }
    }, [recordPhase5Metric, showAppNotice]);
  return { refreshVaultRegistry, setTweak, importThemeFile };
}

export { useAppLifecycleController };
