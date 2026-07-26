// Optional read-only companion pane for consulting one note while writing another.

const { useMemo } = React;

function ReferencePane({ note, notes = [], onSelect, onOpenAsMain, onOpenLink, onClose, T }) {
  const body = useMemo(() => {
    if (!note) return '';
    const markdown = note.body ? String(note.body) : mnBlocksToMd(note.blocks || []);
    const escapedTitle = String(note.title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return markdown.replace(new RegExp(`^#\\s+${escapedTitle}\\s*(?:\\r?\\n)+`, 'i'), '');
  }, [note]);
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const referenceOptions = useMemo(() => {
    if ((notes || []).length <= 500) return notes || [];
    const limited = (notes || []).slice(-500).reverse();
    if (note && !limited.some(item => item.id === note.id)) limited.unshift(note);
    return limited.slice(0, 500);
  }, [note, notes]);

  return (
    <aside role="complementary" aria-label="Reference note" style={{
      width: 'clamp(270px, 27vw, 380px)', height: '100%', flexShrink: 0,
      display: 'flex', flexDirection: 'column', background: T.bgSub,
      borderLeft: `1px solid ${T.line}`,
      boxShadow: `-10px 0 28px color-mix(in oklab, ${T.ink} 6%, transparent)`,
    }}>
      <div style={{ padding: '14px 14px 12px', borderBottom: `1px solid ${T.lineSub}`, background: T.bgElevated || T.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11, color: T.inkDim, }}>Reference</div>
            <div style={{ marginTop: 2, fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {note?.title || 'Choose a note'}
            </div>
          </div>
          <button type="button" onClick={() => note && onOpenAsMain?.(note.id)} disabled={!note} aria-label="Open reference as main note" title="Open as main note" style={referenceIconButton(T)}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M5 3H3.5C2.7 3 2 3.7 2 4.5v6C2 11.3 2.7 12 3.5 12h6c.8 0 1.5-.7 1.5-1.5V9" />
              <path d="M7 2h5v5M12 2L6 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" onClick={onClose} aria-label="Close reference pane" title="Close reference pane" style={referenceIconButton(T)}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M2.5 2.5l7 7m0-7l-7 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <select value={note?.id || ''} onChange={event => onSelect?.(event.target.value)} aria-label="Reference note" style={{
          width: '100%', marginTop: 10, border: `1px solid ${T.lineSub}`, borderRadius: 6,
          background: T.bg, color: T.inkMed, padding: '7px 8px', fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>
          {referenceOptions.map(item => <option key={item.id} value={item.id}>{item.title || 'Untitled'}</option>)}
        </select>
        {(notes || []).length > referenceOptions.length && (
          <div style={{ marginTop: 5, fontFamily: 'var(--mn-mono)', fontSize: 9, color: T.inkDim }}>Showing 500 recent notes</div>
        )}
        {!!note && <div style={{ marginTop: 7, fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{wordCount} words · read only</div>}
      </div>
      <div tabIndex="0" aria-label={note ? `Reference content for ${note.title || 'Untitled'}` : 'No reference note selected'} style={{
        flex: 1, overflow: 'auto', padding: '18px 18px 32px', outline: 'none', background: T.bgSub,
      }}>
        {note ? (
          <MnMarkdown md={body} onOpen={label => onOpenLink?.(label)} onTagClick={() => {}} T={T} />
        ) : (
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkDim }}>Choose a note to keep beside your editor.</div>
        )}
      </div>
    </aside>
  );
}

function referenceIconButton(T) {
  return {
    width: 28, height: 28, flexShrink: 0, borderRadius: 6,
    border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  };
}

export { ReferencePane };
import { mnBlocksToMd } from '../../../editor/outline.jsx';
import { MnMarkdown } from '../../../shared/markdown.jsx';
