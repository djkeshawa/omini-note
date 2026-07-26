function TypeLine({ label, linkedTo, extraParent, count, T }) {
  return (
    <div style={{
      marginTop: 3,
      fontFamily: 'var(--mn-ui)', fontWeight: 600,
      fontSize: 11,
      color: T.inkDim,
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
