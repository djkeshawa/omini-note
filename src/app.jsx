// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed via window.mn (Electron preload IPC). Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;

const MN_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "graphStyle": "force",
  "todoVariant": "list",
  "toastVariant": "card",
  "fontChoice": "Editorial (Newsreader + Inter)",
  "showNoteList": true,
  "showSidebar": true,
  "editorWidth": "medium",
  "fontSize": "default",
  "appFontSize": "default",
  "indentGuides": true,
  "spellCheck": true,
  "autoLink": true,
  "collapseByDefault": false,
  "sortBy": "modified",
  "defaultTags": "",
  "pinnedFirst": true,
  "rollupFormat": "long",
  "reminderSound": false,
  "showOverdue": true,
  "snoozeMinutes": "15",
  "weekStart": "monday",
  "autoSave": true,
  "storageFormat": "markdown",
  "sync": "local"
}/*EDITMODE-END*/;

// Convert raw notes (with markdown body) to runtime form (with parsed blocks).
function normalizeNotes(notes, mnMdToBlocks) {
  return (notes || []).map(n => ({
    ...n,
    blocks: n.blocks || mnMdToBlocks(n.body || ''),
  }));
}

// Strip in-memory-only fields before persisting to disk.
function noteForDisk(n, mnBlocksToMd) {
  return {
    id: n.id,
    title: n.title || 'Untitled',
    date: n.date || new Date().toISOString(),
    tags: Array.isArray(n.tags) ? n.tags : [],
    pinned: !!n.pinned,
    body: mnBlocksToMd(n.blocks || []),
  };
}

