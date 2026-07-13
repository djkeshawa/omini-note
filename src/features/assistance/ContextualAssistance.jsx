import { platformApi } from '../../platform/index.js';
import assistanceModel from './contextualAssistanceModel.js';

const { useCallback, useEffect, useRef, useState } = React;

function ContextualAssistance({ enabled, note, sourceMarkdown, vaultId, onCreateOutput, T }) {
  const [busyAction, setBusyAction] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const actionFocusRef = useRef(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    requestRef.current += 1;
    setBusyAction('');
    setPreview(null);
    setError('');
    actionFocusRef.current = null;
    restoreFocusRef.current = false;
  }, [note?.id]);

  useEffect(() => {
    if (preview || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    actionFocusRef.current?.focus?.();
  }, [preview]);

  const closePreview = useCallback(() => {
    restoreFocusRef.current = true;
    setPreview(null);
  }, []);

  if (!enabled || !note?.id || !String(sourceMarkdown || '').trim()) return null;

  const generate = async (action, trigger) => {
    if (busyAction) return;
    actionFocusRef.current = trigger || null;
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
      if (requestId === requestRef.current) setPreview(output);
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

  return (
    <section data-mn-contextual-assistance="true" aria-label="Work with this note" style={{
      margin: '12px 0 18px', padding: '10px 11px',
      border: `1px solid ${T.lineSub}`, borderRadius: 9,
      background: `color-mix(in oklab, ${T.accentSoft} 45%, ${T.bg})`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 720, color: T.ink }}>Work with this note</span>
        <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim }}>Preview first, then save as a linked note.</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {assistanceModel.ACTIONS.map(action => (
          <button
            key={action.id}
            type="button"
            aria-label={`${action.label} from ${note.title || 'this note'}`}
            title={action.description}
            disabled={!!busyAction}
            onClick={event => generate(action, event.currentTarget)}
            style={{
              minHeight: 36, padding: '6px 10px', borderRadius: 7,
              border: `1px solid ${busyAction === action.id ? T.accent : T.lineSub}`,
              background: busyAction === action.id ? T.accentSoft : T.bg,
              color: busyAction === action.id ? T.accent : T.inkMed,
              cursor: busyAction ? 'wait' : 'pointer',
              fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 650,
            }}>
            {busyAction === action.id ? 'Preparing…' : action.label}
          </button>
        ))}
      </div>
      {error && <div role="alert" style={{ marginTop: 8, color: T.danger || T.warn, fontSize: 12 }}>{error}</div>}
      {preview && (
        <AssistancePreviewDialog
          output={preview}
          onApply={apply}
          onClose={closePreview}
          T={T}
        />
      )}
    </section>
  );
}

function AssistancePreviewDialog({ output, onApply, onClose, T }) {
  const applyRef = useRef(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    applyRef.current?.focus?.();
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 280, padding: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 36%, transparent)',
    }}>
      <section
        ref={dialogRef}
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
