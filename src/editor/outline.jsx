// Block engine for VispNote — typed blocks.
//
import { MN_DEFAULT_WORKFLOW_STATES, MN_WORKFLOW_STATES } from './blockFeatures.jsx';
import MN_TABLE_OPS_OUTLINE from './tableOps.js';
import { mnFoldSoftBreaks, mnSoftBreaks } from './softBreaks.js';

// Each block has a `kind`:
//   - 'paragraph'  — plain text, Enter creates next paragraph
//   - 'heading'    — H1-H6 (level 1-6), Enter creates next paragraph
//   - 'bullet'     — list item, Enter creates next bullet, empty Enter exits to paragraph
//   - 'todo'       — checkbox + text, Enter creates next todo, empty Enter exits
//   - 'quote'      — blockquote, Enter creates next paragraph
//   - 'code'       — fenced code, Enter inserts \n inside (escape with empty line)
//   - 'table'      — markdown table, rendered as a formatted table
//   - 'divider'    — horizontal rule, no content
//
// Blocks can have children (nested only for bullet/todo, not paragraph/heading).
// `level` 1-6 only meaningful when kind === 'heading'.
// `checked` (true|false) only meaningful when kind === 'todo'.
// `collapsed` hides children. `annotations` is an array of {start, end, kind} where
// kind ∈ 'bold','italic','code','strike','hi-yellow','hi-green','hi-pink','hi-blue','color-red','color-blue','color-purple'.

const { useState: useStateO, useEffect: useEffectO, useRef: useRefO, useCallback: useCallbackO, useMemo: useMemoO } = React;
let _bid = 0;
function mkBlock(opts = {}) {
  _bid++;
  return {
    id: 'b_' + Date.now().toString(36) + '_' + _bid,
    kind: opts.kind || 'bullet',
    content: opts.content || '',
    level: opts.level || 0,
    checked: opts.checked != null ? opts.checked : null,
    listNumber: Math.max(1, Number(opts.listNumber) || 1),
    listDelimiter: opts.listDelimiter === ')' ? ')' : '.',
    children: opts.children || [],
    collapsed: !!opts.collapsed,
    annotations: opts.annotations || [],
    workflow: opts.workflow || null,
    labels: mnNormalizeBlockLabels(opts.labels || []),
    language: opts.language || '',
    beats: Array.isArray(opts.beats) ? opts.beats : [],
    contexts: Array.isArray(opts.contexts) ? opts.contexts : [],
    hidden: !!opts.hidden,
  };
}

const MN_BLOCK_LABEL_COLOR_IDS = ['yellow', 'pink', 'blue', 'green', 'purple', 'red'];

