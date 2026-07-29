import { platformApi } from '../../platform/index.js';
import { useDialogFocus } from '../../shared/useDialogFocus.js';
import assistanceModel from './contextualAssistanceModel.js';

const { useCallback, useEffect, useRef, useState } = React;
const ASSISTANCE_POPOVER_ID = 'mn-contextual-assistance-popover';

function ContextualAssistance({ enabled, note, sourceMarkdown, vaultId, onCreateOutput, T }) {
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const firstActionRef = useRef(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    requestRef.current += 1;
    setOpen(false);
    setBusyAction('');
    setPreview(null);
    setError('');
    restoreFocusRef.current = false;
  }, [note?.id]);

  useEffect(() => {
    if (!open) return undefined;
    firstActionRef.current?.focus?.();
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus?.();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open]);

  useEffect(() => {
    if (preview || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus?.();
  }, [preview]);

  const closePreview = useCallback(() => {
    restoreFocusRef.current = true;
    setPreview(null);
  }, []);

  if (!enabled || !note?.id || !String(sourceMarkdown || '').trim()) return null;

  const generate = async (action) => {
    if (busyAction) return;
    const requestId = ++requestRef.current;
    setBusyAction(action.id);
    setError('');
    try {
      if (!platformApi.ai?.edit) throw new Error('Assistance is unavailable in this build.');
      const response = await platformApi.ai.edit({
        text: String(sourceMarkdown || ''),
        instruction: action.instruction,
        scope: 'selected note',
        vaultId,
      });
      if (!response?.ok) throw new Error(response?.error || 'Assistance failed.');
      if (response.value && response.value.ok === false) throw new Error(response.value.error || 'Assistance failed.');
      const output = assistanceModel.buildOutput({
        actionId: action.id,
        sourceNote: note,
        text: response.value?.text,
      });
      if (requestId === requestRef.current) {
        setPreview(output);
        setOpen(false);
      }
    } catch (nextError) {
      if (requestId === requestRef.current) setError(nextError.message || String(nextError));
    } finally {
      if (requestId === requestRef.current) setBusyAction('');
    }
  };

  const apply = () => {
    if (!preview || !onCreateOutput) return;
    const created = onCreateOutput(preview);
    if (created !== false) setPreview(null);
  };

  const handleActionKeyDown = event => {
    const key = event.key === 'Down' ? 'ArrowDown' : event.key === 'Up' ? 'ArrowUp' : event.key;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
    const actions = [...event.currentTarget.querySelectorAll('[data-mn-assistance-action="true"]:not([disabled])')];
    if (!actions.length) return;
    event.preventDefault();
    const currentIndex = actions.indexOf(document.activeElement);
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? actions.length - 1
        : key === 'ArrowUp'
          ? (currentIndex <= 0 ? actions.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % actions.length;
    actions[nextIndex]?.focus?.();
  };

  const activeAction = assistanceModel.actionById(busyAction);
  const triggerLabel = busyAction
    ? `Preparing ${activeAction?.label || 'AI output'} from ${note.title || 'this note'}`
    : error ? 'Work with this note — last action failed' : 'Work with this note';

  return (
    <div
      ref={rootRef}
      data-mn-contextual-assistance="true"
      onBlur={event => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        className="mn-contextual-assistance-trigger"
        aria-controls={ASSISTANCE_POPOVER_ID}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        aria-busy={!!busyAction}
        title={error ? `Work with this note — ${error}` : 'Work with this note'}
        onClick={() => setOpen(value => !value)}
        style={{
          width: 32, minWidth: 32, minHeight: 32, padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          border: `1px solid ${error ? (T.danger || T.warn) : (open || busyAction ? (T.selLine || T.accent) : 'transparent')}`,
          borderRadius: 7,
          background: open || busyAction ? T.accentSoft : 'transparent',
          color: error ? (T.danger || T.warn) : (open || busyAction ? T.accent : T.inkMed),
          cursor: busyAction ? 'wait' : 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 650,
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={event => {
          if (!open && !busyAction) event.currentTarget.style.background = T.bgHover;
        }}
        onMouseLeave={event => {
          if (!open && !busyAction) event.currentTarget.style.background = 'transparent';
        }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
          <path d="M7.7 1.5c.35 2.45 1.68 3.78 4.13 4.13-2.45.35-3.78 1.68-4.13 4.13-.35-2.45-1.68-3.78-4.13-4.13C6.02 5.28 7.35 3.95 7.7 1.5Z" strokeLinejoin="round" />
          <path d="M12.35 9.2c.18 1.28.88 1.98 2.15 2.16-1.27.18-1.97.88-2.15 2.14-.18-1.26-.88-1.96-2.15-2.14 1.27-.18 1.97-.88 2.15-2.16Z" strokeLinejoin="round" />
        </svg>
        <span className="mn-contextual-assistance-trigger-label">{busyAction ? 'Working…' : 'Assist'}</span>
        {error && <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: T.danger || T.warn }} />}
      </button>
      {open && (
        <div
          id={ASSISTANCE_POPOVER_ID}
          data-mn-contextual-assistance-popover="true"
          role="dialog"
          aria-label="Work with this note"
          onKeyDown={handleActionKeyDown}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 90,
            width: 'min(320px, calc(100vw - 32px))', padding: 7,
            border: `1px solid ${T.line}`, borderRadius: 10,
            background: T.bg, color: T.ink,
            boxShadow: `0 16px 42px color-mix(in oklab, ${T.ink} 22%, transparent)`,
          }}>
          <div style={{ padding: '7px 8px 9px' }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 720, color: T.ink }}>Work with this note</div>
            <div style={{ marginTop: 3, fontFamily: 'var(--mn-body)', fontSize: 11.5, lineHeight: 1.4, color: T.inkDim }}>
              Create a linked note after reviewing the result.
            </div>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {assistanceModel.ACTIONS.map((action, index) => (
              <button
                ref={index === 0 ? firstActionRef : undefined}
                key={action.id}
                type="button"
                data-mn-assistance-action="true"
                aria-label={`${action.label} from ${note.title || 'this note'}`}
                aria-disabled={!!busyAction}
                disabled={!!busyAction && busyAction !== action.id}
                onClick={() => generate(action)}
                style={{
                  width: '100%', minHeight: 48, padding: '7px 9px', borderRadius: 7,
                  display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', columnGap: 10,
                  border: `1px solid ${busyAction === action.id ? T.accent : 'transparent'}`,
                  background: busyAction === action.id ? T.accentSoft : 'transparent',
                  color: busyAction === action.id ? T.accent : T.inkMed,
                  cursor: busyAction ? 'wait' : 'pointer', textAlign: 'left',
                  fontFamily: 'var(--mn-ui)',
                }}
                onMouseEnter={event => {
                  if (!busyAction) event.currentTarget.style.background = T.bgHover;
                }}
                onMouseLeave={event => {
                  if (!busyAction) event.currentTarget.style.background = 'transparent';
                }}>
                <span>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 680, color: 'inherit' }}>{action.label}</span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 10.75, lineHeight: 1.35, color: T.inkDim }}>{action.description}</span>
                </span>
                <span aria-hidden="true" style={{ fontSize: 13, color: busyAction === action.id ? T.accent : T.inkDim }}>
                  {busyAction === action.id ? '…' : '›'}
                </span>
              </button>
            ))}
          </div>
          {error && <div role="alert" style={{ margin: '7px 8px 5px', color: T.danger || T.warn, fontSize: 11.5, lineHeight: 1.4 }}>{error}</div>}
        </div>
      )}
      {preview && (
        <AssistancePreviewDialog
          output={preview}
          onApply={apply}
          onClose={closePreview}
          T={T}
        />
      )}
    </div>
  );
}

