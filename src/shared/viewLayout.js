// Which presentation a saved view opens as.
//
// Definitions have carried a `layout` since the v2 format, validated and
// persisted end to end. It lives here rather than in either panel because
// both the Smart Views panel and the Views feature resolve it, and shared/
// is the only layer both are allowed to import.
//
// `board` and `calendar` are valid saved layouts that not every surface can
// draw; callers pass the set they support and get a safe fallback.
const MN_VIEW_LAYOUTS = ['list', 'table', 'cards', 'timeline', 'board'];

function mnViewLayout(definition, supported = MN_VIEW_LAYOUTS, fallback = 'list') {
  const layout = String(definition?.layout || '').toLowerCase();
  return supported.includes(layout) ? layout : fallback;
}

export { MN_VIEW_LAYOUTS, mnViewLayout };
