// Small line-diff implementation for note version previews.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_VERSION_DIFF = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function splitLines(value, maxLines = 800) {
    return String(value == null ? '' : value).replace(/\r\n/g, '\n').split('\n').slice(0, maxLines);
  }

  function lineDiff(before = '', after = '', { maxLines = 800, maxCells = 160000 } = {}) {
    const left = splitLines(before, maxLines);
    const right = splitLines(after, maxLines);
    if (left.length * right.length > maxCells) {
      return {
        rows: [
          ...left.map(text => ({ type: 'remove', text })),
          ...right.map(text => ({ type: 'add', text })),
        ],
        added: right.length,
        removed: left.length,
        truncated: true,
      };
    }
    const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        table[i][j] = left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const rows = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        rows.push({ type: 'same', text: left[i] }); i++; j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        rows.push({ type: 'remove', text: left[i++] });
      } else {
        rows.push({ type: 'add', text: right[j++] });
      }
    }
    while (i < left.length) rows.push({ type: 'remove', text: left[i++] });
    while (j < right.length) rows.push({ type: 'add', text: right[j++] });
    return {
      rows,
      added: rows.filter(row => row.type === 'add').length,
      removed: rows.filter(row => row.type === 'remove').length,
      truncated: left.length >= maxLines || right.length >= maxLines,
    };
  }

  return { splitLines, lineDiff };
});
