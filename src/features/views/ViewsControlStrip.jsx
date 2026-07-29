// The control strip: what one row in this view is, which notes it looks at,
// which columns it shows, and how it is drawn.
//
// Split out of ViewsPanel so the panel stays a shell. Everything here is
// presentational — it reads the draft-merged definition and reports clicks
// upward; the panel decides what a click means.

import { DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import { MN_VIEW_LAYOUTS } from '../../shared/viewLayout.js';
import { mnViewChipStyle } from './ViewsChrome.jsx';
import { ViewsColumnsMenu } from './ViewsColumnsPanel.jsx';
import { ViewsScopeMenu } from './ViewsScopePanel.jsx';
import { ViewsConditionsMenu } from './ViewsConditionsPanel.jsx';
import { mnViewsScopeSummary, mnViewsScopeIsSet } from './viewsScope.js';
import { mnViewsConditionsSummary, mnViewsConditions } from './viewsConditions.js';

// mnSentenceCase only rewrites ALL-CAPS strings, so it leaves a lowercase
// layout id alone. These are labels, not machine values, so they get a capital.
function mnViewLayoutLabel(mode) {
  const value = String(mode || '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ViewsControlStrip({
  definition = {}, tags = [], notes = [], catalogue = [], visibleColumns = [],
  rowCount = 0, totalCount = 0, filtered = false, layout = 'list',
  conditionKeys = [],
  scopeOpen, columnsOpen, conditionsOpen,
  onToggleScopeMenu, onToggleColumnsMenu, onToggleConditionsMenu,
  onToggleTag, onToggleLink, onClearScope, onToggleColumn, onMoveColumn,
  onAddCondition, onUpdateCondition, onRemoveCondition, onConditionsMatch, onClearConditions,
  onLayout, T,
}) {
  return (
    <div style={{
      height: 48, flexShrink: 0, boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', gap: 7, padding: '0 20px',
      borderBottom: `1px solid ${T.lineSub}`, background: T.bgSub,
      position: 'relative', zIndex: 1,
    }}>
      <span style={mnViewChipStyle(false, T)} title="What one row in this view is">
        Rows
        <span style={{ fontWeight: 600, color: T.ink }}>{String(definition?.type || 'notes')}</span>
      </span>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          aria-label="Scope"
          aria-expanded={scopeOpen}
          title="Which notes this view looks at before anything else"
          onClick={() => onToggleScopeMenu?.()}
          style={mnViewChipStyle(scopeOpen || mnViewsScopeIsSet(definition), T)}>
          Scope
          <span style={{ fontWeight: 600, color: T.ink }}>{mnViewsScopeSummary(definition)}</span>
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {scopeOpen && (
          <ViewsScopeMenu
            definition={definition}
            tags={tags}
            notes={notes}
            onToggleTag={tag => onToggleTag?.(tag)}
            onToggleLink={title => onToggleLink?.(title)}
            onClear={() => onClearScope?.()}
            T={T}
          />
        )}
      </span>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          aria-label="Conditions"
          aria-expanded={conditionsOpen}
          title="Which rows survive, once scope has picked the notes"
          onClick={() => onToggleConditionsMenu?.()}
          style={mnViewChipStyle(conditionsOpen || mnViewsConditions(definition).length > 0, T)}>
          Conditions
          <span style={{ fontWeight: 600, color: T.ink }}>{mnViewsConditionsSummary(definition)}</span>
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {conditionsOpen && (
          <ViewsConditionsMenu
            definition={definition}
            keys={conditionKeys}
            onAdd={key => onAddCondition?.(key)}
            onUpdate={(index, patch) => onUpdateCondition?.(index, patch)}
            onRemove={index => onRemoveCondition?.(index)}
            onMatch={value => onConditionsMatch?.(value)}
            onClear={() => onClearConditions?.()}
            T={T}
          />
        )}
      </span>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          aria-label="Columns"
          aria-expanded={columnsOpen}
          title="Which columns the table shows, and where each one comes from"
          onClick={() => onToggleColumnsMenu?.()}
          style={mnViewChipStyle(columnsOpen, T)}>
          Columns
          <span style={{ ...dsMachineStyle(T, T.ink), fontSize: 11 }}>{visibleColumns.length}</span>
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {columnsOpen && (
          <ViewsColumnsMenu
            catalogue={catalogue}
            visible={visibleColumns}
            total={rowCount}
            onToggle={key => onToggleColumn?.(key)}
            onMove={(key, delta) => onMoveColumn?.(key, delta)}
            T={T}
          />
        )}
      </span>
      <span aria-hidden="true" style={{ width: 1, height: 20, background: T.lineSub, margin: '0 3px' }} />
      <span style={{ ...dsMachineStyle(T), fontSize: 11 }}>
        {rowCount}{filtered ? ` of ${totalCount}` : ''}
      </span>
      <span style={{ flex: 1 }} />
      <div role="tablist" aria-label="Layout" style={{
        display: 'flex', padding: 2, gap: 2,
        borderRadius: DS_RADIUS.control,
        background: T.bg, border: `1px solid ${T.lineSub}`,
      }}>
        {MN_VIEW_LAYOUTS.map(mode => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={layout === mode}
            onClick={() => onLayout?.(mode)}
            style={{
              height: 24, padding: '0 11px',
              borderRadius: DS_RADIUS.icon,
              border: `1px solid ${layout === mode ? T.selLine : 'transparent'}`,
              background: layout === mode ? T.selBg : 'transparent',
              color: layout === mode ? T.ink : T.inkMed,
              fontFamily: 'var(--mn-ui)', fontSize: 12,
              fontWeight: layout === mode ? 600 : 400,
              cursor: 'pointer',
            }}>{mnViewLayoutLabel(mode)}</button>
        ))}
      </div>
    </div>
  );
}

export { ViewsControlStrip, mnViewLayoutLabel };
