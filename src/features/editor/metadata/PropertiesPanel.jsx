function panelStyle(T) {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    width: 'min(100%, 520px)',
    boxSizing: 'border-box',
    margin: '0 0 20px',
    padding: '5px 0 8px',
    borderTop: `1px solid ${T.lineSub}`,
    background: 'transparent',
  };
}

function rowStyle(T) {
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(78px, max-content) minmax(150px, 1fr) 32px',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    padding: '3px 2px 3px 8px',
    border: 'none',
    borderBottom: `1px solid color-mix(in oklab, ${T.lineSub} 78%, transparent)`,
    background: 'transparent',
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
  setPropertyValueDraft, addProperty, cleanPropertyKey, onDismiss,
}) {
  const displayedPropertyCount = visibleProperties.length + (hasStatusRow ? 1 : 0);
  const cancelAdding = () => {
    setAddingProperty(false);
    setPropertyKeyDraft('');
    setPropertyValueDraft('');
    if (!displayedPropertyCount) onDismiss?.();
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

  return (
    <div id="mn-properties-panel" data-mn-properties-panel="true" data-mn-surface="inline" style={panelStyle(T)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 6px 8px' }}>
        <span style={{ fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 650, color: T.inkMed }}>Properties</span>
        <span title={`${displayedPropertyCount} properties`} style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{displayedPropertyCount}</span>
        <button
          type="button"
          aria-label="Add property"
          title="Add property"
          disabled={addingProperty}
          onClick={() => setAddingProperty(true)}
          style={{ ...iconButtonStyle(T), marginLeft: 'auto', opacity: addingProperty ? 0.45 : 1 }}>
          +
        </button>
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
        <div style={{ ...rowStyle(T), borderBottomColor: T.accent, background: T.bgSub }}>
          <input aria-label="Property name" value={propertyKeyDraft} onChange={event => setPropertyKeyDraft(event.target.value)} onKeyDown={handleDraftKeyDown} autoFocus placeholder="property" spellCheck={false} style={{ ...valueStyle(T), color: T.inkDim }} />
          <input aria-label="Property value" value={propertyValueDraft} onChange={event => setPropertyValueDraft(event.target.value)} onKeyDown={handleDraftKeyDown} placeholder="value" spellCheck={spellCheck} style={valueStyle(T)} />
          <button type="button" aria-label="Add property" onClick={addProperty} disabled={!cleanPropertyKey(propertyKeyDraft)} title="Add property" style={iconButtonStyle(T)}>+</button>
        </div>
      )}
    </div>
  );
}

export { PropertiesPanel };
