export function spellWords(text) {
  return Array.from(new Set(String(text || '').match(/[A-Za-z][A-Za-z']{2,}/g) || []))
    .filter(word => !/[A-Z][a-z]+[A-Z]/.test(word))
    .slice(0, 120);
}

export function renderSpellCheckedText(text, issues, theme, onOpenMenu, offset = 0) {
  const value = String(text || '');
  const issueMap = issues || {};
  const baseOffset = Math.max(0, Number(offset) || 0);
  const output = [];
  const wordPattern = /[A-Za-z][A-Za-z']{2,}/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = wordPattern.exec(value))) {
    if (match.index > last) output.push(<span key={key++}>{value.slice(last, match.index)}</span>);
    const word = match[0];
    const normalized = word.toLowerCase();
    const start = match.index;
    const end = start + word.length;
    if (issueMap[normalized]) {
      output.push(
        <span
          key={key++}
          title="Spelling suggestion"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenMenu?.({
              word,
              normalized,
              start: baseOffset + start,
              end: baseOffset + end,
              suggestions: issueMap[normalized] || [],
              x: event.clientX,
              y: event.clientY,
            });
          }}
          style={{
            textDecorationLine: 'underline',
            textDecorationStyle: 'wavy',
            textDecorationColor: theme.danger || '#d94841',
            textDecorationThickness: '1.2px',
            textUnderlineOffset: 3,
          }}>{word}</span>
      );
    } else {
      output.push(<span key={key++}>{word}</span>);
    }
    last = end;
  }
  if (last < value.length) output.push(<span key={key++}>{value.slice(last)}</span>);
  return output;
}

function menuButton(theme, strong) {
  return {
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: strong ? theme.ink : theme.inkMed,
    borderRadius: 5,
    padding: '6px 8px',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: strong ? 'var(--mn-mono)' : 'var(--mn-ui)',
    fontSize: 12,
  };
}

export function SpellSuggestionMenu({ menu, onPick, onAdd, onClose, T }) {
  if (!menu) return null;
  const suggestions = menu.suggestions || [];
  return (
    <div
      className="mn-spell-menu"
      onMouseDown={(event) => event.preventDefault()}
      style={{
        position: 'fixed', top: menu.y, left: menu.x, zIndex: 12000, width: 190,
        background: T.bg, border: `1px solid ${T.line}`, borderRadius: 7,
        boxShadow: `0 12px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`, padding: 5,
      }}>
      {suggestions.length ? suggestions.map(suggestion => (
        <button key={suggestion} onMouseDown={(event) => {
          event.preventDefault();
          onPick?.(suggestion);
        }} style={menuButton(T, true)}>{suggestion}</button>
      )) : (
        <div style={{ padding: '7px 8px', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim }}>
          No suggestions
        </div>
      )}
      <div style={{ height: 1, background: T.lineSub, margin: '4px 3px' }} />
      <button onMouseDown={(event) => {
        event.preventDefault();
        onAdd?.(menu.normalized);
      }} style={menuButton(T, false)}>Ignore word</button>
      <button onMouseDown={(event) => {
        event.preventDefault();
        onClose?.();
      }} style={menuButton(T, false)}>Close</button>
    </div>
  );
}
