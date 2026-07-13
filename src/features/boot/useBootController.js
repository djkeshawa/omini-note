const { useCallback, useEffect, useState } = React;

export function useBootController({
  hasDisk,
  platform,
  notesVaultsService,
  seedVaults,
  seedNotes,
  seedTags,
  defaultTweaks,
  novelistWorkflowStates,
  normalizeNotes,
  markdownToBlocks,
  normalizePacks,
  normalizeThemes,
  sanitizeMetrics,
  writeMetrics,
  normalizeSmartViews,
  normalizeStartupView,
  normalizeWorkflowStates,
  applyWorkflowStates,
  loadVaultBundle,
  setEnabledPacks,
  setAssistanceEnabled,
  setLastBackupAt,
  setCustomThemes,
  setSavedSmartViews,
  setTweaks,
  setVaults,
  setActiveVaultId,
  setTags,
  setNotes,
  setCanvases,
  setSelectedId,
  setView,
}) {
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setState('loading');
    setAttempt(current => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!hasDisk) {
          const fallbackSources = Array.isArray(seedVaults) && seedVaults.length
            ? seedVaults
            : [{ id: 'v_personal', name: 'Personal', slug: 'personal', path: '~/VispNote/personal', notes: seedNotes, tags: seedTags, novelistMode: false }];
          const fallbackVaults = fallbackSources.map((vault, index) => {
            const slug = vault.slug || String(vault.name || `vault-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `vault-${index + 1}`;
            const notes = normalizeNotes(vault.notes || [], markdownToBlocks);
            return {
              id: vault.id || `v_${slug}`,
              name: vault.name || 'Personal',
              slug,
              path: vault.path || `~/VispNote/${slug}`,
              notes,
              tags: vault.tags || [],
              canvases: [],
              lastSelectedId: vault.lastSelectedId || notes[0]?.id || null,
              workflowStates: vault.workflowStates || (vault.novelistMode ? novelistWorkflowStates : null),
              novelistAiConfig: vault.novelistAiConfig || null,
              novelistMode: !!vault.novelistMode,
            };
          });
          if (cancelled) return;
          const active = fallbackVaults[0];
          setVaults(fallbackVaults);
          setActiveVaultId(active?.id || null);
          setTags(active?.tags || []);
          setNotes(active?.notes || []);
          setCanvases([]);
          setSelectedId(active?.lastSelectedId || active?.notes?.[0]?.id || null);
          setState('ready');
          return;
        }

        const prefsResponse = await platform.preferences.getPrefs();
        if (!prefsResponse.ok) throw new Error(prefsResponse.error);
        const prefs = prefsResponse.value;
        setEnabledPacks(normalizePacks(prefs.enabledPacks));
        setAssistanceEnabled(prefs.aiConfig?.enabled === true);
        setLastBackupAt?.(prefs.lastBackupAt || null);
        setCustomThemes(normalizeThemes(prefs.customThemes));
        if (prefs.phase5Metrics && sanitizeMetrics) writeMetrics(sanitizeMetrics(prefs.phase5Metrics));
        const smartViews = normalizeSmartViews(prefs.smartViews);
        setSavedSmartViews(smartViews);
        if (!Array.isArray(prefs.smartViews) && platform.preferences.setPrefs) {
          platform.preferences.setPrefs({ smartViews }).catch(nextError => console.warn('Could not initialize Smart Views preferences', nextError));
        }
        let startupView = 'notes';
        if (prefs.tweaks) {
          const mergedTweaks = { ...defaultTweaks, ...prefs.tweaks };
          startupView = normalizeStartupView(mergedTweaks.startupView);
          mergedTweaks.startupView = startupView;
          applyWorkflowStates(normalizeWorkflowStates(mergedTweaks.workflowStates));
          setTweaks(current => ({ ...current, ...prefs.tweaks, startupView }));
        }

        const vaultsResponse = await notesVaultsService.listVaults(platform);
        if (!vaultsResponse.ok) throw new Error(vaultsResponse.error);
        const vaultList = vaultsResponse.value || vaultsResponse.data?.vaults || [];
        if (!vaultList.length) throw new Error('No vaults found');
        const activeId = vaultList.some(vault => vault.id === prefs.activeVaultId) ? prefs.activeVaultId : vaultList[0].id;
        const loaded = await loadVaultBundle(activeId);
        if (cancelled) return;
        setVaults(vaultList.map(meta => meta.id === activeId
          ? { ...meta, novelistMode: loaded.novelistMode, workflowStates: loaded.workflowStates || meta.workflowStates || null, novelistAiConfig: loaded.novelistAiConfig || meta.novelistAiConfig || null, notes: loaded.notes, tags: loaded.tags, lastSelectedId: loaded.lastSelectedId, canvases: loaded.canvases }
          : { ...meta, notes: null, tags: null, canvases: null }));
        setActiveVaultId(activeId);
        setTags(loaded.tags || []);
        setNotes(loaded.notes);
        setCanvases(loaded.canvases);
        setSelectedId(loaded.lastSelectedId || loaded.notes[0]?.id || null);
        if (startupView === 'today') setView('today');
        if (prefs.activeVaultId !== activeId) platform.preferences.setPrefs({ activeVaultId: activeId });
        setState('ready');
      } catch (bootError) {
        console.error('Bootstrap failed', bootError);
        if (!cancelled) {
          setError(bootError.message || String(bootError));
          setState('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [applyWorkflowStates, attempt, defaultTweaks, hasDisk, loadVaultBundle, markdownToBlocks, normalizeNotes, normalizePacks, normalizeSmartViews, normalizeStartupView, normalizeThemes, normalizeWorkflowStates, notesVaultsService, novelistWorkflowStates, platform, sanitizeMetrics, seedNotes, seedTags, seedVaults, setActiveVaultId, setAssistanceEnabled, setCanvases, setCustomThemes, setEnabledPacks, setLastBackupAt, setNotes, setSavedSmartViews, setSelectedId, setTags, setTweaks, setVaults, setView, writeMetrics]);

  return { state, error, retry };
}
