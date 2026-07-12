function ResponsiveListPane({ overlay, left = 0, label, returnFocusLabel, onDismiss, T, children }) {
  const paneRef = React.useRef(null);
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
  React.useEffect(() => {
    if (!overlay) return undefined;
    const focusHandle = requestAnimationFrame(() => {
      paneRef.current?.querySelector('input, [role="option"], button')?.focus?.();
    });
    const closeOnEscape = event => {
      if (event.key !== 'Escape' || !paneRef.current) return;
      const anotherModalIsOpen = [...document.querySelectorAll('[aria-modal="true"]')]
        .some(element => element !== paneRef.current && element.getClientRects().length > 0);
      if (anotherModalIsOpen) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      cancelAnimationFrame(focusHandle);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [overlay]);

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
