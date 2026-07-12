function panelStyle(T) {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    width: 'min(100%, 520px)',
    boxSizing: 'border-box',
    margin: '0 0 22px',
    padding: 8,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 11,
    background: `linear-gradient(145deg, ${T.bgElevated || T.bg}, color-mix(in oklab, ${T.bgSub} 72%, ${T.bg}))`,
    boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 5%, transparent)`,
  };
}

function rowStyle(T) {
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(78px, max-content) minmax(150px, 1fr) 32px',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    padding: '3px 4px 3px 10px',
    border: `1px solid color-mix(in oklab, ${T.lineSub} 72%, transparent)`,
    borderRadius: 7,
    background: `color-mix(in oklab, ${T.bg} 88%, transparent)`,
  };
}

function keyStyle(T) {
  return {
    fontFamily: 'var(--mn-mono)',
    fontSize: 10,
    fontWeight: 650,
    color: T.inkMed,
    textTransform: 'lowercase',
    letterSpacing: '0.02em',
    padding: '3px 0',
  };
}

function valueStyle(T) {
  return {
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: T.ink,
    fontFamily: 'var(--mn-mono)',
    fontSize: 11.5,
    padding: '4px 2px',
  };
}

function iconButtonStyle(T) {
  return {
    width: 32,
    height: 32,
    border: '1px solid transparent',
    borderRadius: 5,
    background: 'transparent',
    color: T.inkDim,
    cursor: 'pointer',
    fontFamily: 'var(--mn-mono)',
    fontSize: 13,
    lineHeight: 1,
    padding: 0,
  };
}

function PropertiesPanel({
  T, visibleProperties, hasStatusRow, workflowStatus, workflowStates,
  onSetWorkflowStatus, removeProperty, updateProperty, spellCheck, addingProperty,
  setAddingProperty, propertyKeyDraft, setPropertyKeyDraft, propertyValueDraft,
  setPropertyValueDraft, addProperty, cleanPropertyKey,
}) {
  const expanded = hasStatusRow || visibleProperties.length > 0 || addingProperty;
  const displayedPropertyCount = visibleProperties.length + (hasStatusRow ? 1 : 0);
  const cancelAdding = () => {
    setAddingProperty(false);
    setPropertyKeyDraft('');
    setPropertyValueDraft('');
  };
  const handleDraftKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addProperty();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelAdding();
    }
  };

  if (!expanded) return null;

  return (
    <div id="mn-properties-panel" data-mn-properties-panel="true" style={panelStyle(T)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 3px 7px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span aria-hidden="true" style={{
            width: 18, height: 18, borderRadius: 5,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: T.accentSoft, color: T.accent,
            fontFamily: 'var(--mn-mono)', fontSize: 10, fontWeight: 700,
          }}>#</span>
          <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 700, color: T.inkMed, letterSpacing: '0.02em' }}>Properties</span>
        </div>
        <span title={`${displayedPropertyCount} visible properties`} style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{displayedPropertyCount}</span>
      </div>

      {hasStatusRow && (
        <div style={rowStyle(T)}>
          <div style={keyStyle(T)}>status::</div>
          <select aria-label="Status property" value={workflowStatus || ''} onChange={event => onSetWorkflowStatus?.(event.target.value || null)} spellCheck={false} style={{
            ...valueStyle(T), width: 'auto', minWidth: 110, maxWidth: 180,
            border: `1px solid ${T.lineSub}`, borderRadius: 5, padding: '3px 24px 3px 7px', color: T.inkMed,
          }}>
            <option value="">None</option>
            {workflowStates.map(state => <option key={state.id} value={state.id}>{state.id}</option>)}
          </select>
          <button type="button" onClick={() => removeProperty('status')} title="Clear status" aria-label="Clear status property" style={iconButtonStyle(T)}>x</button>
        </div>
      )}

      {visibleProperties.map(property => (
        <div key={`${property.block.id}:${property.key}`} style={rowStyle(T)}>
          <div style={keyStyle(T)}>{property.key}::</div>
          <input aria-label={`${property.key} property`} value={property.value || ''} onChange={event => updateProperty(property.key, event.target.value)} spellCheck={spellCheck} style={valueStyle(T)} />
          <button type="button" onClick={() => removeProperty(property.key)} title={`Remove ${property.key}`} aria-label={`Remove ${property.key} property`} style={iconButtonStyle(T)}>x</button>
        </div>
      ))}

      {addingProperty && (
        <div style={{ ...rowStyle(T), borderColor: T.accent, background: T.bg }}>
          <input aria-label="Property name" value={propertyKeyDraft} onChange={event => setPropertyKeyDraft(event.target.value)} onKeyDown={handleDraftKeyDown} autoFocus placeholder="property" spellCheck={false} style={{ ...valueStyle(T), color: T.inkDim }} />
          <input aria-label="Property value" value={propertyValueDraft} onChange={event => setPropertyValueDraft(event.target.value)} onKeyDown={handleDraftKeyDown} placeholder="value" spellCheck={spellCheck} style={valueStyle(T)} />
          <button type="button" aria-label="Add property" onClick={addProperty} disabled={!cleanPropertyKey(propertyKeyDraft)} title="Add property" style={iconButtonStyle(T)}>+</button>
        </div>
      )}
    </div>
  );
}

export { PropertiesPanel };
