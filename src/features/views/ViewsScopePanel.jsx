// The Scope menu, built to the v2 prototype.
//
// Scope picks notes; conditions pick rows inside them. Two scopes are real in
// this app — the tags a note carries, and the notes it links to. The
// prototype's folder scope is left out: every note lives in the vault root, so
// a folder control would be a permanently empty list.
//
// Both are ALL, not ANY. Pick two tags and a note has to have both. That is
// what the query does, so the menu says it rather than letting you find out.

import { DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import {
  mnViewsScopeTags, mnViewsScopeLinks, mnViewsScopeSummary, mnViewsScopeIsSet, mnViewsScopeTagChoices,
} from './viewsScope.js';

function ScopeRow({ label, machine, on, onToggle, T }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
        padding: '6px 9px', border: 'none', borderRadius: 7,
        background: 'transparent', cursor: 'pointer', textAlign: 'left',
      }}>
      <span style={{
        width: 15, height: 15, flexShrink: 0, borderRadius: 4,
        border: `1.5px solid ${on ? T.accent : T.line}`,
        background: on ? T.accent : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {on && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 5L4 7L8 3" stroke={T.bg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span style={{
        minWidth: 0, flex: 1,
        ...(machine ? dsMachineStyle(T, T.ink) : { fontFamily: 'var(--mn-ui)', color: T.ink }),
        fontSize: machine ? 11.5 : 12.5,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
    </button>
  );
}

function ViewsScopeMenu({ definition = {}, tags = [], notes = [], onToggleTag, onToggleLink, onClear, T }) {
  const chosenTags = mnViewsScopeTags(definition).map(tag => tag.toLowerCase());
  const chosenLinks = mnViewsScopeLinks(definition).map(title => title.toLowerCase());
  // Notes already picked stay listed even if they fall out of the shortlist,
  // so a scope can always be undone from the menu that set it.
  const tagNames = mnViewsScopeTagChoices(tags, notes, mnViewsScopeTags(definition));
  const linkable = notes.slice(0, 12).map(note => note.title).filter(Boolean);
  const linkTitles = [...new Set(mnViewsScopeLinks(definition).concat(linkable))];

  const section = (label, hint) => (
    <div style={{ padding: '9px 9px 5px' }}>
      <div style={{
        fontFamily: 'var(--mn-ui)', fontSize: 10.5, fontWeight: 600,
        letterSpacing: '0.04em', textTransform: 'uppercase', color: T.inkDim,
      }}>{label}</div>
      {hint && <div style={{ marginTop: 3, fontSize: 11, color: T.inkDim, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );

  return (
    <div
      data-mn-views-scope="true"
      role="menu"
      aria-label="Scope"
      style={{
        position: 'absolute', top: 32, left: 0, zIndex: 60, width: 264,
        maxHeight: 460, overflowY: 'auto',
        background: T.bgElevated || T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: DS_RADIUS.row,
        boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        padding: 5,
      }}>
      <div style={{
        padding: '6px 9px 7px',
        fontFamily: 'var(--mn-serif, var(--mn-ui))', fontSize: 12.5,
        lineHeight: 1.45, color: T.inkMed,
      }}>
        Scope picks notes. Everything else picks rows inside them.
      </div>

      {section('Tags', 'A note has to carry every tag you pick.')}
      {tagNames.length ? tagNames.map(tag => (
        <ScopeRow
          key={tag}
          label={`#${tag}`}
          machine
          on={chosenTags.includes(tag.toLowerCase())}
          onToggle={() => onToggleTag?.(tag)}
          T={T}
        />
      )) : (
        <div style={{ padding: '2px 9px 8px', fontSize: 11.5, color: T.inkDim, lineHeight: 1.45 }}>
          This vault has no tags yet.
        </div>
      )}

      {section('Links', 'A note has to link to every note you pick.')}
      {linkTitles.length ? linkTitles.map(title => (
        <ScopeRow
          key={title}
          label={title}
          on={chosenLinks.includes(title.toLowerCase())}
          onToggle={() => onToggleLink?.(title)}
          T={T}
        />
      )) : (
        <div style={{ padding: '2px 9px 8px', fontSize: 11.5, color: T.inkDim, lineHeight: 1.45 }}>
          Nothing to link to yet.
        </div>
      )}

      <div style={{
        marginTop: 6, padding: '8px 9px 4px',
        borderTop: `1px solid ${T.lineSub}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{ fontSize: 11.5, color: T.inkDim, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {mnViewsScopeSummary(definition)}
        </span>
        {mnViewsScopeIsSet(definition) && (
          <button type="button" onClick={onClear} style={{
            height: 24, padding: '0 9px', flexShrink: 0,
            borderRadius: DS_RADIUS.control,
            border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 11.5, cursor: 'pointer',
          }}>Whole vault</button>
        )}
      </div>
    </div>
  );
}

export { ViewsScopeMenu };
