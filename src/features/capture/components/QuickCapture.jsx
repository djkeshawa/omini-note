import { DS_RADIUS } from '../../../shared/designSystem.js';
import { shortcutLabel, useShortcutPlatform } from '../../../platform/shortcuts.js';
import { mnGetTagBg, mnGetTagColor } from '../../../shared/theme.jsx';

const { useState: useStateP, useEffect: useEffectP, useRef: useRefP } = React;

function MnQuickCapture({ onSave, onClose, tags, destinations = [], templates = [], deriveTitle, T, theme }) {
  const shortcutPlatform = useShortcutPlatform();
  const [title, setTitle] = useStateP('');
  const [body, setBody] = useStateP('');
  const [selected, setSelected] = useStateP([]);
  const [destinationId, setDestinationId] = useStateP('today');
  const [templateId, setTemplateId] = useStateP('raw');
  const [moreOpen, setMoreOpen] = useStateP(false);
  const bodyRef = useRefP(null);
  const destinationChoices = destinations.length
    ? destinations
    : [{ id: 'new', label: 'New note', noteTitle: 'New note', disabled: false }];
  const templateChoices = [
    { id: 'raw', title: 'No template' },
    ...templates,
  ];
  const activeDestination = destinationChoices.find(item => item.id === destinationId && !item.disabled)
    || destinationChoices.find(item => !item.disabled)
    || destinationChoices[0];
  const activeTemplate = templateChoices.find(item => item.id === templateId) || templateChoices[0];
  const createsNewNote = activeDestination?.id === 'new';

  useEffectP(() => {
    const focusHandle = setTimeout(() => bodyRef.current?.focus(), 60);
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(focusHandle);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  const submit = () => {
    if (!title.trim() && !body.trim()) return onClose();
    const fallbackTitle = String(body || '').split('\n').map(line => line.trim()).find(Boolean) || 'Untitled';
    const inferredTitle = activeTemplate?.id === 'raw' ? (deriveTitle?.(body) || fallbackTitle) : '';
    onSave({
      title: createsNewNote ? (title.trim() || inferredTitle) : '',
      body,
      tags: selected,
      destinationId: activeDestination?.id || 'new',
      templateId: activeTemplate?.id === 'raw' ? '' : activeTemplate?.id,
    });
  };

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 40,
      background: `color-mix(in oklab, ${T.ink} 22%, transparent)`,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 100, animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Quick capture" onClick={(e) => e.stopPropagation()} style={{
        width: 560, maxWidth: '92%', background: T.bgElevated || T.bg, borderRadius: DS_RADIUS.panel,
        border: `1px solid ${T.line}`,
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 25%, transparent)`,
        overflow: 'hidden',
      }}>
        <div style={{
          height: 44, padding: '0 16px', boxSizing: 'border-box',
          borderBottom: `1px solid ${T.lineSub}`,
          display: 'flex', alignItems: 'center', gap: 9,
        }}>
          <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 650, color: T.ink }}>
            Quick capture
          </span>
          <span style={{ flex: 1 }} />
          {/* Say where it goes, rather than repeating the shortcut that opened it. */}
          <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim }}>
            Lands in the inbox tag
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <div id="mn-capture-options" style={{
            display: moreOpen ? 'grid' : 'none',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}>
            <select
              value={activeDestination?.id || 'new'}
              onChange={e => setDestinationId(e.target.value)}
              aria-label="Capture destination"
              style={{
                minWidth: 0,
                padding: '6px 8px',
                borderRadius: 6,
                border: `1px solid ${T.line}`,
                background: T.bg,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
              }}>
              {destinationChoices.map(item => (
                <option key={item.id} value={item.id} disabled={item.disabled}>
                  {item.label || item.noteTitle || item.id}
                </option>
              ))}
            </select>
            <select
              value={activeTemplate?.id || 'raw'}
              onChange={e => setTemplateId(e.target.value)}
              aria-label="Capture template"
              style={{
                minWidth: 0,
                padding: '6px 8px',
                borderRadius: 6,
                border: `1px solid ${T.line}`,
                background: T.bg,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
              }}>
              {templateChoices.map(item => (
                <option key={item.id} value={item.id}>
                  {item.title || item.id}
                </option>
              ))}
            </select>
          </div>
          {createsNewNote && (
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              aria-label="New note title"
              placeholder="Optional title"
              style={{
                width: '100%', border: 'none', outline: 'none', background: 'transparent',
                fontFamily: 'var(--mn-body)', fontSize: 18, fontWeight: 600,
                color: T.ink, letterSpacing: 0, marginBottom: 8,
              }}/>
          )}
          <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)}
            aria-label="Quick capture text"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Write it down now, file it later…"
            style={{
              width: '100%', minHeight: 132,
              fontFamily: 'var(--mn-body)', fontSize: 15, lineHeight: 1.6,
              color: T.ink, background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', padding: 0,
            }} />

          <button type="button" aria-expanded={moreOpen} aria-controls="mn-capture-options" onClick={() => setMoreOpen(value => !value)} style={{
            minHeight: 32, marginTop: 8, padding: '4px 0', border: 'none', background: 'transparent',
            color: T.inkDim, fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          }}>{moreOpen ? 'Hide options' : 'More options'}</button>

          <div style={{ display: moreOpen ? 'flex' : 'none', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
            {tags.map(t => {
              const on = selected.includes(t.name);
              return (
                <button key={t.name} type="button" aria-pressed={on}
                  onClick={() => setSelected(s => on ? s.filter(x => x !== t.name) : [...s, t.name])}
                  style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5,
                    padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    color: on ? mnGetTagColor(t.hue, theme) : T.inkDim,
                    background: on ? mnGetTagBg(t.hue, theme) : 'transparent',
                    border: `1px solid ${on ? 'transparent' : T.line}`,
                  }}>#{t.name}</button>
              );
            })}
          </div>
        </div>
        <div style={{
          padding: '10px 14px', borderTop: `1px solid ${T.lineSub}`,
          background: T.bgSub, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
          }}>{activeDestination?.label || 'New note'} · {activeTemplate?.title || 'No template'}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            minHeight: 36, padding: '6px 12px', borderRadius: 5,
            border: `1px solid ${T.line}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} style={{
            minHeight: 36, padding: '6px 14px', borderRadius: 5, border: 'none',
            background: T.ink, color: T.bg,
            fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>Save{activeDestination?.id === 'today' ? ' to Today' : ''}</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Reminder toast
// ────────────────────────────────────────────────────────────

export { MnQuickCapture };
