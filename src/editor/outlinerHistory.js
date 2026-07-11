  function normalizeBlock(block) {
    return block && typeof block === 'object' ? block : null;
  }

  function blocksEquivalent(a, b) {
    if (a === b) return true;
    if (!normalizeBlock(a) || !normalizeBlock(b)) return false;
    const aKeys = Object.keys(a).filter(key => key !== 'children');
    const bKeys = Object.keys(b).filter(key => key !== 'children');
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!valuesEquivalent(a[key], b[key])) return false;
    }
    return true;
  }

  function valuesEquivalent(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch { return false; }
  }

  function shareBlockTree(previous = [], next = []) {
    let changed = previous.length !== next.length;
    const out = next.map((nextBlock, index) => {
      const prevBlock = previous[index];
      const nextChildren = Array.isArray(nextBlock?.children) ? nextBlock.children : [];
      const prevChildren = Array.isArray(prevBlock?.children) ? prevBlock.children : [];
      const sharedChildren = shareBlockTree(prevChildren, nextChildren);
      const childrenChanged = sharedChildren !== prevChildren;
      if (!childrenChanged && blocksEquivalent(prevBlock, nextBlock)) return prevBlock;
      changed = true;
      return { ...nextBlock, children: sharedChildren };
    });
    if (!changed) return previous;
    return out;
  }

  function pushUndo(history, snapshot, limit = 80) {
    if (!history || !Array.isArray(history.undoStack) || !Array.isArray(snapshot)) return;
    history.undoStack.push(snapshot);
    if (history.undoStack.length > limit) history.undoStack.shift();
    history.redoStack = [];
  }

  function createEditorHistory(limit = 80) {
    return {
      undoStack: [],
      redoStack: [],
      limit,
      clear() {
        this.undoStack = [];
        this.redoStack = [];
      },
      record(snapshot) {
        pushUndo(this, snapshot, this.limit);
      },
      undo(currentSnapshot) {
        if (!this.undoStack.length) return null;
        const prior = this.undoStack.pop();
        this.redoStack.push(currentSnapshot);
        return prior;
      },
      redo(currentSnapshot) {
        if (!this.redoStack.length) return null;
        const next = this.redoStack.pop();
        this.undoStack.push(currentSnapshot);
        return next;
      },
    };
  }

export { createEditorHistory, shareBlockTree };
