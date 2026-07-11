function WorkflowStateManager({ workflowStates, removeWorkflowState, stateDraft, setStateDraft, addWorkflowState, normalizeStateId, T }) {
  return (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgSub,
      padding: 9,
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: 'var(--mn-mono)',
        fontSize: 10,
        color: T.inkDim,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginRight: 2,
      }}>Columns</span>
      {(workflowStates || []).map(state => (
        <span key={state.id} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 3px 2px 6px',
          borderRadius: 4,
          background: state.bg,
          color: state.color,
          fontFamily: 'var(--mn-mono)',
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}>
          {state.id}
          <button
            type="button"
            title={`Remove ${state.id}`}
            onClick={() => removeWorkflowState(state.id)}
            style={{
              width: 16,
              height: 16,
              border: 'none',
              borderRadius: 3,
              background: 'transparent',
              color: 'currentColor',
              cursor: 'pointer',
              opacity: 0.75,
              padding: 0,
              lineHeight: 1,
            }}>x</button>
        </span>
      ))}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginLeft: 'auto',
        minWidth: 190,
      }}>
        <input
          value={stateDraft}
          onChange={(e) => setStateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addWorkflowState();
            }
          }}
          placeholder="new column"
          style={{
            minWidth: 0,
            flex: 1,
            height: 26,
            border: `1px solid ${T.line}`,
            borderRadius: 5,
            background: T.bg,
            color: T.ink,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            padding: '0 8px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={addWorkflowState}
          disabled={!normalizeStateId(stateDraft)}
          style={{
            height: 26,
            padding: '0 9px',
            borderRadius: 5,
            border: `1px solid ${T.line}`,
            background: normalizeStateId(stateDraft) ? T.ink : T.bg,
            color: normalizeStateId(stateDraft) ? T.bg : T.inkDim,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            cursor: normalizeStateId(stateDraft) ? 'pointer' : 'default',
          }}>Add</button>
      </div>
    </div>
  );
}

function ArchivedWorkflowNotes({ archivedNotes, onOpen, archiveNote, T }) {
  return (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgSub,
      padding: 10,
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: T.inkDim,
        }}>Archived from workflow</div>
        <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
          {archivedNotes.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {archivedNotes.map(note => (
          <div key={note.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 10px',
            border: `1px solid ${T.lineSub}`,
            borderRadius: 6,
            background: T.bg,
          }}>
            <div onClick={() => onOpen(note.id)} style={{
              flex: 1,
              minWidth: 0,
              cursor: 'pointer',
            }}>
              <div style={{
                fontFamily: 'var(--mn-ui)',
                fontSize: 13.5,
                fontWeight: 600,
                color: T.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{note.title || 'Untitled'}</div>
              <div style={{
                marginTop: 3,
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
                color: T.inkDim,
              }}>{note.workflow || 'workflow'} note status</div>
            </div>
            <button
              type="button"
              onClick={() => archiveNote(note.id, false)}
              style={{
                height: 26,
                padding: '0 9px',
                borderRadius: 5,
                border: `1px solid ${T.line}`,
                background: T.bg,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
                cursor: 'pointer',
                flexShrink: 0,
              }}>
              Restore
            </button>
          </div>
        ))}
        {!archivedNotes.length && (
          <div style={{
            padding: 14,
            textAlign: 'center',
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            color: T.inkDim,
            fontStyle: 'italic',
          }}>No archived workflow notes</div>
        )}
      </div>
    </div>
  );
}

export { WorkflowStateManager, ArchivedWorkflowNotes };
