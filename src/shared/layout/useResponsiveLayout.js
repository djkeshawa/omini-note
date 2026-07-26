const DESKTOP_THREE_PANE_MIN_WIDTH = 1200;
// The connections rail is a fourth column. It only earns its 292px once the
// prose column can still hold its measure beside it; below this the rail
// collapses back to the accordion under the note.
const CONNECTIONS_RAIL_MIN_WIDTH = 1360;

function usesOverlayNoteList(width) {
  const numericWidth = Number(width);
  return Number.isFinite(numericWidth) && numericWidth < DESKTOP_THREE_PANE_MIN_WIDTH;
}

function fitsConnectionsRail(width) {
  const numericWidth = Number(width);
  return Number.isFinite(numericWidth) && numericWidth >= CONNECTIONS_RAIL_MIN_WIDTH;
}

function currentViewportWidth() {
  return typeof window === 'undefined' ? DESKTOP_THREE_PANE_MIN_WIDTH : window.innerWidth;
}

function useResponsiveLayout() {
  const read = () => {
    const width = currentViewportWidth();
    return { overlayNoteList: usesOverlayNoteList(width), connectionsRail: fitsConnectionsRail(width) };
  };
  const [layout, setLayout] = React.useState(read);

  React.useEffect(() => {
    const update = () => setLayout(current => {
      const next = read();
      return current.overlayNoteList === next.overlayNoteList && current.connectionsRail === next.connectionsRail
        ? current
        : next;
    });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    update();
    observer?.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return layout;
}

export {
  CONNECTIONS_RAIL_MIN_WIDTH,
  DESKTOP_THREE_PANE_MIN_WIDTH,
  fitsConnectionsRail,
  useResponsiveLayout,
  usesOverlayNoteList,
};
