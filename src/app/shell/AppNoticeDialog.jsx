

function MnAppNoticeDialog({ notice, T, onClose }) {
  const closeRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    if (!notice) return;
    mountedRef.current = true;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => { if (mountedRef.current) closeRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [notice, onClose]);

  if (!notice) return null;
  const title = notice.title || 'Something went wrong';
  const message = notice.message || notice.error || 'The operation could not be completed.';

  return (
    <DsDialogShell
      className="mn-app-notice-dialog"
      role="alertdialog"
      tone={notice.tone === 'warn' ? 'warn' : 'danger'}
      titleId="mn-app-notice-title"
      title={title}
      consequence={(
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</span>
      )}
      width={400}
      zIndex={92}
      T={T}
      onDismiss={onClose}
      icon={(
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
          <path d="M8 2L14 13H2L8 2Z" strokeLinejoin="round"/>
          <path d="M8 6V9M8 11.7V11.8" strokeLinecap="round"/>
        </svg>
      )}
      actions={(
        <button ref={closeRef} onClick={onClose} style={dsButtonStyle(T, 'primary', { height: DS_HEIGHT.primary })}>
          OK
        </button>
      )}
    />
  );
}

export { MnAppNoticeDialog };
const { useEffect: useEffectA, useRef: useRefA } = React;
import { DS_HEIGHT, dsButtonStyle } from '../../shared/designSystem.js';
import { DsDialogShell } from '../../shared/components/DesignPrimitives.jsx';
