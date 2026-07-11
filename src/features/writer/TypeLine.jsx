function TypeLine({ label, linkedTo, extraParent, count, T }) {
  return (
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
}

export { TypeLine };