function mnNormalizeBlockLabelColor(color = '') {
  const clean = String(color || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
  return MN_BLOCK_LABEL_COLOR_IDS.includes(clean) ? clean : 'yellow';
}

function mnNormalizeBlockLabels(labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .map(label => ({
      id: String(label?.id || `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
      text: String(label?.text || ''),
      color: mnNormalizeBlockLabelColor(label?.color),
    }))
    .slice(0, 6);
}

function mnEncodeBlockLabelText(text = '') {
  return encodeURIComponent(String(text || '')).replace(/%20/g, '+');
}

function mnDecodeBlockLabelText(text = '') {
  try {
    return decodeURIComponent(String(text || '').replace(/\+/g, '%20'));
  } catch (e) {
    return String(text || '');
  }
}

function mnExtractBlockLabels(content = '') {
  let rest = String(content || '');
  const labels = [];
  let match = rest.match(/^\s*\{\{label:([a-z0-9_-]+)\|([^}]*)\}\}\s*/i);
  while (match) {
    labels.push({
      id: `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${labels.length}`,
      color: mnNormalizeBlockLabelColor(match[1]),
      text: mnDecodeBlockLabelText(match[2]),
    });
    rest = rest.slice(match[0].length);
    match = rest.match(/^\s*\{\{label:([a-z0-9_-]+)\|([^}]*)\}\}\s*/i);
  }
  return { labels: mnNormalizeBlockLabels(labels), content: rest };
}

function mnSerializeBlockLabels(labels = []) {
  return mnNormalizeBlockLabels(labels)
    .map(label => `{{label:${mnNormalizeBlockLabelColor(label.color)}|${mnEncodeBlockLabelText(label.text)}}}`)
    .join('');
}

function mnCleanCodeLanguage(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_+#.-]/g, '');
  const aliases = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    md: 'markdown',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    plain: '',
    text: '',
    txt: '',
  };
  return Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : raw;
}

// Convert legacy markdown into typed blocks.
//
// KNOWN LIMITATION — pre-existing, not a regression, and deliberately not fixed
// this round: a paragraph that is a sibling of an inner heading but a child of
// an outer one is re-nested under the inner heading when the note is read back.
// Nothing on disk tells the two apart. The double-blank-line terminator tried
// in round 1 did tell them apart, but only by rewriting the bytes of every note
// that already contained a blank line, so it was reverted. Do not re-fix it.
function mnMdToBlocks(md) {
  const lines = md.split('\n');
  const out = [];
  let listStack = []; // entries: { block, indent }
  let paraBuf = [];
  // Track the most-recent heading at each level so we can nest bullets
  // and content underneath their section heading.
  // headingStack[level] = block reference of last heading of that level.
  let headingStack = []; // index = level - 1

  // Where should a new top-level (non-indented) item be appended?
  // If we have an active heading, append to its children; else to `out`.
  const currentParentList = () => {
    for (let i = headingStack.length - 1; i >= 0; i--) {
      if (headingStack[i]) return headingStack[i].children;
    }
    return out;
  };

  // Detect "TODO Some content" → { workflow: 'TODO', content: 'Some content' }
  const splitWorkflow = (content) => {
    const states = MN_WORKFLOW_STATES || MN_DEFAULT_WORKFLOW_STATES || [
      { id: 'TODO' }, { id: 'DOING' }, { id: 'DONE' }, { id: 'LATER' }, { id: 'NOW' }, { id: 'WAIT' }, { id: 'CANCELLED' },
    ];
    const ids = states.map(s => s.id).filter(Boolean).sort((a, b) => b.length - a.length);
    const escaped = ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // `[\s\S]*`, not `.*`: a block with a Shift+Enter break has a \n in its
    // content, and `.` would stop at it — the pill vanished and the literal
    // word TODO became the first word of the paragraph.
    // `[^\S\n]+`, not `\s+`, for the separator: `\s` matches \n, so a block
    // whose FIRST LINE is exactly a state word ("TODO" then a break then "buy
    // milk") stole a workflow pill the user never set and ate the break.
    const m = escaped ? content.match(new RegExp(`^(${escaped})[^\\S\\n]+([\\s\\S]*)$`)) : null;
    if (m) return { workflow: m[1], content: m[2] };
    return { workflow: null, content };
  };
  const splitBlockMeta = (content) => {
    const labelled = mnExtractBlockLabels(content);
    const workflow = splitWorkflow(labelled.content);
    return { ...workflow, labels: labelled.labels };
  };

  const flushPara = () => {
    if (paraBuf.length) {
      const text = paraBuf.join(' ');
      const { workflow, content, labels } = splitBlockMeta(text);
      currentParentList().push(mkBlock({ kind: 'paragraph', content, workflow, labels }));
      paraBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^:::\s*plot-points\s*$/i.test(line)) {
      flushPara(); listStack = [];
      const beats = [];
      const contexts = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
        const context = lines[i].match(/^\s{2,}-\s*context::\s*(.*)$/i) || lines[i].match(/^\s*context::\s*(.*)$/i);
        const beat = lines[i].match(/^\s*-\s+(.*)$/);
        if (context) contexts.push(context[1].trim());
        else if (beat) beats.push(beat[1].trim());
        i++;
      }
      currentParentList().push(mkBlock({ kind: 'plot-points', content: 'Plot Points', beats, contexts }));
      continue;
    }
    const codeFence = line.match(/^(`{3,})\s*([A-Za-z0-9_+#.-]*)\s*$/);
    if (codeFence) {
      flushPara(); listStack = [];
      const language = mnCleanCodeLanguage(codeFence[2]);
      // Only a fence at least as long as the opening one closes the block, so
      // a code block that quotes ``` survives being written out and read back.
      const closeFence = new RegExp(`^\`{${codeFence[1].length},}\\s*$`);
      const buf = [];
      i++;
      while (i < lines.length && !closeFence.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      currentParentList().push(mkBlock({ kind: 'code', content: buf.join('\n'), language }));
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); listStack = [];
      const level = h[1].length;
      const { workflow, content, labels } = splitBlockMeta(h[2]);
      const blk = mkBlock({ kind: 'heading', level, content, workflow, labels });
      // Pop heading stack to this level's parent
      headingStack = headingStack.slice(0, level - 1);
      // Append under nearest enclosing heading (or top-level)
      currentParentList().push(blk);
      // This heading is now the active container at its level
      headingStack[level - 1] = blk;
      continue;
    }
    if (/^---+$/.test(line)) {
      flushPara(); listStack = [];
      currentParentList().push(mkBlock({ kind: 'divider' }));
      continue;
    }
    const table = MN_TABLE_OPS_OUTLINE.readMarkdownTable && MN_TABLE_OPS_OUTLINE.readMarkdownTable(lines, i);
    if (table) {
      flushPara(); listStack = [];
      currentParentList().push(mkBlock({ kind: 'table', content: table.markdown }));
      i = table.endIndex;
      continue;
    }
    // Soft breaks, read side. `mnSoftBreaks` is the writer; `renderBlocks` in
    // lib/exportHtml.js is the second implementation of this same rule — change
    // one and you must change the other.
    //
    // POSITION IS THE CONTRACT. This runs after every reader for a kind the
    // writer emits RAW — plot-points, fenced code, heading, divider, table —
    // and before every reader for a kind the writer puts through
    // `mnSoftBreaks`: quote, property line, list item, paragraph. A codec that
    // ran over all lines would halve backslash runs the writer never doubled,
    // so `## notes in C:\` came back as prose and 0.2.5's heading bytes were
    // silently rewritten. Only escaped kinds may be decoded.
    //
    // Count the trailing run instead of testing for one backslash: the count is
    // what tells a marked line from a line whose own text ends in a backslash,
    // so `see C:\notes\` no longer swallows the block after it.
    const folded = mnFoldSoftBreaks(lines, i);
    line = folded.text;
    i = folded.endIndex;
    if (line.startsWith('> ')) {
      flushPara(); listStack = [];
      const { workflow, content, labels } = splitBlockMeta(line.slice(2));
      currentParentList().push(mkBlock({ kind: 'quote', content, workflow, labels }));
      continue;
    }
    // Property line: key:: value. Legacy "- key:: value" bullets are normalized
    // here so metadata does not appear as ordinary list content.
    // `[^\S\n]*`, not `\s*`: after a soft-break fold `line` holds a \n, and a
    // leading-whitespace class that spans it would read the block's second line
    // as its first and drop everything above it.
    const propertyLine = line.match(/^[^\S\n]*(?:-\s*)?([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
    if (propertyLine) {
      flushPara(); listStack = [];
      currentParentList().push(mkBlock({
        kind: 'paragraph',
        content: `${propertyLine[1]}:: ${propertyLine[2] || ''}`.trimEnd(),
      }));
      continue;
    }
    // Unordered, task, or ordered list item. Any list kind may nest under any
    // other list kind, and ordered markers retain their number and delimiter.
    // Indent is `[^\S\n]*` for the same reason as the property line above; the
    // item's own text is `[\s\S]*` so a folded soft break stays in it.
    const bm = line.match(/^([^\S\n]*)(?:(-)\s+(\[([ xX])\]\s+)?|(\d+)([.)])\s+)([\s\S]*)$/);
    if (bm) {
      flushPara();
      const indent = bm[1].length;
      const isOrdered = !!bm[5];
      const isTodo = !isOrdered && !!bm[3];
      const checked = bm[4] && /[xX]/.test(bm[4]);
      const { workflow, content, labels } = splitBlockMeta(bm[7]);
      const blk = mkBlock({
        kind: isOrdered ? 'ordered' : isTodo ? 'todo' : 'bullet',
        content,
        checked: isTodo ? checked : null,
        listNumber: isOrdered ? Number(bm[5]) : 1,
        listDelimiter: isOrdered ? bm[6] : '.',
        workflow,
        labels,
      });
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      if (listStack.length === 0) currentParentList().push(blk);
      else listStack[listStack.length - 1].block.children.push(blk);
      listStack.push({ block: blk, indent });
      continue;
    }
    if (line.trim() === '') {
      flushPara(); listStack = [];
      continue;
    }
    listStack = [];
    paraBuf.push(line);
  }
  flushPara();
  return out;
}

// The fence that will still be the block's own when the note is read back:
// longer than any line of bare backticks inside it. Those are the only lines
// the reader can mistake for the close, so ordinary code containing ``` mid
// line keeps the usual three and existing notes rewrite unchanged.
function mnCodeFence(content) {
  let longest = 0;
  for (const line of String(content || '').split('\n')) {
    const match = line.match(/^(`{3,})\s*$/);
    if (match && match[1].length > longest) longest = match[1].length;
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

const MN_MD_NON_PARAGRAPH_KINDS = [
  'heading', 'quote', 'divider', 'code', 'table', 'plot-points', 'bullet', 'ordered', 'todo',
];
// Kinds whose first line would be absorbed by, or would re-interpret, the line
// above it. `---` straight after a paragraph is a setext H2 to CommonMark.
const MN_MD_NEEDS_BLANK_BEFORE = ['divider', 'heading', 'code', 'table', 'plot-points'];

const mnIsPlainParagraph = (b) => !!b && !MN_MD_NON_PARAGRAPH_KINDS.includes(b.kind);
const mnIsPropertyParagraph = (b) => mnIsPlainParagraph(b) && /^\s*[a-zA-Z][a-zA-Z0-9_-]*::/.test(b.content || '');

// One emission path for every block, so `prev` is always the block actually
// written — including the last descendant of a heading or list item.
// `tight` suppresses the separator before a container's first child.
function mnPushBlock(state, block, text) {
  if (state.out.length) {
    if (MN_MD_NEEDS_BLANK_BEFORE.includes(block.kind) && !(state.tight && block.kind === 'heading')) state.out.push('');
    else if (!state.tight && mnIsPlainParagraph(state.prev) && mnIsPlainParagraph(block)
      && !mnIsPropertyParagraph(state.prev) && !mnIsPropertyParagraph(block)) state.out.push('');
  }
  state.out.push(text);
  state.prev = block;
  state.tight = false;
}

function mnWriteBlocks(blocks, depth, state) {
  const prefix = (b) => mnSerializeBlockLabels(b.labels || []) + (b.workflow ? b.workflow + ' ' : '');
  for (const b of blocks) {
    const push = (text) => mnPushBlock(state, b, text);
    const children = b.children || [];
    if (b.kind === 'heading') {
      const level = Math.max(1, Math.min(6, Number(b.level) || 1));
      push('#'.repeat(level) + ' ' + prefix(b) + b.content);
      if (children.length) { state.tight = true; mnWriteBlocks(children, depth + 1, state); }
    } else if (b.kind === 'quote') {
      push('> ' + prefix(b) + mnSoftBreaks(b.content));
    } else if (b.kind === 'divider') {
      push('---');
    } else if (b.kind === 'code') {
      const language = mnCleanCodeLanguage(b.language);
      const fence = mnCodeFence(b.content);
      push(fence + language + '\n' + b.content + '\n' + fence);
    } else if (b.kind === 'table') {
      push(b.content);
    } else if (b.kind === 'plot-points') {
      push('::: plot-points');
      (b.beats && b.beats.length ? b.beats : ['']).forEach(beat => state.out.push('- ' + String(beat || '')));
      (b.contexts || []).forEach(context => state.out.push('  - context:: ' + String(context || '')));
      state.out.push(':::');
    } else if (b.kind === 'bullet' || b.kind === 'ordered' || b.kind === 'todo') {
      const chk = b.kind === 'todo' ? (b.checked ? '[x] ' : '[ ] ') : '';
      const marker = b.kind === 'ordered'
        ? `${Math.max(1, Number(b.listNumber) || 1)}${b.listDelimiter === ')' ? ')' : '.'} `
        : `- ${chk}`;
      push('  '.repeat(depth) + marker + prefix(b) + mnSoftBreaks(b.content));
      if (children.length) { state.tight = true; mnWriteBlocks(children, depth + 1, state); }
    } else {
      // paragraph
      push(prefix(b) + mnSoftBreaks(b.content));
    }
  }
}

function mnBlocksToMd(blocks, depth = 0) {
  const state = { out: [], prev: null, tight: false };
  mnWriteBlocks(blocks, depth, state);
  return state.out.join('\n').trimEnd();
}

// Walk blocks
function mnWalk(blocks, cb) {
  for (let i = 0; i < blocks.length; i++) {
    const res = cb(blocks[i]);
    if (res === false) return false;
    if (blocks[i].children && blocks[i].children.length) {
      if (mnWalk(blocks[i].children, cb) === false) return false;
    }
  }
}

function mnFindBlock(blocks, id) {
  let found = null;
  mnWalk(blocks, (b) => { if (b.id === id) { found = b; return false; } });
  return found;
}

function mnLocate(blocks, id, parent = null) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { block: blocks[i], arr: blocks, idx: i, parent };
    if (blocks[i].children && blocks[i].children.length) {
      const r = mnLocate(blocks[i].children, id, blocks[i]);
      if (r) return r;
    }
  }
  return null;
}

function mnCloneBlocks(blocks) {
  return blocks.map(b => ({
    ...b,
    annotations: (b.annotations || []).map(a => ({ ...a })),
    labels: mnNormalizeBlockLabels(b.labels || []).map(label => ({ ...label })),
    beats: Array.isArray(b.beats) ? [...b.beats] : [],
    contexts: Array.isArray(b.contexts) ? [...b.contexts] : [],
    hidden: !!b.hidden,
    children: mnCloneBlocks(b.children || []),
  }));
}

function mnFlatten(blocks, depth = 0, respectCollapsed = true, acc = []) {
  for (const b of blocks) {
    acc.push({ block: b, depth });
    if (b.children && b.children.length && !(respectCollapsed && b.collapsed)) {
      mnFlatten(b.children, depth + 1, respectCollapsed, acc);
    }
  }
  return acc;
}

// Block kind helpers
function mnIsListLike(kind) { return kind === 'bullet' || kind === 'ordered' || kind === 'todo'; }
// Any block can have children.
function mnCanHaveChildren(kind) { return kind !== 'divider'; }

export {
  mkBlock, mnBlocksToMd, mnCanHaveChildren, mnCloneBlocks, mnExtractBlockLabels,
  mnFindBlock, mnFlatten, mnIsListLike, mnLocate, mnMdToBlocks,
  mnNormalizeBlockLabels, mnSerializeBlockLabels, mnWalk,
};
