// Block engine for VispNote — typed blocks.
//
import { MN_DEFAULT_WORKFLOW_STATES, MN_WORKFLOW_STATES } from './blockFeatures.jsx';
import MN_TABLE_OPS_OUTLINE from './tableOps.js';

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
    const m = escaped ? content.match(new RegExp(`^(${escaped})\\s+(.*)$`)) : null;
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
    const line = lines[i];
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
    if (line.startsWith('> ')) {
      flushPara(); listStack = [];
      const { workflow, content, labels } = splitBlockMeta(line.slice(2));
      currentParentList().push(mkBlock({ kind: 'quote', content, workflow, labels }));
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
    // Property line: key:: value. Legacy "- key:: value" bullets are normalized
    // here so metadata does not appear as ordinary list content.
    const propertyLine = line.match(/^\s*(?:-\s*)?([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
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
    const bm = line.match(/^(\s*)(?:(-)\s+(\[([ xX])\]\s+)?|(\d+)([.)])\s+)(.*)$/);
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

function mnBlocksToMd(blocks, depth = 0) {
  let out = [];
  let previousBlock = null;
  const wfPrefix = (b) => b.workflow ? b.workflow + ' ' : '';
  const labelPrefix = (b) => mnSerializeBlockLabels(b.labels || []);
  const isPlainParagraph = (b) => (
    b &&
    b.kind !== 'heading' &&
    b.kind !== 'quote' &&
    b.kind !== 'divider' &&
    b.kind !== 'code' &&
    b.kind !== 'table' &&
    b.kind !== 'plot-points' &&
    b.kind !== 'bullet' &&
    b.kind !== 'ordered' &&
    b.kind !== 'todo'
  );
  const isPropertyParagraph = (b) => isPlainParagraph(b) && /^\s*[a-zA-Z][a-zA-Z0-9_-]*::/.test(b.content || '');
  const pushBlock = (b, text) => {
    if (
      out.length &&
      isPlainParagraph(previousBlock) &&
      isPlainParagraph(b) &&
      !isPropertyParagraph(previousBlock) &&
      !isPropertyParagraph(b)
    ) {
      out.push('');
    }
    out.push(text);
    previousBlock = b;
  };
  for (const b of blocks) {
    if (b.kind === 'heading') {
      const level = Math.max(1, Math.min(6, Number(b.level) || 1));
      pushBlock(b, '#'.repeat(level) + ' ' + labelPrefix(b) + wfPrefix(b) + b.content);
      if (b.children.length) out.push(mnBlocksToMd(b.children, depth + 1));
    } else if (b.kind === 'quote') {
      pushBlock(b, '> ' + labelPrefix(b) + wfPrefix(b) + b.content);
    } else if (b.kind === 'divider') {
      pushBlock(b, '---');
    } else if (b.kind === 'code') {
      const language = mnCleanCodeLanguage(b.language);
      const fence = mnCodeFence(b.content);
      pushBlock(b, fence + language + '\n' + b.content + '\n' + fence);
    } else if (b.kind === 'table') {
      pushBlock(b, b.content);
    } else if (b.kind === 'plot-points') {
      pushBlock(b, '::: plot-points');
      (b.beats && b.beats.length ? b.beats : ['']).forEach(beat => out.push('- ' + String(beat || '')));
      (b.contexts || []).forEach(context => out.push('  - context:: ' + String(context || '')));
      out.push(':::');
    } else if (b.kind === 'bullet' || b.kind === 'ordered' || b.kind === 'todo') {
      const pad = '  '.repeat(depth);
      const chk = b.kind === 'todo' ? (b.checked ? '[x] ' : '[ ] ') : '';
      const marker = b.kind === 'ordered'
        ? `${Math.max(1, Number(b.listNumber) || 1)}${b.listDelimiter === ')' ? ')' : '.'} `
        : `- ${chk}`;
      pushBlock(b, pad + marker + labelPrefix(b) + wfPrefix(b) + b.content);
      if (b.children.length) out.push(mnBlocksToMd(b.children, depth + 1));
    } else {
      // paragraph
      pushBlock(b, labelPrefix(b) + wfPrefix(b) + b.content);
    }
  }
  return out.join('\n').trimEnd();
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
