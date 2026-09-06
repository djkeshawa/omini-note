import { MN_DEFAULT_WORKFLOW_STATES, MN_WORKFLOW_STATES } from '../editor/blockFeatures.jsx';

function mnFormatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const sameYest = d.toDateString() === yest.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameYest) return 'Yesterday';
  if (now - d < 7 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Sentence-case buckets for the note list's date headings.
function mnDateGroupLabel(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Undated';
  const now = new Date();
  const startOfDay = value => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (days < 30) return 'Earlier this month';
  if (d.getFullYear() === now.getFullYear()) return 'Earlier this year';
  return 'Older';
}

// mnSnippet runs once per visible note row per render; cache the workflow
// regex so the escape/sort/compile work happens only when the states change.
let mnWorkflowRegexCache = { states: null, regex: null };

function mnWorkflowRegex() {
  const states = MN_WORKFLOW_STATES || MN_DEFAULT_WORKFLOW_STATES || [];
  if (mnWorkflowRegexCache.states === states) return mnWorkflowRegexCache.regex;
  const workflowPattern = states
    .map(s => s.id)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = workflowPattern ? new RegExp(`^(${workflowPattern})\\s+`, 'gm') : null;
  mnWorkflowRegexCache = { states, regex };
  return regex;
}

// Stripping a body to plain text is eight passes over the whole string and
// does not depend on the query, so it is cached per note object — otherwise
// every visible row redid it on every render, including every keystroke.
const mnPlainBodyCache = new WeakMap();

function mnPlainBody(note) {
  const hit = mnPlainBodyCache.get(note);
  if (hit !== undefined) return hit;
  const plain = mnStripBody(String(note?.body || ''));
  mnPlainBodyCache.set(note, plain);
  return plain;
}

function mnStripBody(body) {
  return body
    .split('\n')
    .filter(l => !/^[a-zA-Z][a-zA-Z0-9_-]*::\s/.test(l))  // skip page properties
    .join('\n')
    .replace(/\{\{embed\s+[^}]+\}\}/g, '')                  // skip embeds
    .replace(/\(\([A-Za-z0-9_-]+\)\)/g, '')                 // skip block refs
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^[ \t]*[-*+][ \t]+\[([ xX])\](?=[ \t]|$)/gm, (_match, checked) => checked === ' ' ? '☐' : '✓')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/[`*>#]/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .replace(mnWorkflowRegex() || /$^/, '')
    .trim().replace(/\s+/g, ' ');
}

function mnSnippet(note, query) {
  const plain = mnPlainBody(note);
  if (!query) return plain.slice(0, 140);
  const idx = plain.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return plain.slice(0, 140);
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + query.length + 100);
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
}

function mnHighlight(text, query, T) {
  if (!query) return text;
  const parts = [];
  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const idx = tLower.indexOf(qLower, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(React.createElement('mark', {
      key: idx,
      style: {
        background: `color-mix(in oklab, ${T.accent} 25%, transparent)`,
        color: T.ink, padding: '0 2px', borderRadius: 2,
      }
    }, text.slice(idx, idx + query.length)));
    i = idx + query.length;
  }
  return parts;
}

export { mnFormatDate, mnDateGroupLabel, mnSnippet, mnHighlight };
