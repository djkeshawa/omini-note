export function blockRowMemoEqual(prev, next) {
  return prev.block === next.block &&
    prev.depth === next.depth &&
    prev.focusId === next.focusId &&
    prev.T === next.T &&
    prev.allNotes === next.allNotes &&
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
