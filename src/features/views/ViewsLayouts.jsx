// The layout renderers for Views.
//
// v1 reuses the four presentations the Smart Views panel already ships, so a
// definition renders identically in both while the two surfaces coexist.
// Board and calendar arrive in later steps and slot in here.

import {
  mnSmartViewList,
  mnSmartViewTable,
  mnSmartViewCards,
  mnSmartViewTimeline,
} from '../../panels/smartViewsPanel.jsx';

function mnViewsRenderResults({ layout, results, helpers, onOpen, T }) {
  if (layout === 'table') return mnSmartViewTable({ results, helpers, onOpen, T });
  if (layout === 'cards') return mnSmartViewCards({ results, helpers, onOpen, T });
  if (layout === 'timeline') return mnSmartViewTimeline({ results, helpers, onOpen, T });
  return mnSmartViewList({ results, helpers, onOpen, T });
}

export { mnViewsRenderResults };
