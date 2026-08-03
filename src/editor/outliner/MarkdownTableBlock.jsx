// The markdown table block: rendering, and editing cells in place.
//
// A cell edit rewrites the block's markdown through the same serializer the
// editor uses, so a note stays plain markdown that any other tool can read --
// the table is a view over the text, never a separate data structure.
import MN_TABLE_OPS from '../tableOps.js';

const {
  markdownTableToRows: mnMarkdownTableToRows,
  rowsToMarkdownTable: mnRowsToMarkdownTable,
} = MN_TABLE_OPS;

// Replaces one cell and re-serializes, so an in-place edit produces exactly
// the markdown the editor would have written by hand.
function mnTableMarkdownWithCell(markdown, rowIndex, colIndex, value) {
  const rows = (mnMarkdownTableToRows ? mnMarkdownTableToRows(markdown || '') : []).map(row => [...row]);
  if (!rows[rowIndex]) return markdown || '';
  rows[rowIndex][colIndex] = String(value == null ? '' : value).replace(/\r?\n/g, ' ').trim();
  return mnRowsToMarkdownTable ? mnRowsToMarkdownTable(rows) : (markdown || '');
}

// Cells are editable in place. Typing in a rendered cell rewrites the block's
// markdown through the same serializer the editor uses, so the note on disk
// stays plain markdown and nothing else has to know these are inputs.
function MnMarkdownTable({ markdown, T, onEditCell }) {
  const rows = mnMarkdownTableToRows ? mnMarkdownTableToRows(markdown || '') : [];
  const editable = typeof onEditCell === 'function';
  // The block's display wrapper turns a click into "edit the raw markdown".
  // A click meant for a cell must not reach it.
  const swallow = editable ? (e) => e.stopPropagation() : undefined;
  const commit = (r, c) => (e) => {
    const next = String(e.target.textContent || '');
    if (next === (rows[r] || [])[c]) return;
    onEditCell(mnTableMarkdownWithCell(markdown, r, c, next));
  };
  const cellEditProps = editable ? (r, c) => ({
    contentEditable: true,
    suppressContentEditableWarning: true,
    onMouseDown: swallow,
    onClick: swallow,
    onBlur: commit(r, c),
    onKeyDown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { e.target.textContent = (rows[r] || [])[c] || ''; e.target.blur(); }
    },
  }) : () => ({});
  if (!rows.length) {
    return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>Empty table</span>;
  }
  const cellBase = {
    padding: '6px 9px',
    border: `1px solid ${T.lineSub}`,
    textAlign: 'left',
    verticalAlign: 'top',
    whiteSpace: 'pre-wrap',
  };
  return (
    <div style={{
      overflowX: 'auto',
      maxWidth: '100%',
      padding: '2px 0',
    }}>
      <table style={{
        borderCollapse: 'collapse',
        minWidth: 280,
        maxWidth: '100%',
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
        lineHeight: 1.45,
        color: T.ink,
        background: T.bg,
      }}>
        <thead>
          <tr>
            {rows[0].map((cell, i) => (
              <th key={i} {...cellEditProps(0, i)} style={{
                ...cellBase,
                background: T.bgSub,
                fontWeight: 650,
                color: T.ink,
                cursor: editable ? 'text' : 'inherit',
              }}>{cell || '\u00a0'}</th>
            ))}
          </tr>
        </thead>
        {rows.length > 1 && (
          <tbody>
            {rows.slice(1).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} {...cellEditProps(r + 1, c)} style={{
                    ...cellBase,
                    background: r % 2 ? T.bgSub : T.bg,
                    color: T.inkMed,
                    cursor: editable ? 'text' : 'inherit',
                  }}>{cell || '\u00a0'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

export { MnMarkdownTable, mnTableMarkdownWithCell };
