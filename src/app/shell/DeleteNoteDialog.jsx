

function MnDeleteNoteDialog({ note, T, onCancel, onConfirm }) {
  const cancelRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    mountedRef.current = true;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => { if (mountedRef.current) cancelRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  if (!note) return null;
  const blockCount = mnFlatten(note.blocks || [], 0, false).length;
  const tagText = (note.tags || []).length
    ? (note.tags || []).map(t => `#${t}`).join(' ')
    : 'No tags';

  return (
    <DsDialogShell
      className="mn-delete-note-dialog"
      tone="danger"
      titleId="mn-delete-note-title"
      title="Delete note?"
      consequence="It moves to Recently deleted and is removed from disk after 30 days."
      T={T}
      onDismiss={onCancel}
      icon={(
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
          <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
        </svg>
      )}
      actions={(
        <>
          <button ref={cancelRef} onClick={onCancel} style={dsButtonStyle(T, 'default', { height: DS_HEIGHT.primary })}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...dsButtonStyle(T, 'danger', { height: DS_HEIGHT.primary }),
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Move to trash
          </button>
        </>
      )}>
      <DsSubjectCard
        T={T}
        title={note.title || 'Untitled'}
        meta={(
          <>
            <span>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: T.line }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagText}</span>
          </>
        )}
      />
    </DsDialogShell>
  );
}

export { MnDeleteNoteDialog };
import { mnFlatten } from '../../editor/outline.jsx';
import { DS_HEIGHT, dsButtonStyle } from '../../shared/designSystem.js';
import { DsDialogShell, DsSubjectCard } from '../../shared/components/DesignPrimitives.jsx';
const { useEffect: useEffectA, useRef: useRefA } = React;
