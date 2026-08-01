// Manual card arrangement.
//
// A view's order normally comes from its sort, which is a rule. Dragging a card
// says something a rule cannot: *this* one first. That arrangement is a list of
// row keys held for as long as the view is open.
//
// It is deliberately not written into the saved definition. A definition stores
// a query, and the preference layer validates a fixed set of keys end to end;
// smuggling per-row positions through it would mean a schema change on both
// sides of the IPC boundary for something that goes stale the moment a row
// stops matching. The control strip says so, and Reset order puts the sort back.

function mnViewsRowKey(result) {
  return String(result?.key || result?.id || '');
}

// Rows named in the arrangement come first, in that sequence. A row that
// appeared since — a note written a minute ago — keeps its place in the query's
// order behind them, rather than being silently dropped or shuffled to the top.
function mnViewsOrderApply(results = [], order = null) {
  if (!Array.isArray(order) || !order.length) return results;
  const rank = new Map(order.map((key, index) => [key, index]));
  const placed = [];
  const rest = [];
  results.forEach(result => {
    (rank.has(mnViewsRowKey(result)) ? placed : rest).push(result);
  });
  placed.sort((a, b) => rank.get(mnViewsRowKey(a)) - rank.get(mnViewsRowKey(b)));
  return [...placed, ...rest];
}

// Moving one card rewrites the whole arrangement from what is on screen, so the
// first drag pins every visible row rather than leaving the rest to drift.
function mnViewsOrderMove(order, results = [], dragKey = '', targetKey = '', before = true) {
  const current = Array.isArray(order) ? order : [];
  if (!dragKey || !targetKey || dragKey === targetKey) return current;
  const keys = mnViewsOrderApply(results, current).map(mnViewsRowKey).filter(Boolean);
  if (!keys.includes(dragKey) || !keys.includes(targetKey)) return current;
  const rest = keys.filter(key => key !== dragKey);
  const at = rest.indexOf(targetKey) + (before ? 0 : 1);
  rest.splice(at, 0, dragKey);
  return rest;
}

function mnViewsOrderIsSet(order, results = []) {
  if (!Array.isArray(order) || !order.length) return false;
  // An arrangement that no longer names anything on screen is not one worth
  // announcing — the rows it described have all stopped matching the view.
  const keys = new Set(results.map(mnViewsRowKey));
  return order.some(key => keys.has(key));
}

export { mnViewsOrderApply, mnViewsOrderMove, mnViewsOrderIsSet, mnViewsRowKey };
