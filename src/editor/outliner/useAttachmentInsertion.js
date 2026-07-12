import { platformApi } from '../../platform/index.js';
import attachmentFiles from '../attachmentFiles.js';
import MN_MARKDOWN_INPUT_RULES from '../markdownInputRules.js';

const { useRef } = React;

function useAttachmentInsertion({ block, vaultId, inputRef, onChange, onShowToast }) {
  const latestContentRef = useRef('');
  latestContentRef.current = String(block.content || '');

  const insertAttachmentMarkdown = async (files, start, end) => {
    const { markdowns, descriptors, errors } = await attachmentFiles.mnSaveAttachments(files, {
      bridge: { saveAttachment: platformApi.notes.saveAttachment },
      vaultId,
    });
    if (errors.length) {
      console.error('attachment failed:', errors.join(' '));
    }
    if (!markdowns.length) {
      if (errors.length) onShowToast?.(errors[0]);
      return;
    }
    const value = latestContentRef.current;
    const from = Math.max(0, Math.min(value.length, Number.isFinite(start) ? start : value.length));
    const to = Math.max(from, Math.min(value.length, Number.isFinite(end) ? end : from));
    const before = value.slice(0, from);
    const after = value.slice(to);
    const glueBefore = before && !/\s$/.test(before) ? ' ' : '';
    const glueAfter = after && !/^\s/.test(after) ? ' ' : '';
    const inserted = markdowns.join(' ');
    const nextValue = before + glueBefore + inserted + glueAfter + after;
    latestContentRef.current = nextValue;
    onChange(block.id, nextValue);
    const caret = (before + glueBefore + inserted).length;
    onShowToast?.(errors.length
      ? `${descriptors.length} file${descriptors.length === 1 ? '' : 's'} added; some files skipped`
      : `${descriptors.length} file${descriptors.length === 1 ? '' : 's'} added`);
    setTimeout(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      const position = MN_MARKDOWN_INPUT_RULES.contentOffsetToEditorOffset?.(block, caret) ?? caret;
      textarea.focus();
      textarea.setSelectionRange(position, position);
    }, 0);
  };

  return {
    attachmentFiles,
    blockAcceptsAttachmentDrops: block.kind !== 'code' && block.kind !== 'table',
    insertAttachmentMarkdown,
    latestContentRef,
  };
}

export { useAttachmentInsertion };
