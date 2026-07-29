// The Conditions menu, built to the v2 prototype.
//
// Scope picked the notes; this decides which of their rows survive. Each row
// is one condition on the prototype's grid — join word, property key,
// operator, value, remove — so a stack of them reads as a sentence down the
// page rather than as a form.
//
// The key list is the same discovery the Columns menu uses: only keys someone
// actually wrote. A condition on a key nothing carries would silently return
// nothing, so it is not offerable in the first place.
//
// Adding starts a row on the most common key rather than asking which one
// first — the row carries its own key picker, so the choice is one click away
// either way and there is something on screen to correct.

import { DS_RADIUS, dsMachineStyle } from '../../shared/designSystem.js';
import { MN_VIEW_CONDITION_OPS, mnViewsConditions, mnViewsConditionsMatch, mnViewsConditionNeedsValue } from './viewsConditions.js';

const MN_CONDITION_GRID = '46px 138px 108px minmax(0, 1fr) 26px';

function mnConditionControl(T) {
  return {
    height: 26, width: '100%', minWidth: 0, padding: '0 7px',
    borderRadius: DS_RADIUS.icon,
    border: `1px solid ${T.lineSub}`,
    background: T.bg, color: T.ink,
    fontFamily: 'var(--mn-ui)', fontSize: 11.5, outline: 'none',
  };
}

function MatchToggle({ match, onChange, T }) {
  const seg = (value, label) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={match === value}
      onClick={() => onChange?.(value)}
      style={{
        height: 22, padding: '0 9px',
        borderRadius: DS_RADIUS.icon,
        border: `1px solid ${match === value ? T.selLine : 'transparent'}`,
        background: match === value ? T.selBg : 'transparent',
        color: match === value ? T.ink : T.inkMed,
        fontFamily: 'var(--mn-ui)', fontSize: 11.5,
        fontWeight: match === value ? 600 : 400, cursor: 'pointer',
      }}>{label}</button>
  );
  return (
    <span role="tablist" aria-label="Match" style={{
      display: 'inline-flex', gap: 2, padding: 2,
      borderRadius: DS_RADIUS.control,
      background: T.bg, border: `1px solid ${T.lineSub}`,
    }}>
      {seg('all', 'all of them')}
      {seg('any', 'any of them')}
    </span>
  );
}

function ConditionRow({ condition, index, keys, onUpdate, onRemove, T }) {
  const needsValue = mnViewsConditionNeedsValue(condition.op);
  // A key that has since vanished from every note still has to be listed, or
  // a condition could not be read back or corrected.
  const options = keys.includes(condition.key) ? keys : [condition.key, ...keys];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: MN_CONDITION_GRID,
      alignItems: 'center', gap: 7, padding: '4px 9px',
    }}>
      <span style={{ fontSize: 11.5, color: T.inkDim }}>{index === 0 ? 'Where' : 'and'}</span>

      <select
        aria-label={`Condition ${index + 1} property`}
        value={condition.key}
        onChange={event => onUpdate?.(index, { key: event.target.value })}
        style={{ ...mnConditionControl(T), ...dsMachineStyle(T, T.ink), fontSize: 11 }}>
        {options.map(key => <option key={key} value={key}>{key}</option>)}
      </select>

      <select
        aria-label={`Condition ${index + 1} test`}
        value={condition.op}
        onChange={event => onUpdate?.(index, { op: event.target.value })}
        style={mnConditionControl(T)}>
        {MN_VIEW_CONDITION_OPS.map(item => <option key={item.op} value={item.op}>{item.label}</option>)}
      </select>

      {needsValue ? (
        <input
          aria-label={`Condition ${index + 1} value`}
          placeholder="value, or several separated by commas"
          value={condition.value}
          onChange={event => onUpdate?.(index, { value: event.target.value })}
          style={mnConditionControl(T)}
        />
      ) : (
        <span style={{ fontSize: 11.5, color: T.inkDim }}>nothing to compare against</span>
      )}

      <button
        type="button"
        aria-label={`Remove condition ${index + 1}`}
        title="Remove this condition"
        onClick={() => onRemove?.(index)}
        style={{
          width: 22, height: 22, padding: 0, justifySelf: 'end',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', borderRadius: DS_RADIUS.icon,
          background: 'transparent', color: T.inkDim, cursor: 'pointer',
        }}>
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M3 3L9 9M9 3L3 9" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function ViewsConditionsMenu({ definition = {}, keys = [], onAdd, onUpdate, onRemove, onMatch, onClear, T }) {
  const conditions = mnViewsConditions(definition);
  const match = mnViewsConditionsMatch(definition);

  return (
    <div
      data-mn-views-conditions="true"
      role="dialog"
      aria-label="Conditions"
      style={{
        position: 'absolute', top: 32, left: 0, zIndex: 60, width: 512,
        maxHeight: 460, overflowY: 'auto',
        background: T.bgElevated || T.bg,
        border: `1px solid ${T.line}`,
        borderRadius: DS_RADIUS.row,
        boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
        padding: 5,
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
        padding: '6px 9px 8px',
      }}>
        <span style={{
          fontFamily: 'var(--mn-serif, var(--mn-ui))', fontSize: 12.5, color: T.inkMed,
        }}>Keep a row when it matches</span>
        <MatchToggle match={match} onChange={onMatch} T={T} />
      </div>

      {conditions.length ? conditions.map((condition, index) => (
        <ConditionRow
          key={`${condition.key}-${index}`}
          condition={condition}
          index={index}
          keys={keys}
          onUpdate={onUpdate}
          onRemove={onRemove}
          T={T}
        />
      )) : (
        <div style={{ padding: '2px 9px 8px', fontSize: 11.5, color: T.inkDim, lineHeight: 1.45 }}>
          No conditions yet, so every row that scope let through is showing.
        </div>
      )}

      <div style={{
        marginTop: 6, padding: '8px 9px 4px',
        borderTop: `1px solid ${T.lineSub}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {keys.length ? (
          <button
            type="button"
            aria-label="Add condition"
            onClick={() => onAdd?.(keys[0])}
            style={{
              height: 24, padding: '0 9px',
              borderRadius: DS_RADIUS.control,
              border: `1px solid ${T.lineSub}`, background: T.bg, color: T.ink,
              fontFamily: 'var(--mn-ui)', fontSize: 11.5, cursor: 'pointer',
            }}>Add condition</button>
        ) : (
          <span style={{ fontSize: 11.5, color: T.inkDim, lineHeight: 1.45 }}>
            Nothing to test yet. Write <span style={{ ...dsMachineStyle(T, T.inkMed), fontSize: 11 }}>owner:: sam</span> in
            a note and it becomes something you can filter on.
          </span>
        )}
        <span style={{ flex: 1 }} />
        {conditions.length > 0 && (
          <button type="button" onClick={onClear} style={{
            height: 24, padding: '0 9px',
            borderRadius: DS_RADIUS.control,
            border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 11.5, cursor: 'pointer',
          }}>Clear all</button>
        )}
      </div>
    </div>
  );
}

export { ViewsConditionsMenu, MN_CONDITION_GRID };
