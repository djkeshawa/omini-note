import { TaskCheckbox } from '../../shared/TaskCheckbox.jsx';

function MnBlockMarker({ model }) {
  const { block, displayBlock, fontStyle, hasChildren, indentPx, mnAffordancePadTop, mnGripPadTop, onContextMenu, onToggleCheck, onZoom, T } = model;
  return (
    <div
      title="Drag to move · Click to zoom · Right-click for menu"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/mn-block', block.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (onContextMenu) onContextMenu(block.id, e.clientX, e.clientY);
      }}
      onClick={(e) => {
        // Click on bullet (not drag) zooms into the block.
        // Only fire on plain left click without modifiers.
        if (e.button === 0 && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
          if (onZoom) { e.stopPropagation(); onZoom(block.id); }
        }
      }}
      style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: mnAffordancePadTop(displayBlock),
        // A list marker is content — a bullet, a number, a checkbox — and
        // earns its indent. For heading, paragraph, quote and code this
        // slot holds only the hover-revealed grip, so it joins the
        // disclosure in the gutter and prose starts where the title does.
        ...(['todo', 'ordered', 'bullet'].includes(block.kind)
          ? { marginRight: block.kind === 'todo' ? 2 : 8, minWidth: block.kind === 'todo' ? 24 : 18 }
          : { position: 'absolute', left: indentPx - 36, top: 0, marginRight: 0, minWidth: 18 }),
        cursor: 'grab',
      }}>
      {block.kind === 'todo' ? (
        <TaskCheckbox
          checked={block.checked}
          label={block.checked ? 'Reopen todo' : 'Complete todo'}
          onToggle={() => onToggleCheck(block.id)}
          T={T}
          style={{ marginTop: Math.max(0, (Number(fontStyle.fontSize) * (fontStyle.lineHeight || 1.55) + 2 - 24) / 2) }}
        />
      ) : block.kind === 'ordered' ? (
        <span style={{
          minWidth: 18,
          color: T.inkMed,
          fontFamily: 'var(--mn-mono)',
          fontSize: 11.5,
          lineHeight: '14px',
          textAlign: 'right',
        }}>
          {Math.max(1, Number(block.listNumber) || 1)}{block.listDelimiter === ')' ? ')' : '.'}
        </span>
      ) : block.kind === 'bullet' ? (
        // Real bullet — a small filled dot. Becomes filled-with-halo when collapsed.
        <span style={{
          width: 14, height: 14, borderRadius: '50%',
          background: hasChildren && block.collapsed ? T.bgActive : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: 0,
          transition: 'background 120ms',
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: T.ink,
          }} />
        </span>
      ) : block.kind === 'divider' ? (
        <span style={{ width: 0 }} />
      ) : (
        // Heading, paragraph, quote, code — no visible dot in default state.
        // Hover-revealed 6-dot grip handle for drag + zoom + right-click context.
        <span className="mn-grip" style={{
          width: 14, height: 14, borderRadius: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: mnGripPadTop(displayBlock),
          opacity: 0,
          transition: 'opacity 100ms, background 100ms',
          color: T.inkDim,
        }}>
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="3"  r="1"/>
            <circle cx="7.5" cy="3"  r="1"/>
            <circle cx="2.5" cy="7"  r="1"/>
            <circle cx="7.5" cy="7"  r="1"/>
            <circle cx="2.5" cy="11" r="1"/>
            <circle cx="7.5" cy="11" r="1"/>
          </svg>
        </span>
      )}
    </div>
  );
}

export { MnBlockMarker };
