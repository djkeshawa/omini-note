import { mnPanelMiniButton } from '../../shared/panels/panelStyles.js';

function SupportingNoteSection({ type, items, empty, T, onOpen, openNoteMenu, createSupportingNote, onRemoveSupportingType }) {
  const TypeLine = ({ label, linkedTo, extraParent, count }) => (
    <div style={{
      marginTop: 3,
      fontFamily: 'var(--mn-mono)',
      fontSize: 9.5,
      color: T.inkDim,
      textTransform: 'uppercase',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {label}{typeof count === 'number' ? ` · ${count}` : ''}
      {linkedTo ? ` · Linked to ${linkedTo.title || 'Untitled'}${extraParent ? ` · ${extraParent.title || 'Untitled'}` : ''}` : ''}
    </div>
  );

  const NoteCard = ({ note }) => (
    <button
      key={note.id}
      onClick={() => onOpen && onOpen(note.id)}
      onContextMenu={(e) => openNoteMenu(e, note)}
      style={{
        border: `1px solid ${T.lineSub}`,
        borderRadius: 7,
        background: T.bg,
        color: T.ink,
        padding: '9px 10px',
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 58,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
      <div style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 13.5,
        fontWeight: 650,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{note.title || 'Untitled'}</div>
      <TypeLine label={(note.tags || []).find(t => t.startsWith('novel-'))?.replace('novel-', '') || 'note'} />
    </button>
  );

  return (
    <section style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bg,
      padding: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{type.sectionTitle}</div>
        <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{items.length}</div>
        <button
          onClick={() => createSupportingNote(type)}
          style={mnPanelMiniButton(T)}>
          + Note
        </button>
        <button
          onClick={() => onRemoveSupportingType?.(type.tag)}
          title={`Remove ${type.sectionTitle} from Supporting Notes`}
          style={{ ...mnPanelMiniButton(T), color: T.inkDim }}>
          Remove type
        </button>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {items.slice(0, 6).map(note => <NoteCard key={note.id} note={note} />)}
        {!items.length && (
          <div style={{
            border: `1px dashed ${T.line}`,
            borderRadius: 7,
            padding: 16,
            textAlign: 'center',
            color: T.inkDim,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
          }}>{empty}</div>
        )}
      </div>
    </section>
  );
}

export { SupportingNoteSection };
