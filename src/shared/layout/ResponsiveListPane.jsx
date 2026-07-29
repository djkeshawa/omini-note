import { useDialogFocus } from '../useDialogFocus.js';

function ResponsiveListPane({ overlay, left = 0, label, returnFocusLabel, onDismiss, T, children }) {
  const dismissRef = React.useRef(onDismiss);
  const returnFocusLabelRef = React.useRef(returnFocusLabel);
  dismissRef.current = onDismiss;
  returnFocusLabelRef.current = returnFocusLabel;
  const dismiss = () => {
    dismissRef.current?.();
    const started = performance.now();
    const focusWhenReady = () => {
      const target = [...document.querySelectorAll('button[aria-label]')]
        .find(button => button.getAttribute('aria-label') === returnFocusLabelRef.current);
      if (target) {
        target.focus();
        return;
      }
      if (performance.now() - started < 500) setTimeout(focusWhenReady, 16);
    };
    setTimeout(focusWhenReady, 0);
  };
  const paneRef = useDialogFocus({ active: overlay, onEscape: dismiss });

  if (!overlay) return <>{children}</>;
  return (
    <>
      <div
        aria-hidden="true"
        data-mn-note-list-backdrop="true"
        onClick={dismiss}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left,
          zIndex: 34,
          background: `color-mix(in oklab, ${T.ink} 13%, transparent)`,
        }}
      />
      <div
        ref={paneRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-mn-note-list-mode="overlay"
        style={{
          position: 'absolute', top: 0, bottom: 0, left,
          zIndex: 35,
          display: 'flex',
          maxWidth: `calc(100vw - ${left}px)`,
          boxShadow: `12px 0 34px color-mix(in oklab, ${T.ink} 24%, transparent)`,
        }}>
        {children}
      </div>
    </>
  );
}

export { ResponsiveListPane };
