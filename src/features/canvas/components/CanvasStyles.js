
import { dsGroupLabelStyle } from '../../../shared/designSystem.js';

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

function mnCanvasIconButton(T) {
  return {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
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

function mnCanvasToolbarGroup(T) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 8,
    background: `color-mix(in oklab, ${T.bg} 78%, ${T.bgSub})`,
    flexShrink: 0,
  };
}

function mnCanvasToolbarShelf() {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '7px 18px 10px',
    overflow: 'visible',
  };
}

function mnCanvasToolbarRow() {
  return {
    minHeight: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: '0 1 auto',
    minWidth: 0,
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
    top: 38,
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

export { mnCanvasPrimaryButton, mnCanvasIconButton, mnCanvasToolButton, mnCanvasIconToolButton, mnCanvasToolbarGroup, mnCanvasToolbarShelf, mnCanvasToolbarRow, mnCanvasToolbarMoreSlot, mnCanvasMoreMenu, mnCanvasMoreMenuSection, mnCanvasMoreMenuLabel, mnCanvasMoreMenuGrid, mnCanvasStageBackground, mnCanvasDialogButton };