function collectWorkflowBlocks(notes, states, mnWalk) {
  const stateIds = states.map(s => s.id);
  const counts = Object.fromEntries(stateIds.map(id => [id, 0]));
  const byState = Object.fromEntries(stateIds.map(id => [id, []]));
  const noteIdsByState = Object.fromEntries(stateIds.map(id => [id, new Set()]));

  notes.forEach(note => {
    mnWalk(note.blocks || [], (block) => {
      if (!block.workflow || !counts.hasOwnProperty(block.workflow)) return;
      counts[block.workflow]++;
      noteIdsByState[block.workflow].add(note.id);
      byState[block.workflow].push({
        id: block.id,
        noteId: note.id,
        noteTitle: note.title,
        noteTags: note.tags || [],
        text: block.content || '',
        kind: block.kind,
        workflow: block.workflow,
      });
    });
  });

  return {
    counts,
    byState,
    noteIdsByState,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

const MN_LAUNCH_NEURAL_PATHS = [
  { color: '#7fa2ff', d: 'M500 350 C420 285 320 260 195 210 S58 142 0 80', main: true },
  { color: '#7fa2ff', d: 'M318 258 C292 212 268 182 218 145' },
  { color: '#7fa2ff', d: 'M178 203 C138 238 93 258 38 258' },
  { color: '#72d7bd', d: 'M500 350 C590 276 710 236 850 150 S965 58 1000 30', main: true },
  { color: '#72d7bd', d: 'M705 238 C758 302 834 326 922 300' },
  { color: '#72d7bd', d: 'M850 150 C890 184 940 198 1000 190' },
  { color: '#eaa2c6', d: 'M500 350 C470 430 392 524 320 700', main: true },
  { color: '#eaa2c6', d: 'M404 506 C330 500 265 526 205 588' },
  { color: '#eaa2c6', d: 'M352 622 C410 650 472 678 548 700' },
  { color: '#efc96f', d: 'M500 350 C565 430 680 536 1000 654', main: true },
  { color: '#efc96f', d: 'M686 536 C728 490 788 468 865 472' },
  { color: '#efc96f', d: 'M828 596 C870 642 912 672 970 700' },
  { color: '#a998ef', d: 'M500 350 C500 252 520 142 520 0', main: true },
  { color: '#a998ef', d: 'M510 212 C456 170 418 112 395 32' },
  { color: '#a998ef', d: 'M516 112 C584 88 635 52 678 0' },
  { color: '#7bcde8', d: 'M500 350 C500 456 505 578 500 700', main: true },
  { color: '#7bcde8', d: 'M502 486 C560 522 608 574 645 650' },
  { color: '#7bcde8', d: 'M500 560 C438 592 394 638 365 700' },
  { color: '#9ddb88', d: 'M500 350 C360 360 212 426 0 500', main: true },
  { color: '#9ddb88', d: 'M254 414 C206 374 142 350 58 344' },
  { color: '#9ddb88', d: 'M148 448 C118 512 76 558 0 600' },
  { color: '#eba696', d: 'M500 350 C650 365 812 430 1000 508', main: true },
  { color: '#eba696', d: 'M760 410 C818 374 890 352 1000 344' },
  { color: '#eba696', d: 'M880 458 C918 520 955 566 1000 600' },
];

const MN_LAUNCH_NEURAL_NODES = [
  ['#7fa2ff', 500, 350, 9],
  ['#72d7bd', 318, 258, 5],
  ['#72d7bd', 705, 238, 5],
  ['#eaa2c6', 404, 506, 5],
  ['#efc96f', 686, 536, 5],
  ['#a998ef', 510, 212, 5],
  ['#7bcde8', 502, 486, 5],
];

function MnLaunchScreen({ state, error, T }) {
  const loading = state === 'loading';
  const mainPaths = MN_LAUNCH_NEURAL_PATHS.filter(p => p.main).slice(0, 6);
  return (
    <div className="mn-boot-splash" style={{ position: 'relative', zIndex: 'auto', width: '100vw', height: '100vh' }}>
      <div className="mn-boot-grid" />
      <svg className="mn-boot-neural-field" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
        {MN_LAUNCH_NEURAL_PATHS.map((path, i) => (
          <path
            key={`${path.d}-${i}`}
            className={`mn-neuron-axon${path.main ? '' : ' mn-neuron-branch'}`}
            style={{
              '--axon-color': path.color,
              animationPlayState: loading ? 'running' : 'paused',
            }}
            d={path.d}
          />
        ))}
        {MN_LAUNCH_NEURAL_NODES.map(([color, cx, cy, r]) => (
          <circle
            key={`${cx}-${cy}`}
            className="mn-neuron-node"
            style={{ '--axon-color': color }}
            cx={cx}
            cy={cy}
            r={r}
          />
        ))}
        {mainPaths.map((path, i) => (
          <circle
            key={`fire-${path.d}`}
            className="mn-neuron-fire"
            style={{ '--axon-color': path.color, opacity: loading ? 0.58 : 0 }}
            r="4.5">
            <animateMotion
              dur={`${2.7 + (i % 3) * 0.12}s`}
              begin={`${i * 0.18}s`}
              repeatCount="indefinite"
              path={path.d}
            />
          </circle>
        ))}
      </svg>
      <div className="mn-boot-core">
        <div className="mn-boot-title">OminiNote</div>
        <div className="mn-boot-subtitle" style={{ color: loading ? '#667187' : '#b84b42' }}>
          {loading ? 'Connecting your workspace' : 'Launch interrupted'}
        </div>

        {loading ? (
          <>
            <div className="mn-boot-progress"><div /></div>
            <div style={{
              position: 'relative',
              zIndex: 1,
              marginTop: 18,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              color: '#56647c',
            }}>Opening vault and indexing notes</div>
          </>
        ) : (
          <div style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(420px, calc(100vw - 48px))',
            marginTop: 24,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.56)',
            border: '1px solid rgba(120,130,152,0.22)',
            color: '#56647c',
            fontFamily: 'var(--mn-mono)',
            fontSize: 11,
            lineHeight: 1.55,
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>{error || 'Unknown startup error'}</div>
        )}
      </div>
    </div>
  );
}

const HAS_DISK = typeof window !== 'undefined' && !!window.mn;

function MnDeleteNoteDialog({ note, T, onCancel, onConfirm }) {
  const cancelRef = useRefA(null);

  useEffectA(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  if (!note) return null;
  const blockCount = (window.MN_OUTLINE?.mnFlatten?.(note.blocks || [], 0, false) || []).length;
  const tagText = (note.tags || []).length
    ? (note.tags || []).map(t => `#${t}`).join(' ')
    : 'No tags';

  const btnBase = {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
  };

  return (
    <div
      className="mn-delete-note-dialog"
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-delete-note-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: T.danger,
            background: `color-mix(in oklab, ${T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-delete-note-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>Delete note?</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
            }}>This removes the note from the current vault.</div>
          </div>
        </div>
        <div style={{ padding: '16px 18px 10px' }}>
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: '11px 12px',
          }}>
            <div style={{
              fontSize: 13.5,
              fontWeight: 650,
              color: T.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 5,
            }}>{note.title || 'Untitled'}</div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkDim,
            }}>
              <span>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
              <span style={{ color: T.line }}>•</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagText}</span>
            </div>
          </div>
          <div style={{
            marginTop: 11,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: T.inkMed,
          }}>This action cannot be undone from the editor history.</div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px 16px',
        }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              ...btnBase,
              background: T.bg,
              color: T.inkMed,
              border: `1px solid ${T.line}`,
            }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...btnBase,
              background: T.danger,
              color: T.bg,
              border: `1px solid ${T.danger}`,
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Delete note
          </button>
        </div>
      </div>
    </div>
  );
}

function MnApp() {
  const { SEED_TAGS, SEED_NOTES, buildLinks } = window.MN_DATA;
  const { mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk } = window.MN_OUTLINE;
  // make them available to other modules via globals too
  window.mnMdToBlocks = mnMdToBlocks; window.mnBlocksToMd = mnBlocksToMd;
  window.mnWalk = mnWalk; window.mnLocate = mnLocate; window.mnCloneBlocks = mnCloneBlocks;
  window.mkBlock = mkBlock;

  const [bootState, setBootState] = useStateA('loading'); // 'loading' | 'ready' | 'error'
  const [bootError, setBootError] = useStateA(null);

  const [tweaks, setTweaks] = useStateA(MN_TWEAK_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useStateA(false);

  // ── State (populated after disk load) ───────────────────────────────────
  // vaults stores per-vault metadata + cached notes/tags (cache fills lazily)
  const [vaults, setVaults] = useStateA([]);
  const [activeVaultId, setActiveVaultId] = useStateA(null);
  const [tags, setTags] = useStateA([]);
  const [notes, setNotes] = useStateA([]);
  const [selectedId, setSelectedId] = useStateA(null);

  const [selectedTag, setSelectedTag] = useStateA(null);
  const [selectedWorkflow, setSelectedWorkflow] = useStateA(null);
  const [view, setView] = useStateA('notes');
  const lastViewRef = useRefA('notes');
  const [askAiOpen, setAskAiOpen] = useStateA(false);
  const [captureOpen, setCaptureOpen] = useStateA(false);
  const [deleteTargetId, setDeleteTargetId] = useStateA(null);
  const [toast, setToast] = useStateA(null);
  const [query, setQuery] = useStateA('');

  useEffectA(() => {
    if (bootState === 'loading') return;
    const splash = document.getElementById('mn-boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    const handle = setTimeout(() => splash.remove(), 240);
    return () => clearTimeout(handle);
  }, [bootState]);

  const navigateView = useCallbackA((nextView) => {
    setView(current => {
      if (current !== nextView) lastViewRef.current = current;
      return nextView;
    });
  }, []);

  const goBackView = useCallbackA(() => {
    const target = lastViewRef.current || 'notes';
    setView(current => {
      lastViewRef.current = current === target ? 'notes' : current;
      return target;
    });
  }, []);

  // dirtyNotes tracks note -> owning vault. This prevents a delayed save from
  // writing an edited note into whatever vault happens to be active later.
  const [dirtyNotes, setDirtyNotes] = useStateA(() => new Map());
  const markDirty = useCallbackA((id) => {
    if (!id || !activeVaultId) return;
    setDirtyNotes(s => {
      const n = new Map(s);
      n.set(id, activeVaultId);
      return n;
    });
  }, [activeVaultId]);
  const tagsDirty = useRefA(false);
  const markTagsDirty = useCallbackA(() => { tagsDirty.current = true; }, []);

  const saveVaultMetaNow = useCallbackA(async (
    vaultId = activeVaultId,
    nextTags = tags,
    nextSelectedId = selectedId,
    forceTags = false
  ) => {
    if (!HAS_DISK || !vaultId) return;
    const patch = {};
    if (forceTags || tagsDirty.current) patch.tags = nextTags;
    if (nextSelectedId) patch.lastSelectedId = nextSelectedId;
    if (!Object.keys(patch).length) return;
    try {
      await window.mn.saveVaultMeta(vaultId, patch);
      if (patch.tags && vaultId === activeVaultId) tagsDirty.current = false;
    } catch (e) {
      console.error('saveVaultMeta failed', e);
    }
  }, [activeVaultId, tags, selectedId]);

  // ── Bootstrap from disk ─────────────────────────────────────────────────
  useEffectA(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!HAS_DISK) {
          // In-browser fallback: use seed
          const seedNotes = normalizeNotes(SEED_NOTES, mnMdToBlocks);
          if (cancelled) return;
          setVaults([{
            id: 'v_personal', name: 'Personal', slug: 'personal',
            path: '~/OminiNote/personal', notes: seedNotes, tags: SEED_TAGS,
          }]);
          setActiveVaultId('v_personal');
          setTags(SEED_TAGS);
          setNotes(seedNotes);
          setSelectedId(seedNotes[0]?.id || null);
          setBootState('ready');
          return;
        }

        const prefsRes = await window.mn.getPrefs();
        if (!prefsRes.ok) throw new Error(prefsRes.error);
        const prefs = prefsRes.value;
        if (prefs.tweaks) setTweaks(t => ({ ...t, ...prefs.tweaks }));
        if (prefs.aiConfig && window.mn?.ai) await window.mn.ai.setConfig(prefs.aiConfig);

        const vlistRes = await window.mn.listVaults();
        if (!vlistRes.ok) throw new Error(vlistRes.error);
        const vlist = vlistRes.value;
        if (!vlist.length) throw new Error('No vaults found');

        const activeId = prefs.activeVaultId || vlist[0].id;

        const vaultRes = await window.mn.loadVault(activeId);
        if (!vaultRes.ok) throw new Error(vaultRes.error);
        const v = vaultRes.value;
        const loadedNotes = normalizeNotes(v.notes, mnMdToBlocks);

        if (cancelled) return;
        setVaults(vlist.map(meta => meta.id === activeId
          ? { ...meta, notes: loadedNotes, tags: v.tags, lastSelectedId: v.lastSelectedId }
          : { ...meta, notes: null, tags: null }));
        setActiveVaultId(activeId);
        setTags(v.tags || []);
        setNotes(loadedNotes);
        setSelectedId(v.lastSelectedId || loadedNotes[0]?.id || null);
        setBootState('ready');
      } catch (e) {
        console.error('Bootstrap failed', e);
        if (!cancelled) { setBootError(e.message || String(e)); setBootState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Persist tweaks ─────────────────────────────────────────────────────
  const tweakInitialized = useRefA(false);
  useEffectA(() => {
    if (!HAS_DISK) return;
    if (!tweakInitialized.current) { tweakInitialized.current = true; return; }
    const t = setTimeout(() => { window.mn.setPrefs({ tweaks }); }, 250);
    return () => clearTimeout(t);
  }, [tweaks]);

  const findNotesForVault = useCallbackA((vaultId, currentNotes = notes, currentVaults = vaults) => {
    if (vaultId === activeVaultId) return currentNotes;
    return currentVaults.find(v => v.id === vaultId)?.notes || [];
  }, [activeVaultId, notes, vaults]);

  const saveDirtyNotesNow = useCallbackA(async (entries, currentNotes = notes, currentVaults = vaults) => {
    if (!HAS_DISK || !entries?.length) return;
    for (const [id, vaultId] of entries) {
      const noteList = findNotesForVault(vaultId, currentNotes, currentVaults);
      const n = noteList.find(x => x.id === id);
      if (!n) continue;
      try {
        await window.mn.saveNote(vaultId, noteForDisk(n, mnBlocksToMd));
        setDirtyNotes(cur => {
          if (cur.get(id) !== vaultId) return cur;
          const next = new Map(cur);
          next.delete(id);
          return next;
        });
      } catch (e) {
        console.error('saveNote failed', id, e);
      }
    }
  }, [findNotesForVault, notes, vaults]);

  // ── Persist dirty notes (debounced) ────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !dirtyNotes.size) return;
    const handle = setTimeout(async () => {
      await saveDirtyNotesNow([...dirtyNotes.entries()]);
    }, 500);
    return () => clearTimeout(handle);
  }, [dirtyNotes, saveDirtyNotesNow]);

  // ── Persist tags + lastSelectedId ──────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId) return;
    if (!tagsDirty.current) return;
    saveVaultMetaNow(activeVaultId, tags, selectedId, true);
  }, [tags, activeVaultId, selectedId, saveVaultMetaNow]);

  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId || !selectedId) return;
    const t = setTimeout(() => {
      saveVaultMetaNow(activeVaultId, tags, selectedId, false);
    }, 1000);
    return () => clearTimeout(t);
  }, [selectedId, activeVaultId, tags, saveVaultMetaNow]);

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

  const setTweak = (key, val) => {
    setTweaks(t => {
      const next = { ...t, [key]: val };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
      return next;
    });
  };

  const theme = tweaks.theme;
  const T = MN_THEMES[theme];
  const fonts = MN_FONTS[tweaks.fontChoice] || MN_FONTS['Editorial (Newsreader + Inter)'];
  const appScale = tweaks.appFontSize === 'small'
    ? 0.92
    : tweaks.appFontSize === 'large'
    ? 1.08
    : tweaks.appFontSize === 'x-large'
    ? 1.16
    : 1;

  useEffectA(() => {
    const root = document.documentElement;
    root.style.setProperty('--mn-ui', fonts.ui);
    root.style.setProperty('--mn-body', fonts.body);
    root.style.setProperty('--mn-mono', fonts.mono);
    root.style.setProperty('--mn-bg', T.bg);
    root.style.setProperty('--mn-app-font-size', tweaks.appFontSize === 'small' ? '12px' : tweaks.appFontSize === 'large' ? '14px' : tweaks.appFontSize === 'x-large' ? '15px' : '13px');
  }, [fonts, T, tweaks.appFontSize]);

  // ── Vault switching (lazy load from disk) ──────────────────────────────
  const selectVault = useCallbackA(async (id) => {
    if (id === activeVaultId) return;
    const pendingForCurrentVault = [...dirtyNotes.entries()].filter(([, vaultId]) => vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    // stash current vault's in-memory state into cache
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, notes, tags, lastSelectedId: selectedId }
      : v));
    const target = vaults.find(v => v.id === id);
    if (!target) return;

    let targetNotes = target.notes, targetTags = target.tags, targetSel = target.lastSelectedId;
    if (!targetNotes && HAS_DISK) {
      try {
        const res = await window.mn.loadVault(id);
        if (res.ok) {
          targetNotes = normalizeNotes(res.value.notes, mnMdToBlocks);
          targetTags = res.value.tags || [];
          targetSel = res.value.lastSelectedId;
        }
      } catch (e) { console.error('loadVault failed', id, e); }
    }
    targetNotes = targetNotes || [];
    targetTags = targetTags || [];
    setNotes(targetNotes);
    setTags(targetTags);
    setSelectedId(targetSel || targetNotes[0]?.id || null);
    setActiveVaultId(id);
    setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: id });
  }, [activeVaultId, vaults, notes, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView]);

  const createVault = useCallbackA(async (name) => {
    const pendingForCurrentVault = [...dirtyNotes.entries()].filter(([, vaultId]) => vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    if (!HAS_DISK) {
      // In-browser fallback (transient)
      const id = 'v_' + Date.now();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const firstNoteId = 'n_' + Date.now();
      const newNotes = [{
        id: firstNoteId, title: 'Welcome to ' + name,
        date: new Date().toISOString(), tags: [], pinned: false,
        blocks: mnMdToBlocks(`- This is your new vault\n- Create notes with ⌘N`),
      }];
      setVaults(vs => [
        ...vs.map(v => v.id === activeVaultId ? { ...v, notes, tags, lastSelectedId: selectedId } : v),
        { id, name, slug, path: `~/OminiNote/${slug}`, notes: null, tags: null },
      ]);
      setNotes(newNotes); setTags([]); setSelectedId(firstNoteId);
      setActiveVaultId(id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      return;
    }
    try {
      const res = await window.mn.createVault(name);
      if (!res.ok) throw new Error(res.error);
      const v = res.value;
      // stash current
      setVaults(vs => [
        ...vs.map(x => x.id === activeVaultId ? { ...x, notes, tags, lastSelectedId: selectedId } : x),
        { ...v, notes: null, tags: null },
      ]);
      // load the new vault from disk (it has the seeded welcome note)
      const loadRes = await window.mn.loadVault(v.id);
      if (!loadRes.ok) throw new Error(loadRes.error);
      const loaded = loadRes.value;
      const loadedNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
      setNotes(loadedNotes); setTags(loaded.tags || []);
      setSelectedId(loaded.lastSelectedId || loadedNotes[0]?.id || null);
      setActiveVaultId(v.id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      window.mn.setPrefs({ activeVaultId: v.id });
    } catch (e) {
      console.error('createVault failed', e); alert('Could not create vault: ' + e.message);
    }
  }, [activeVaultId, notes, vaults, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView]);

  const renameVault = useCallbackA(async (id, name) => {
    setVaults(vs => vs.map(v => v.id === id ? { ...v, name } : v));
    if (HAS_DISK) {
      try { await window.mn.renameVault(id, name); }
      catch (e) { console.error('renameVault failed', e); }
    }
  }, []);

  const vaultsForSidebar = useMemoA(() => vaults.map(v => ({
    ...v,
    noteCount: v.id === activeVaultId ? notes.length : (v.notes?.length ?? 0),
  })), [vaults, activeVaultId, notes]);

  const sidebarHidden = tweaks.showSidebar === false;
  const setSidebarHidden = (v) => {
    const next = typeof v === 'function' ? v(sidebarHidden) : v;
    setTweak('showSidebar', !next);
  };
  const noteListHidden = tweaks.showNoteList === false;
  const setNoteListHidden = (v) => {
    const next = typeof v === 'function' ? v(noteListHidden) : v;
    setTweak('showNoteList', !next);
  };

  // Keep body (markdown) in sync for backlinks / search / save
  const notesWithBody = useMemoA(() => notes.map(n => ({
    ...n, body: mnBlocksToMd(n.blocks || []),
  })), [notes]);

  const links = useMemoA(() => buildLinks(notesWithBody), [notesWithBody]);
  const workflowStates = window.MN_LOGSEQ?.WORKFLOW_STATES || [];
  const workflowData = useMemoA(
    () => collectWorkflowBlocks(notesWithBody, workflowStates, mnWalk),
    [notesWithBody, workflowStates, mnWalk]
  );

  const appStats = useMemoA(() => {
    let wordCount = 0, charCount = 0;
    notesWithBody.forEach(n => {
      const t = (n.body || '') + ' ' + (n.title || '');
      charCount += t.length;
      wordCount += t.trim().split(/\s+/).filter(Boolean).length;
    });
    return {
      noteCount: notesWithBody.length,
      tagCount: tags.length,
      linkCount: links.length,
      wordCount, charCount,
    };
  }, [notesWithBody, tags, links]);

  // SQLite-backed search: debounced IPC call returns matching IDs;
  // we intersect with in-memory notes for tag-filter compatibility.
  // searchHits = null  → no active query
  // searchHits = []    → query active but zero matches
  // searchHits = [...] → matched note ids in rank order
  const [searchHits, setSearchHits] = useStateA(null);
  useEffectA(() => {
    const q = query.trim();
    if (!q) { setSearchHits(null); return; }
    const activeVaultHasUnsaved = [...dirtyNotes.values()].some(vaultId => vaultId === activeVaultId);
    if (!HAS_DISK || !activeVaultId || activeVaultHasUnsaved) {
      // Browser fallback and dirty-note path: in-memory search reflects unsaved edits.
      const lc = q.toLowerCase();
      const ids = notesWithBody.filter(n =>
        n.title.toLowerCase().includes(lc) ||
        (n.body || '').toLowerCase().includes(lc) ||
        n.tags.some(t => t.toLowerCase().includes(lc))
      ).map(n => n.id);
      setSearchHits(ids);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.search(activeVaultId, q, 100);
        if (res.ok) setSearchHits(res.value.map(r => r.id));
      } catch (e) { console.error('search failed', e); }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, activeVaultId, notesWithBody, dirtyNotes]);

  const filteredNotes = useMemoA(() => {
    let ns = [...notesWithBody];
    if (selectedTag) ns = ns.filter(n => n.tags.includes(selectedTag));
    if (selectedWorkflow) {
      const ids = workflowData.noteIdsByState[selectedWorkflow] || new Set();
      ns = ns.filter(n => ids.has(n.id));
    }
    if (searchHits != null) {
      const order = new Map(searchHits.map((id, i) => [id, i]));
      ns = ns.filter(n => order.has(n.id));
      // Preserve search rank order when querying; otherwise default sort
      ns.sort((a, b) => order.get(a.id) - order.get(b.id));
      return ns;
    }
    ns.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.date) - new Date(a.date);
    });
    return ns;
  }, [notesWithBody, selectedTag, selectedWorkflow, workflowData, searchHits]);

  const workflowViewData = useMemoA(
    () => collectWorkflowBlocks(filteredNotes, workflowStates, mnWalk),
    [filteredNotes, workflowStates, mnWalk]
  );

  const selectedNote = notes.find(n => n.id === selectedId);
  const deleteTargetNote = deleteTargetId ? notes.find(n => n.id === deleteTargetId) : null;

  const createNote = useCallbackA(({ title = 'Untitled', body = '', tags: noteTags = [] } = {}) => {
    const id = 'n_' + Date.now().toString(36);
    const blocks = body ? mnMdToBlocks(body) : [mkBlock({ kind: 'paragraph', content: '' })];
    const newNote = {
      id, title, body, blocks, tags: noteTags,
      date: new Date().toISOString(),
    };
    setNotes(ns => [newNote, ...ns]);
    setSelectedId(id);
    navigateView('notes');
    markDirty(id);
    return id;
  }, [markDirty, navigateView]);

  const updateNote = (id, patch) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const resolved = typeof patch === 'function' ? patch(n) : patch;
      return { ...n, ...resolved };
    }));
    markDirty(id);
  };

  const updateNoteBlocks = useCallbackA((id, blocksOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const prevBlocks = n.blocks || [];
      const nextBlocks = window.MN_EDITOR_OPS.resolveBlocksChange(prevBlocks, blocksOrUpdater);
      return { ...n, blocks: nextBlocks };
    }));
    markDirty(id);
  }, [markDirty]);

  const toggleCheckFromAggregate = (it) => {
    const n = notes.find(x => x.id === it.noteId);
    if (!n) return;
    const target = it.text.trim();
    let changed = false;
    const walkMutate = (bs) => bs.map(b => {
      if (!changed && b.kind === 'todo' && b.content.trim() === target) {
        changed = true;
        return { ...b, checked: !b.checked, children: walkMutate(b.children) };
      }
      return { ...b, children: walkMutate(b.children) };
    });
    updateNote(it.noteId, { blocks: walkMutate(n.blocks || []) });
  };

  const updateWorkflowBlockState = useCallbackA((noteId, blockId, workflow) => {
    const n = notes.find(x => x.id === noteId);
    if (!n) return;
    const nextBlocks = mnCloneBlocks(n.blocks || []);
    const loc = mnLocate(nextBlocks, blockId);
    if (!loc) return;
    loc.block.workflow = workflow;
    updateNote(noteId, { blocks: nextBlocks });
  }, [notes, mnCloneBlocks, mnLocate]);

  const updateNoteTags = useCallbackA((noteId, noteTags) => {
    updateNote(noteId, { tags: noteTags });
  }, [updateNote]);

  const normalizeTagName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');

  const addTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean) return null;
    if (tags.find(t => t.name === clean)) return clean;
    const hue = (Math.floor(Math.random() * 12) * 30) + 10;
    setTags(ts => ts.find(t => t.name === clean) ? ts : [...ts, { name: clean, hue }]);
    markTagsDirty();
    return clean;
  };

  const promptNewTag = (name) => {
    const raw = typeof name === 'string' ? name : window.prompt('New tag name (no spaces):', '');
    if (raw) addTag(raw);
  };

  const requestDeleteNote = (id) => {
    if (!notes.find(x => x.id === id)) return;
    setDeleteTargetId(id);
  };

  const deleteNote = async (id) => {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    setDeleteTargetId(null);
    setDirtyNotes(cur => {
      if (!cur.has(id)) return cur;
      const next = new Map(cur);
      next.delete(id);
      return next;
    });
    setNotes(ns => ns.filter(x => x.id !== id));
    const rest = notes.filter(x => x.id !== id);
    setSelectedId(rest[0]?.id || null);
    if (HAS_DISK && activeVaultId) {
      try { await window.mn.deleteNote(activeVaultId, id); }
      catch (e) { console.error('deleteNote failed', e); }
    }
  };

  useEffectA(() => {
    const h = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key || '';
      const lowerKey = key.toLowerCase();
      const isBackslashKey = key === '\\' || key === '|' || e.code === 'Backslash';
      if (isMod && e.shiftKey && lowerKey === 'n') {
        e.preventDefault(); setCaptureOpen(true);
      } else if (isMod && lowerKey === 'n' && !e.shiftKey) {
        e.preventDefault(); createNote();
      } else if (isMod && lowerKey === 'g') {
        e.preventDefault();
        navigateView(view === 'graph' ? 'notes' : 'graph');
        setSelectedTag(null); setSelectedWorkflow(null);
      } else if (isMod && lowerKey === 'k') {
        e.preventDefault(); setAskAiOpen(v => !v);
      } else if (isMod && e.shiftKey && isBackslashKey) {
        e.preventDefault(); setNoteListHidden(v => !v);
      } else if (isMod && isBackslashKey && !e.shiftKey) {
        e.preventDefault(); setSidebarHidden(v => !v);
      } else if (e.key === 'Escape') {
        setSettingsOpen(false); setAskAiOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [createNote, view, navigateView]);

  // Reminder demo toast — only fire if the seeded errands note exists.
  useEffectA(() => {
    if (bootState !== 'ready') return;
    const n6 = notes.find(n => n.id === 'n6');
    if (!n6) return;
    const tm = setTimeout(() => {
      setToast({ noteId: n6.id, noteTitle: n6.title, text: 'Pick up prescription' });
    }, 2600);
    return () => clearTimeout(tm);
  }, [bootState]);

  // Push vault + selected note into the OS title bar
  useEffectA(() => {
    if (!HAS_DISK) return;
    const vname = vaults.find(v => v.id === activeVaultId)?.name;
    const nname = selectedNote?.title;
    const t = [vname, nname].filter(Boolean).join(' — ') || 'OminiNote';
    window.mn.setTitle(t === 'OminiNote' ? t : `${t} — OminiNote`);
  }, [activeVaultId, vaults, selectedNote]);

  const noteListVisible = view === 'notes' || view === 'graph' || view === 'workflow';
  const noteListTitle = query.trim()
    ? 'Search'
    : selectedTag
    ? `#${selectedTag}`
    : selectedWorkflow
    ? selectedWorkflow
    : (view === 'workflow' ? 'Workflow notes' : view === 'todos' ? 'Todos' : view === 'today' ? 'Today' : 'All notes');
  const noteListSubtitle = query.trim()
    ? `${filteredNotes.length} match${filteredNotes.length === 1 ? '' : 'es'}`
    : view === 'workflow'
    ? `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'} · ${workflowViewData.total} workflow item${workflowViewData.total === 1 ? '' : 's'}`
    : `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'}${selectedTag ? ' tagged' : selectedWorkflow ? ' with workflow' : ''}`;

  // ── Loading / error screens ─────────────────────────────────────────────
  if (bootState !== 'ready') {
    return <MnLaunchScreen state={bootState} error={bootError} T={T} />;
  }

  return (
    <div style={{
      width: `calc(100vw / ${appScale})`,
      height: `calc(100vh / ${appScale})`,
      background: T.bg, position: 'relative',
      fontFamily: 'var(--mn-ui)', overflow: 'hidden',
      fontSize: 'var(--mn-app-font-size)',
      transform: `scale(${appScale})`,
      transformOrigin: 'top left',
    }}>
        <div style={{ display: 'flex', height: '100%' }}>
          {!sidebarHidden && (
            <MnSidebar
              tags={tags} notes={notesWithBody}
              selectedTag={selectedTag}
              selectedWorkflow={selectedWorkflow}
              workflowStates={workflowStates}
              workflowCounts={workflowData.counts}
              workflowTotal={workflowData.total}
              onSelectTag={(t) => { setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes'); }}
              onSelectWorkflow={(wf) => { setSelectedWorkflow(wf); setSelectedTag(null); navigateView('notes'); }}
              onOpenWorkflowPanel={() => { navigateView('workflow'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenTodos={() => { navigateView('todos'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenToday={() => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenAskAI={HAS_DISK ? () => setAskAiOpen(true) : null}
              todayActive={view === 'today'}
              todosActive={view === 'todos'}
              graphActive={view === 'graph'}
              workflowActive={view === 'workflow'}
              onNewTag={promptNewTag}
              onNew={() => setCaptureOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onCollapse={() => setSidebarHidden(true)}
              vaults={vaultsForSidebar}
              activeVaultId={activeVaultId}
              onSelectVault={selectVault}
              onCreateVault={createVault}
              onRenameVault={renameVault}
              T={T} density={tweaks.density} theme={theme}
            />
          )}

          {!sidebarHidden && (
            <MnPanelGrip side="sidebar" onCollapse={() => setSidebarHidden(true)} T={T} />
          )}
          {sidebarHidden && (
            <MnPanelGripPeek onExpand={() => setSidebarHidden(false)} T={T} title="Show sidebar" />
          )}

          {noteListVisible && !noteListHidden && (
            <MnNoteList
              notes={filteredNotes}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                if (view === 'notes') return;
              }}
              title={noteListTitle}
              subtitle={noteListSubtitle}
              query={query}
              onQueryChange={setQuery}
              tags={tags} theme={theme} density={tweaks.density} T={T}
            />
          )}

          {noteListVisible && !noteListHidden && (
            <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
          )}
          {noteListVisible && noteListHidden && (
            <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show note list" />
          )}

          {view === 'notes' && selectedNote && (
            <MnEditor
              note={selectedNote} notes={notesWithBody} tags={tags} links={links}
              vaultId={activeVaultId}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onOpenTag={(t) => {
                if (!tags.find(x => x.name === t)) addTag(t);
                setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes');
              }}
              onBlocksChange={(blocks) => updateNoteBlocks(selectedNote.id, blocks)}
              onTitleChange={(title) => updateNote(selectedNote.id, { title })}
              onAddTag={(t) => updateNote(selectedNote.id, { tags: [...selectedNote.tags, t] })}
              onCreateTag={(raw) => {
                const name = addTag(raw);
                if (name && !selectedNote.tags.includes(name)) {
                  updateNote(selectedNote.id, { tags: [...selectedNote.tags, name] });
                }
              }}
              onRemoveTag={(t) => updateNote(selectedNote.id, { tags: selectedNote.tags.filter(x => x !== t) })}
              onPinToggle={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned })}
              onDelete={() => requestDeleteNote(selectedNote.id)}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onBack={goBackView}
              onToggleSidebar={() => setSidebarHidden(v => !v)}
              sidebarHidden={sidebarHidden}
              onToggleNoteList={() => setNoteListHidden(v => !v)}
              noteListHidden={noteListHidden}
              editorWidth={tweaks.editorWidth}
              fontSize={tweaks.fontSize}
              theme={theme} T={T}
            />
          )}

          {view === 'graph' && (
            <MnGraph
              notes={filteredNotes} links={links} tags={tags}
              focusId={selectedId}
              style={tweaks.graphStyle}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              T={T}
            />
          )}

          {view === 'todos' && (
            <MnTodosPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onToggleCheck={toggleCheckFromAggregate}
              T={T} theme={theme} variant={tweaks.todoVariant}
            />
          )}
          {view === 'workflow' && (
            <MnWorkflowPanel
              notes={notesWithBody}
              tags={tags}
              workflowStates={workflowStates}
              workflowItems={workflowViewData.byState}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onSetWorkflow={updateWorkflowBlockState}
              onSetNoteTags={updateNoteTags}
              T={T} theme={theme}
            />
          )}
          {view === 'today' && (
            <MnTodayPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              T={T} theme={theme}
            />
          )}
        </div>

        {captureOpen && (
          <MnQuickCapture
            tags={tags}
            onClose={() => setCaptureOpen(false)}
            onSave={({ title, body, tags: noteTags }) => {
              createNote({ title, body, tags: noteTags });
              setCaptureOpen(false);
            }}
            T={T} theme={theme}
          />
        )}
        <MnReminderToast
          toast={toast}
          onDismiss={() => setToast(null)}
          onOpen={(id) => { setSelectedId(id); navigateView('notes'); setToast(null); }}
          T={T} variant={tweaks.toastVariant}
        />

        {/* FAB */}
        <button onClick={() => setCaptureOpen(true)} title="Quick capture (⌘⇧N)"
          style={{
            position: 'absolute', bottom: 22, right: 22, zIndex: 20,
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            background: T.ink, color: T.bg, border: 'none',
            boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 30%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M8 3V13M3 8H13" strokeLinecap="round"/>
          </svg>
        </button>

        {settingsOpen && (
          <MnSettingsModal tweaks={tweaks} setTweak={setTweak} T={T}
            stats={appStats}
            onClose={() => setSettingsOpen(false)} />
        )}
        {deleteTargetNote && (
          <MnDeleteNoteDialog
            note={deleteTargetNote}
            T={T}
            onCancel={() => setDeleteTargetId(null)}
            onConfirm={() => deleteNote(deleteTargetNote.id)}
          />
        )}
        {askAiOpen && (
          <MnAskAI
            vaultId={activeVaultId}
            currentNote={selectedNote ? { ...selectedNote, body: mnBlocksToMd(selectedNote.blocks || []) } : null}
            allNotes={notesWithBody}
            onClose={() => setAskAiOpen(false)}
            onOpenNote={(id) => { setSelectedId(id); navigateView('notes'); }}
            onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] })}
            onApplyCurrentPageBody={(body) => {
              if (!selectedNote) return;
              updateNote(selectedNote.id, { body, blocks: mnMdToBlocks(body) });
            }}
            T={T} />
        )}
    </div>
  );
}

window.MnApp = MnApp;
