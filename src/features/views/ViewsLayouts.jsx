// The layout renderers for Views.
//
// v1 borrowed the Smart Views panel's four presentations so a definition drew
// identically in both while the surfaces coexisted. Views has since grown
// things a dashboard cannot have — a clickable row, an editable card, an
// arrangement you made by hand — so list, cards and timeline are its own.
// Smart Views keeps its renderers untouched; the shared per-result readers
// (`mnSmartViewResultDate` and friends) still describe a row identically.
//
// Table, board and calendar are routed by the panel, which has the definition,
// the sort and the planner they each need.

import { mnViewsRenderCards } from './ViewsCards.jsx';
import { mnViewsRenderList, mnViewsRenderTimeline } from './ViewsList.jsx';

function mnViewsRenderResults({ layout, ...props }) {
  if (layout === 'cards') return mnViewsRenderCards(props);
  if (layout === 'timeline') return mnViewsRenderTimeline(props);
  return mnViewsRenderList(props);
}

export { mnViewsRenderResults };
