// The note list's three mutually exclusive zero-states. They live together
// because the third one exists only to stop the second one lying: when the
// search index is down, "No notes match" blames the user's vault for the
// app's own failure.
import { dsButtonStyle } from '../../shared/designSystem.js';
import { DsEmptyState } from '../../shared/components/DesignPrimitives.jsx';

const iconDocument = (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
    <rect x="3" y="2.5" width="10" height="11" rx="1.5" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" strokeLinecap="round" />
  </svg>
);

const iconMagnifier = (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
    <circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L13.5 13.5" strokeLinecap="round" />
  </svg>
);

const iconWarning = (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
    <path d="M8 2.4L14.2 13.2H1.8L8 2.4Z" strokeLinejoin="round" /><path d="M8 6.4v3M8 11.3v.1" strokeLinecap="round" />
  </svg>
);

function NoteListEmptyState({ T, query, searchStatus = 'idle', onQueryChange, onCreateNote = null }) {
  const clearSearch = (
    <button onClick={() => onQueryChange('')} style={dsButtonStyle(T)}>Clear search</button>
  );
  // Order matters: an empty query is an empty vault even if a failure flag is
  // still hanging around, and a failure outranks "nothing matched".
  if (!query) {
    return (
      <DsEmptyState
        T={T}
        icon={iconDocument}
        headline="No notes yet"
        body="Notes are markdown files on disk. Anything you write here stays readable without the app."
        action={onCreateNote ? (
          <button onClick={() => onCreateNote()} style={{
            ...dsButtonStyle(T, 'default', { height: 30 }),
            background: T.accentSoft, borderColor: T.selLine, color: T.accent,
          }}>New note</button>
        ) : null}
      />
    );
  }
  if (searchStatus === 'index-unavailable') {
    // One action only. Rebuilding the index lives in settings; a second button
    // here would make this surface compete with itself.
    return (
      <DsEmptyState
        T={T}
        tone="warn"
        icon={iconWarning}
        headline="Search index unavailable"
        body={`Nothing in your open notes matches “${query}”. Results are limited until the index is rebuilt.`}
        action={clearSearch}
      />
    );
  }
  return (
    <DsEmptyState
      T={T}
      icon={iconMagnifier}
      headline={`No notes match “${query}”`}
      body="Search covers titles, body text and tags in this vault only."
      action={clearSearch}
    />
  );
}

export { NoteListEmptyState };