function AssistancePreviewDialog({ output, onApply, onClose, T }) {
  const applyRef = useRef(null);
  const dialogRef = useDialogFocus({ initialFocusRef: applyRef, onEscape: onClose });

  return (
    <div onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 280, padding: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 36%, transparent)',
    }}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-assistance-preview-title"
        style={{
          width: 'min(720px, 100%)', maxHeight: '86vh', overflow: 'auto',
          border: `1px solid ${T.line}`, borderRadius: 11,
          background: T.bg, color: T.ink,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 28%, transparent)`,
        }}>
        <div style={{ padding: '15px 17px', borderBottom: `1px solid ${T.lineSub}` }}>
          <div id="mn-assistance-preview-title" style={{ fontSize: 16, fontWeight: 740 }}>Preview linked note</div>
          <div style={{ marginTop: 4, fontSize: 12, color: T.inkDim }}>Source: {output.source.title}</div>
        </div>
        <div style={{ padding: 17 }}>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 18, fontWeight: 650, marginBottom: 10 }}>{output.title}</div>
          <pre style={{
            margin: 0, padding: 13, border: `1px solid ${T.lineSub}`, borderRadius: 8,
            background: T.bgSub, color: T.inkMed, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.55,
          }}>{output.body}</pre>
        </div>
        <div style={{ padding: '12px 17px', borderTop: `1px solid ${T.lineSub}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={dialogButton(T)}>Cancel</button>
          <button ref={applyRef} type="button" onClick={onApply} style={dialogButton(T, true)}>Create linked note</button>
        </div>
      </section>
    </div>
  );
}

function dialogButton(T, primary = false) {
  return {
    minHeight: 38, padding: '7px 12px', borderRadius: 7,
    border: `1px solid ${primary ? T.ink : T.lineSub}`,
    background: primary ? T.ink : T.bg,
    color: primary ? T.bg : T.inkMed,
    cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 650,
  };
}

export { ContextualAssistance };
