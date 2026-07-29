const { useEffect, useRef } = React;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusableElements(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter(element => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && element.getClientRects().length > 0
    ));
}

function isTopmostModal(dialog) {
  const modals = [...document.querySelectorAll('[aria-modal="true"]')]
    .filter(element => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && element.getClientRects().length > 0
    ));
  return modals[modals.length - 1] === dialog;
}

function useDialogFocus({ active = true, initialFocusRef = null, onEscape = null } = {}) {
  const dialogRef = useRef(null);
  const initialRef = useRef(initialFocusRef);
  const escapeRef = useRef(onEscape);
  initialRef.current = initialFocusRef;
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const focusHandle = setTimeout(() => {
      const first = visibleFocusableElements(dialog)[0];
      (initialRef.current?.current || first || dialog).focus?.();
    }, 0);
    const onKeyDown = (event) => {
      if (!isTopmostModal(dialog)) return;
      if (event.key === 'Escape' && typeof escapeRef.current === 'function') {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = visibleFocusableElements(dialog);
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(focusHandle);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, [active]);

  return dialogRef;
}

export { FOCUSABLE_SELECTOR, useDialogFocus, visibleFocusableElements };
