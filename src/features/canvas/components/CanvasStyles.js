
import { DS_HEIGHT, DS_RADIUS, dsGroupLabelStyle } from '../../../shared/designSystem.js';

// The header's own icon button. The prototype draws these at 28x28 radius 8
// (prototype.html:750, :760), which is DS_HEIGHT.toolbar and DS_RADIUS.control.
// It is separate from mnCanvasIconToolButton because that one also sizes the
// More menu's 31px action grid, which the prototype does not model.
function mnCanvasHeaderButton(T) {
  return {
    width: DS_HEIGHT.toolbar,
    height: DS_HEIGHT.toolbar,
    borderRadius: DS_RADIUS.control,
    border: '1px solid transparent',
    background: 'transparent',
    color: T.inkMed,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
}

function mnCanvasPrimaryButton(T) {
  return {
    border: 'none',
    background: T.ink,
    color: T.bg,
    borderRadius: 6,
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
    boxShadow: `0 8px 18px color-mix(in oklab, ${T.ink} 14%, transparent)`,
  };
}

function mnCanvasToolButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    padding: '5px 8px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
  };
}

function mnCanvasIconToolButton(T) {
  return {
    width: 31,
    height: 31,
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    padding: 0,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function mnCanvasToolbarMoreSlot() {
  return {
    position: 'relative',
    display: 'inline-flex',
    flex: '0 0 auto',
  };
}

function mnCanvasMoreMenu(T) {
  return {
    position: 'absolute',
    top: 35,
    right: 0,
    zIndex: 30,
    width: 238,
    display: 'grid',
    gap: 8,
    padding: 10,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 8,
    background: T.bg,
    boxShadow: '0 16px 38px rgba(15, 23, 42, 0.16)',
  };
}

function mnCanvasMoreMenuSection(T) {
  return {
    display: 'grid',
    gap: 6,
    paddingBottom: 8,
    borderBottom: `1px solid ${T.lineSub}`,
  };
}

function mnCanvasMoreMenuLabel(T) {
  return dsGroupLabelStyle(T);
}

function mnCanvasMoreMenuGrid() {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 31px)',
    gap: 6,
  };
}

function mnCanvasStageBackground(T, size = 28) {
  const lineAt = Math.max(1, size - 1);
  return `repeating-linear-gradient(0deg, transparent 0 ${lineAt}px, ${T.lineSub} ${lineAt}px ${size}px), repeating-linear-gradient(90deg, transparent 0 ${lineAt}px, ${T.lineSub} ${lineAt}px ${size}px), ${T.bgSub}`;
}

function mnCanvasDialogButton(T) {
  return {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
    background: T.bg,
    color: T.inkMed,
    border: `1px solid ${T.line}`,
  };
}

export { mnCanvasPrimaryButton, mnCanvasHeaderButton, mnCanvasToolButton, mnCanvasIconToolButton, mnCanvasToolbarMoreSlot, mnCanvasMoreMenu, mnCanvasMoreMenuSection, mnCanvasMoreMenuLabel, mnCanvasMoreMenuGrid, mnCanvasStageBackground, mnCanvasDialogButton };
