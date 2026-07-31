// Whether this block's rendered output can depend on OTHER notes' content.
//
// Embeds ({{embed ...}}, {{SMART-VIEW ...}}), block refs ((id)) and the
// novelist plot-points block all pull live data out of allNotes when they
// draw, so they must re-render when the vault changes. A plain [[wiki link]]
// does not — it renders its own label and resolves the target on click.
//
// Everything else only reads its own block, so it can ignore allNotes churn.
// That churn is constant: notesWithBody returns a fresh array identity on
// every keystroke, and comparing it by identity made typing one character
// re-render every block in the note.
export function blockReadsOtherNotes(block) {
  if (!block) return false;
  if (block.kind === 'plot-points') return true;
  const content = String(block.content || '');
  return content.includes('((') || content.includes('{{');
}

export function blockRowMemoEqual(prev, next) {
  return prev.block === next.block &&
    prev.depth === next.depth &&
    prev.focusId === next.focusId &&
    prev.T === next.T &&
    // A content edit that introduces an embed or a ref changes the block's
    // identity, so the first comparison above already forces that render —
    // this gate only decides whether vault-wide churn matters to this block.
    // The row being edited re-renders from its own state with fresh props,
    // so the [[ autocomplete never sees a stale note list either.
    (prev.allNotes === next.allNotes || !blockReadsOtherNotes(next.block)) &&
    prev.allCanvases === next.allCanvases &&
    prev.vaultId === next.vaultId &&
    prev.aiEnabled === next.aiEnabled &&
    prev.aiPreview === next.aiPreview &&
    prev.aiTarget === next.aiTarget &&
    prev.selectedBlockIds === next.selectedBlockIds &&
    prev.editorFontSize === next.editorFontSize &&
    prev.indentGuides === next.indentGuides &&
    prev.spellCheck === next.spellCheck &&
    prev.autoLink === next.autoLink &&
    prev.collapseByDefault === next.collapseByDefault &&
    prev.novelistMode === next.novelistMode &&
    prev.workflowEnabled === next.workflowEnabled &&
    Boolean(prev.onCreateCanvas) === Boolean(next.onCreateCanvas);
}
