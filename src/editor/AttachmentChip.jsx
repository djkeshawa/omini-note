import { platformApi } from '../platform/index.js';
import ATTACHMENT_DESCRIPTOR from '../shared/attachmentDescriptor.js';

const { useEffect, useMemo, useState } = React;
const descriptorCache = new Map();

function cachedDescriptor(vaultId, fileName) {
  const key = `${vaultId}\n${fileName}`;
  if (!descriptorCache.has(key)) {
    const request = Promise.resolve().then(
      () => platformApi.notes.describeAttachment(vaultId, fileName)
    ).then(result => {
      const descriptor = result?.ok ? ATTACHMENT_DESCRIPTOR.normalizeAttachmentDescriptor(result.value) : null;
      if (!descriptor) throw new Error(result?.error || 'Attachment is unavailable');
      return descriptor;
    }).catch(error => {
      if (descriptorCache.get(key) === request) descriptorCache.delete(key);
      throw error;
    });
    descriptorCache.set(key, request);
    if (descriptorCache.size > 500) descriptorCache.delete(descriptorCache.keys().next().value);
  }
  return descriptorCache.get(key);
}

function extensionTypeLabel(fileName) {
  return ATTACHMENT_DESCRIPTOR.classifyAttachment(fileName, '')?.typeLabel || 'File';
}

function AttachmentChip({ label, url, vaultId, T }) {
  const fileName = String(url || '').slice('attachments/'.length);
  const displayName = String(label || fileName || 'Attachment').slice(0, 160);
  const [state, setState] = useState({ descriptor: null, error: '' });
  const fallbackType = useMemo(() => extensionTypeLabel(fileName), [fileName]);

  useEffect(() => {
    let active = true;
    if (!vaultId || !fileName) {
      setState({ descriptor: null, error: 'Attachment is unavailable' });
      return () => { active = false; };
    }
    setState({ descriptor: null, error: '' });
    cachedDescriptor(vaultId, fileName).then(descriptor => {
      if (active) setState({ descriptor, error: '' });
    }).catch(error => {
      if (active) setState({ descriptor: null, error: error?.message || 'Attachment is unavailable' });
    });
    return () => { active = false; };
  }, [fileName, vaultId]);

  const descriptor = state.descriptor;
  const meta = state.error
    ? state.error
    : (descriptor
      ? `${descriptor.typeLabel} · ${ATTACHMENT_DESCRIPTOR.formatAttachmentSize(descriptor.size)}`
      : `${fallbackType} · Checking…`);

  const open = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!descriptor) return;
    try {
      const result = await platformApi.notes.openAttachment(vaultId, descriptor.fileName);
      if (!result?.ok) setState(current => ({ ...current, error: result?.error || 'Could not open attachment' }));
    } catch (error) {
      setState(current => ({ ...current, error: error?.message || 'Could not open attachment' }));
    }
  };

  return (
    <span
      data-mn-attachment-chip="true"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 9, maxWidth: 'min(100%, 460px)',
        margin: '3px 2px', padding: '7px 8px 7px 10px', verticalAlign: 'middle',
        color: T.ink, background: T.bgSub, border: `1px solid ${T.lineSub}`, borderRadius: 8,
      }}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" style={{ flex: '0 0 auto', color: T.inkDim }}>
        <path d="M7.4 10.9 12 6.3a2.4 2.4 0 0 1 3.4 3.4l-5.8 5.8a4 4 0 0 1-5.7-5.7l6.2-6.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <span style={{ minWidth: 0, display: 'grid', lineHeight: 1.15 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 560 }}>{displayName}</span>
        <span style={{ marginTop: 3, color: state.error ? T.warn : T.inkDim, fontSize: 10.5, fontFamily: 'var(--mn-mono)' }}>{meta}</span>
      </span>
      <button
        type="button"
        disabled={!descriptor}
        aria-label={`Open attachment ${displayName}`}
        title={state.error || `Open ${displayName}`}
        onMouseDown={event => event.stopPropagation()}
        onClick={open}
        style={{
          minWidth: 44, minHeight: 32, padding: '0 9px', marginLeft: 2,
          border: `1px solid ${T.line}`, borderRadius: 6,
          color: descriptor ? T.accent : T.inkDim, background: T.bg,
          cursor: descriptor ? 'pointer' : 'default', font: 'inherit', fontSize: 11.5,
        }}>
        Open
      </button>
    </span>
  );
}

export { AttachmentChip };
