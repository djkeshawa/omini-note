// Soft-break codec — the on-disk encoding of a Shift+Enter line break inside a
// single block's content.
//
// A break is written as CommonMark's hard line break: a trailing backslash on
// the broken line. Two trailing spaces were rejected because they are
// invisible, and other editors — and trimEnd() in the writer — strip them; a
// bare continuation line cannot be told apart from a genuinely new paragraph.
//
// TWO INDEPENDENT DEFENCES, both required:
//   (a) Escape on write, count on read. Every line's own trailing backslash run
//       is doubled first, so the marker is always the odd one out and a line
//       ending in a real backslash can never be read as a marked one.
//   (b) Never fold into a block construct. Even an odd run does not fold when
//       the next line opens a heading, list item, quote, fence, table, divider,
//       property line or ::: block. This is what protects the bytes VispNote
//       0.2.5 wrote before markers existed.
// (a) alone still breaks legacy files; (b) alone still breaks fresh
// round-trips.
//
// ONLY ESCAPED KINDS MAY BE DECODED. The writer puts paragraph, bullet,
// ordered, todo and quote content through `mnSoftBreaks`. Heading, table,
// divider, fenced code and plot-points are emitted raw, so running this codec
// over them would halve backslash runs nobody doubled — that is how
// `## notes in C:\` came back as prose. `mnMdToBlocks` therefore runs the
// reader half AFTER every raw-kind branch and BEFORE every escaped-kind
// branch. `renderBlocks` in lib/exportHtml.js is a second implementation of
// this same rule; change one and you must change the other.

import MN_TABLE_OPS_OUTLINE from './tableOps.js';

// One on-disk line the reader would take as the start of a new block.
const MN_MD_CONSTRUCT_LINE = /^(?:#{1,6}\s|\s*(?:-\s+|\d+[.)]\s+)|>\s|`{3,}|\||---+$|:::|[^\S\n]*[a-zA-Z][a-zA-Z0-9_-]*::)/;

const mnTrailingRun = (line) => (String(line ?? '').match(/\\+$/) || [''])[0].length;

// A table may open on a pipe-less row, which no prefix pattern can spot on its
// own — only the separator row underneath identifies it. Ask the real table
// reader rather than guessing, so a fold can never swallow a table's first row.
const mnStartsTable = (lines, i) => !!(MN_TABLE_OPS_OUTLINE.readMarkdownTable
  && MN_TABLE_OPS_OUTLINE.readMarkdownTable(lines, i));

// An odd run means the last backslash is the marker the writer appended — but
// only if the next line can actually be folded in.
const mnFoldsNext = (run, lines, i) => {
  const next = lines[i + 1];
  return run % 2 === 1 && next != null && next.trim() !== ''
    && !MN_MD_CONSTRUCT_LINE.test(next) && !mnStartsTable(lines, i + 1);
};

// Folding: drop the marker, halve what is left. Not folding: an even run is the
// content's own doubled run, so halve it; an odd one is a line written before
// markers existed, so keep every backslash exactly as it is.
function mnTrailingText(line, run, fold) {
  if (run % 2 === 1 && !fold) return line;
  return line.slice(0, line.length - run) + '\\'.repeat(fold ? (run - 1) / 2 : run / 2);
}

// Only a continuation line that would read as its own block carries the extra
// leading backslash, so adding and stripping it are exact inverses.
const mnEscapeConstruct = (line) => (MN_MD_CONSTRUCT_LINE.test(line.replace(/^\\+/, '')) ? '\\' + line : line);
const mnUnescapeConstruct = (line) => (line.startsWith('\\')
  && MN_MD_CONSTRUCT_LINE.test(line.replace(/^\\+/, '')) ? line.slice(1) : line);

// Reader half: fold `lines[start]` and its marked continuations into one string
// carrying real \n characters. Call only for a kind the writer escaped.
function mnFoldSoftBreaks(lines, start) {
  let i = start;
  let run = mnTrailingRun(lines[i]);
  let fold = mnFoldsNext(run, lines, i);
  let text = mnTrailingText(lines[i], run, fold);
  while (fold) {
    const next = lines[++i];
    run = mnTrailingRun(next);
    fold = mnFoldsNext(run, lines, i);
    text += '\n' + mnUnescapeConstruct(mnTrailingText(next, run, fold));
  }
  return { text, endIndex: i };
}

// Writer half.
//
// NORMALIZATION: a content-final newline is dropped, so 'a\n' round-trips to
// 'a'. Under pre-wrap it renders as a blank line the user cannot see, confirm,
// or notice losing, and keeping it would mean writing a marker with only a
// blank line to fold into — the one signal a real paragraph break uses. The
// trailing run to drop is every final line holding no visible character, not
// just empty ones: 'a\n ' stranded the bytes 'a\', a backslash the user never
// typed, which the next save then doubled. An untouched note must write the
// same bytes every time.
function mnSoftBreaks(text) {
  const lines = String(text ?? '').replace(/(?:\n[^\S\n]*)+$/, '').split('\n');
  return lines.map((line, idx) => {
    const escaped = (idx ? mnEscapeConstruct(line) : line).replace(/\\+$/, (run) => run + run);
    return idx === lines.length - 1 ? escaped : escaped + '\\';
  }).join('\n');
}

export {
  MN_MD_CONSTRUCT_LINE, mnEscapeConstruct, mnFoldSoftBreaks, mnFoldsNext,
  mnSoftBreaks, mnStartsTable, mnTrailingRun, mnTrailingText, mnUnescapeConstruct,
};
