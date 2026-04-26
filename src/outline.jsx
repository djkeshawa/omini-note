// Block engine for OminiNote — typed blocks.
//
// Each block has a `kind`:
//   - 'paragraph'  — plain text, Enter creates next paragraph
//   - 'heading'    — H1/H2/H3 (level 1-3), Enter creates next paragraph
//   - 'bullet'     — list item, Enter creates next bullet, empty Enter exits to paragraph
//   - 'todo'       — checkbox + text, Enter creates next todo, empty Enter exits
//   - 'quote'      — blockquote, Enter creates next paragraph
//   - 'code'       — fenced code, Enter inserts \n inside (escape with empty line)
//   - 'table'      — markdown table, rendered as a formatted table
//   - 'divider'    — horizontal rule, no content
//
// Blocks can have children (nested only for bullet/todo, not paragraph/heading).
// `level` 1-3 only meaningful when kind === 'heading'.
// `checked` (true|false) only meaningful when kind === 'todo'.
// `collapsed` hides children. `annotations` is an array of {start, end, kind} where
// kind ∈ 'bold','italic','code','strike','hi-yellow','hi-green','hi-pink','hi-blue','color-red','color-blue','color-purple'.

const { useState: useStateO, useEffect: useEffectO, useRef: useRefO, useCallback: useCallbackO, useMemo: useMemoO } = React;
const MN_TABLE_OPS_OUTLINE = window.MN_TABLE_OPS || {};

let _bid = 0;
function mkBlock(opts = {}) {
  _bid++;
  return {
    id: 'b_' + Date.now().toString(36) + '_' + _bid,
    kind: opts.kind || 'bullet',
    content: opts.content || '',
    level: opts.level || 0,
    checked: opts.checked != null ? opts.checked : null,
    children: opts.children || [],
    collapsed: !!opts.collapsed,
    annotations: opts.annotations || [],
    workflow: opts.workflow || null,
  };
}

// Convert legacy markdown into typed blocks.
function mnMdToBlocks(md) {
  const lines = md.split('\n');
  const out = [];
  let bulletStack = []; // entries: { block, indent }
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
    const m = content.match(/^(TODO|DOING|DONE|LATER|NOW|WAIT|CANCELLED)\s+(.*)$/);
    if (m) return { workflow: m[1], content: m[2] };
    return { workflow: null, content };
  };

  const flushPara = () => {
    if (paraBuf.length) {
      const text = paraBuf.join(' ');
      const { workflow, content } = splitWorkflow(text);
      currentParentList().push(mkBlock({ kind: 'paragraph', content, workflow }));
      paraBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara(); bulletStack = [];
      const level = h[1].length;
      const { workflow, content } = splitWorkflow(h[2]);
      const blk = mkBlock({ kind: 'heading', level, content, workflow });
      // Pop heading stack to this level's parent
      headingStack = headingStack.slice(0, level - 1);
      // Append under nearest enclosing heading (or top-level)
      currentParentList().push(blk);
      // This heading is now the active container at its level
      headingStack[level - 1] = blk;
      continue;
    }
    if (line.startsWith('> ')) {
      flushPara(); bulletStack = [];
      currentParentList().push(mkBlock({ kind: 'quote', content: line.slice(2) }));
      continue;
    }
    if (/^---+$/.test(line)) {
      flushPara(); bulletStack = [];
      currentParentList().push(mkBlock({ kind: 'divider' }));
      continue;
    }
    const table = MN_TABLE_OPS_OUTLINE.readMarkdownTable && MN_TABLE_OPS_OUTLINE.readMarkdownTable(lines, i);
    if (table) {
      flushPara(); bulletStack = [];
      currentParentList().push(mkBlock({ kind: 'table', content: table.markdown }));
      i = table.endIndex;
      continue;
    }
    // Property line: key:: value — flush as standalone paragraph block (renderer detects and special-cases)
    if (/^[a-zA-Z][a-zA-Z0-9_-]*::\s/.test(line)) {
      flushPara(); bulletStack = [];
      currentParentList().push(mkBlock({ kind: 'paragraph', content: line }));
      continue;
    }
    // Bullet or todo
    const bm = line.match(/^(\s*)-\s+(\[([ xX])\]\s+)?(.*)$/);
    if (bm) {
      flushPara();
      const indent = bm[1].length;
      const isTodo = !!bm[2];
      const checked = bm[3] && /[xX]/.test(bm[3]);
      const { workflow, content } = splitWorkflow(bm[4]);
      const blk = mkBlock({
        kind: isTodo ? 'todo' : 'bullet',
        content,
        checked: isTodo ? checked : null,
        workflow,
      });
      while (bulletStack.length && bulletStack[bulletStack.length - 1].indent >= indent) bulletStack.pop();
      if (bulletStack.length === 0) currentParentList().push(blk);
      else bulletStack[bulletStack.length - 1].block.children.push(blk);
      bulletStack.push({ block: blk, indent });
      continue;
    }
    if (line.trim() === '') {
      flushPara(); bulletStack = [];
      continue;
    }
    bulletStack = [];
    paraBuf.push(line);
  }
  flushPara();
  return out;
}

function mnBlocksToMd(blocks, depth = 0) {
  let out = [];
  const wfPrefix = (b) => b.workflow ? b.workflow + ' ' : '';
  for (const b of blocks) {
    if (b.kind === 'heading') {
      out.push('#'.repeat(b.level || 1) + ' ' + wfPrefix(b) + b.content);
    } else if (b.kind === 'quote') {
      out.push('> ' + wfPrefix(b) + b.content);
    } else if (b.kind === 'divider') {
      out.push('---');
    } else if (b.kind === 'code') {
      out.push('```\n' + b.content + '\n```');
    } else if (b.kind === 'table') {
      out.push(b.content);
    } else if (b.kind === 'bullet' || b.kind === 'todo') {
      const pad = '  '.repeat(depth);
      const chk = b.kind === 'todo' ? (b.checked ? '[x] ' : '[ ] ') : '';
      out.push(pad + '- ' + chk + wfPrefix(b) + b.content);
      if (b.children.length) out.push(mnBlocksToMd(b.children, depth + 1));
    } else {
      // paragraph
      out.push(wfPrefix(b) + b.content);
    }
  }
  return out.filter(Boolean).join('\n');
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
function mnIsListLike(kind) { return kind === 'bullet' || kind === 'todo'; }
// Any block can have children.
function mnCanHaveChildren(kind) { return kind !== 'divider'; }

window.MN_OUTLINE = {
  mkBlock, mnMdToBlocks, mnBlocksToMd, mnWalk,
  mnFindBlock, mnLocate, mnCloneBlocks, mnFlatten,
  mnIsListLike, mnCanHaveChildren,
};
