const DESKTOP_THREE_PANE_MIN_WIDTH = 1200;

function usesOverlayNoteList(width) {
  const numericWidth = Number(width);
  return Number.isFinite(numericWidth) && numericWidth < DESKTOP_THREE_PANE_MIN_WIDTH;
}

function currentViewportWidth() {
  return typeof window === 'undefined' ? DESKTOP_THREE_PANE_MIN_WIDTH : window.innerWidth;
}

function useResponsiveLayout() {
  const [overlayNoteList, setOverlayNoteList] = React.useState(() => usesOverlayNoteList(currentViewportWidth()));

  React.useEffect(() => {
    const update = () => setOverlayNoteList(usesOverlayNoteList(currentViewportWidth()));
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    update();
    observer?.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return { overlayNoteList };
}

export { DESKTOP_THREE_PANE_MIN_WIDTH, useResponsiveLayout, usesOverlayNoteList };
