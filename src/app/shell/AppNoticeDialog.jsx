

// Every notice used to render as a red danger alertdialog, so "Backup
// exported" and "Index rebuilt" read as failures. Tone now follows what
// actually happened, and the role follows the tone.
const NOTICE_TONE = { warn: 'warn', info: 'accent', success: 'success', error: 'danger' };
const NOTICE_ICON = {
  success: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
      <circle cx="8" cy="8" r="5.5"/>
      <path d="M5.5 8.2L7.2 10L10.5 6.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  accent: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
      <circle cx="8" cy="8" r="5.5"/>
      <path d="M8 7V11M8 5V5.01" strokeLinecap="round"/>
    </svg>
  ),
};
const NOTICE_WARNING_ICON = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
    <path d="M8 2L14 13H2L8 2Z" strokeLinejoin="round"/>
    <path d="M8 6V9M8 11.7V11.8" strokeLinecap="round"/>
  </svg>
);

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
  const tone = NOTICE_TONE[notice.tone] || 'danger';
  const interrupts = tone === 'warn' || tone === 'danger';

  return (
    <DsDialogShell
      className="mn-app-notice-dialog"
      role={interrupts ? 'alertdialog' : 'dialog'}
      tone={tone}
      titleId="mn-app-notice-title"
      title={title}
      consequence={(
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</span>
      )}
      width={400}
      zIndex={92}
      T={T}
      onDismiss={onClose}
      icon={NOTICE_ICON[tone] || NOTICE_WARNING_ICON}
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
