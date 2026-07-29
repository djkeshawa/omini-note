const { useEffect, useRef, useState } = React;

function useViewsDropdownMenu(onDismiss) {
  const [openMenu, setOpenMenu] = useState('');
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const closeMenu = () => {
    setOpenMenu('');
    onDismissRef.current?.();
  };

  const toggleMenu = (name) => {
    onDismissRef.current?.();
    setOpenMenu(current => (current === name ? '' : name));
  };

  useEffect(() => {
    if (!openMenu) return undefined;
    const onPointerDown = (event) => {
      if (event.target?.closest?.('[data-mn-views-dropdown-root="true"]')) return;
      setOpenMenu('');
      onDismissRef.current?.();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      const trigger = document.querySelector(`[data-mn-views-dropdown-trigger="${openMenu}"]`);
      event.preventDefault();
      setOpenMenu('');
      onDismissRef.current?.();
      window.requestAnimationFrame(() => trigger?.focus?.());
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [openMenu]);

  return { openMenu, closeMenu, toggleMenu };
}

export { useViewsDropdownMenu };
