// FTS5 query construction for note search.
//
// Two properties of the index shape this file. The tokenizer is `porter`, so
// "negotiation" is stored under the stem "negoti"; and the last term of a query
// gets a prefix match so search-as-you-type feels live. Those fight each other:
// a prefix longer than the stem can never match it, so a note vanishes partway
// through the word you are typing and reappears when you finish it.
//
// Rather than broaden every query, we escalate only when a query finds nothing.
// Each rung can only turn an empty result non-empty, so a query that already
// works is never made noisier.

const MAX_FTS_QUERY_CHARS = 1000;
const MAX_FTS_TERMS = 32;
// Porter stems are a few characters shorter than the word. Backing off further
// than this stops narrowing the search usefully.
const MAX_PREFIX_BACKOFF = 4;
const MIN_PREFIX_LENGTH = 3;

function ftsTerms(query) {
  const trimmed = String(query ?? '').replace(/\0/g, ' ').trim().slice(0, MAX_FTS_QUERY_CHARS);
  if (!trimmed) return [];
  return trimmed
    .split(/\s+/)
    .map(term => term.replace(/"/g, ''))
    .filter(Boolean)
    .slice(0, MAX_FTS_TERMS);
}

function joinTerms(terms, { prefixLength = null, operator = 'AND' } = {}) {
  if (!terms.length) return null;
  const quoted = terms.map((term, index) => {
    const isLast = index === terms.length - 1;
    if (!isLast) return `"${term}"`;
    const text = prefixLength === null ? term : term.slice(0, prefixLength);
    return text ? `"${text}"*` : null;
  }).filter(Boolean);
  return quoted.length ? quoted.join(` ${operator} `) : null;
}

// The strict query, then progressively shorter prefixes on the term being typed,
// then "any word" as a last resort.
function queryLadder(query) {
  const terms = ftsTerms(query);
  if (!terms.length) return [];
  const rungs = [joinTerms(terms)];
  const last = terms[terms.length - 1];
  const floor = Math.max(MIN_PREFIX_LENGTH, last.length - MAX_PREFIX_BACKOFF);
  for (let length = last.length - 1; length >= floor; length--) {
    rungs.push(joinTerms(terms, { prefixLength: length }));
  }
  if (terms.length > 1) rungs.push(joinTerms(terms, { operator: 'OR' }));
  return rungs.filter(Boolean);
}

// Runs `execute` against each rung until one returns rows. `execute` is expected
// to return an array and to swallow its own malformed-query errors.
function searchWithFallback(query, execute) {
  for (const fts of queryLadder(query)) {
    const rows = execute(fts);
    if (rows && rows.length) return rows;
  }
  return [];
}

module.exports = {
  ftsTerms,
  queryLadder,
  searchWithFallback,
  MAX_FTS_QUERY_CHARS,
  MAX_FTS_TERMS,
};
