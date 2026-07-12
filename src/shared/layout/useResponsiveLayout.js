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
    const query = window.matchMedia(`(max-width: ${DESKTOP_THREE_PANE_MIN_WIDTH - 1}px)`);
    const update = () => setOverlayNoteList(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return { overlayNoteList };
}

export { DESKTOP_THREE_PANE_MIN_WIDTH, useResponsiveLayout, usesOverlayNoteList };
