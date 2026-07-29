import { platformApi } from '../platform/index.js';
import { MN_AI_NOTES_TIMEOUT_MS, mnSupportingNovelNotes, mnSupportingNotesEditInstruction, mnAiCurrentNoteMarkdown, mnAiCleanVirtualToolArgs, mnAskAiJobId, mnAiBuildMarkdownPreview } from './aiModels.js';
import { mnAiNoteEditOwner, mnAiValidateNoteEditOwner } from './aiOwnership.js';

function createVirtualWriteActions({ vaultId, currentNote, setActiveAction, allNotes, onApplyNoteBodies, onApplyCurrentPageBody, aiRuntime }) {
  const askEdit = async ({ text, instruction, scope, jobId }) => {
      if (!platformApi.ai?.edit) throw new Error('AI editing is not available');
      const r = await platformApi.ai.edit({ text, instruction, scope, jobId });
      if (!r.ok) throw new Error(r.error || 'AI action failed');
      if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI action failed');
      return r.value.text;
    };
  
    const askNotes = async ({ prompt, jobId }) => {
      if (!platformApi.ai?.ask) throw new Error('AI notes search is not available');
      const r = await platformApi.ai.ask(vaultId, prompt, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS });
      if (!r.ok) throw new Error(r.error || 'AI action failed');
      if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI action failed');
      return {
        answer: String(r.value?.answer || '').trim(),
        sources: r.value?.sources || [],
      };
    };
  
    const askVaultSummary = async ({ prompt, jobId }) => {
      if (platformApi.ai?.summarizeVault) {
        setActiveAction('Summarizing notes in batches...');
        const r = await platformApi.ai.summarizeVault(vaultId, prompt, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS });
        if (!r.ok) throw new Error(r.error || 'AI summary failed');
        if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI summary failed');
        return {
          answer: String(r.value?.answer || '').trim(),
          sources: r.value?.sources || [],
        };
      }
      return askNotes({ prompt, jobId });
    };
  
    const runSupportingNotesEdit = async ({ q, action = 'improve', instruction = '', jobId }) => {
      const targets = mnSupportingNovelNotes(allNotes);
      if (!targets.length) {
        return {
          answer: 'I could not find any supporting novel notes to update. Supporting notes need a novel support tag such as #novel-character, #novel-location, #novel-plot, #novel-research, or #novel-revision.',
          sources: [],
          clarify: true,
        };
      }
      if (!onApplyNoteBodies) {
        return {
          answer: 'I cannot update all supporting notes because this build only exposes the current page editor to Ask AI.',
          sources: [],
          clarify: true,
        };
      }
      if (!platformApi.ai?.edit) {
        return {
          answer: 'I cannot update all supporting notes because AI editing is not available.',
          sources: [],
          clarify: true,
        };
      }
  
      const editAction = action === 'format' ? 'format' : 'improve';
      const editInstruction = mnSupportingNotesEditInstruction(editAction, instruction || q);
      const updates = [];
      let skippedEmpty = 0;
      for (let index = 0; index < targets.length; index++) {
        const note = targets[index];
        const body = mnAiCurrentNoteMarkdown(note);
        if (!String(body || '').trim()) {
          skippedEmpty += 1;
          continue;
        }
        setActiveAction(`Updating supporting notes ${index + 1}/${targets.length}...`);
        const edited = await askEdit({
          scope: `supporting novel note: ${note.title || 'Untitled'}`,
          instruction: editInstruction,
          text: body,
          jobId,
        });
        const cleanEdited = String(edited || '').trim();
        if (cleanEdited) updates.push({ id: note.id, title: note.title || 'Untitled', body: cleanEdited });
      }
  
      if (!updates.length) {
        const emptyText = skippedEmpty ? ` I skipped ${skippedEmpty} empty supporting note${skippedEmpty === 1 ? '' : 's'}.` : '';
        return {
          answer: `I found supporting notes, but there was no editable note body to update.${emptyText}`.trim(),
          sources: [],
          clarify: true,
        };
      }
  
      const applied = onApplyNoteBodies(updates);
      const appliedCount = Number.isFinite(Number(applied)) ? Number(applied) : updates.length;
      const skippedText = skippedEmpty ? ` Skipped ${skippedEmpty} empty supporting note${skippedEmpty === 1 ? '' : 's'}.` : '';
      return {
        answer: `Updated ${appliedCount} supporting note${appliedCount === 1 ? '' : 's'}.${skippedText}`,
        sources: updates.map(update => ({ id: update.id, title: update.title, snippet: update.body.slice(0, 200) })),
        action: true,
      };
    };
  
    const makeVirtualWriteReview = async (name, args = {}, q = '') => {
      const inputArgs = { ...(args || {}) };
      if (!String(inputArgs.instruction || '').trim() && q) inputArgs.instruction = q;
      const cleanArgs = mnAiCleanVirtualToolArgs(name, inputArgs);
      const instruction = String(cleanArgs.instruction || q || '').trim();
      if (!instruction) throw new Error('Edit instruction is empty');
      if (name === 'edit-current-page') {
        if (!currentNote) throw new Error('No current page is open to edit');
        if (!onApplyCurrentPageBody) throw new Error('Current page editing is not available');
        setActiveAction('Drafting page preview...');
        const previousBody = mnAiCurrentNoteMarkdown(currentNote);
        const owner = mnAiNoteEditOwner({
          vaultId,
          noteId: currentNote.id,
          body: previousBody,
          diskRevision: currentNote.diskRevision,
        });
        const reviewedBody = String(await askEdit({
          scope: 'current page preview',
          instruction,
          text: previousBody,
          jobId: mnAskAiJobId(),
        }) || '');
        if (!reviewedBody.trim()) throw new Error('AI returned an empty page preview.');
        const markdownPreview = mnAiBuildMarkdownPreview(previousBody, reviewedBody);
        const markerWarnings = markdownPreview.preservation.warnings || [];
        const step = {
          actionId: name,
          label: 'Apply reviewed AI page edit',
          risk: 'confirm',
          args: { instruction },
          reviewedBody,
          previousBody,
          owner,
          virtual: true,
        };
        const preview = {
          title: 'Review AI page edit',
          message: `Review before AI edits "${currentNote.title || 'current page'}". Exact Markdown preview is ready.`,
          steps: ['Generated an edited Markdown preview', 'Apply the reviewed Markdown through the note update path'],
          affected: [{ type: 'note', id: currentNote.id, title: currentNote.title || 'Current page' }],
          markdownPreview,
          markerWarnings,
        };
        const result = { risk: 'confirm', preview, message: preview.message };
        return {
          answer: preview.message,
          action: true,
          review: aiRuntime.makeReview
            ? aiRuntime.makeReview({ query: q, plan: { steps: [step] }, result })
            : { query: q, title: preview.title, message: preview.message, risk: 'confirm', steps: [step], preview },
          sources: [],
        };
      }
      if (name === 'edit-supporting-notes') {
        const targets = mnSupportingNovelNotes(allNotes || []);
        const step = { actionId: name, label: 'Edit supporting notes', risk: 'confirm', args: { instruction }, virtual: true };
        const preview = {
          title: 'Review AI supporting-note edit',
          message: `Review before AI updates ${targets.length} supporting note${targets.length === 1 ? '' : 's'}.`,
          steps: ['Send each supporting note body to the AI editor', 'Apply the returned note bodies'],
          affected: targets.slice(0, 12).map(note => ({ type: 'note', id: note.id, title: note.title || 'Untitled' })),
        };
        const result = { risk: 'confirm', preview, message: preview.message };
        return {
          answer: preview.message,
          action: true,
          review: aiRuntime.makeReview
            ? aiRuntime.makeReview({ query: q, plan: { steps: [step] }, result })
            : { query: q, title: preview.title, message: preview.message, risk: 'confirm', steps: [step], preview },
          sources: [],
        };
      }
      throw new Error(`Unsupported AI write tool: ${name}`);
    };
  
    const runConfirmedVirtualWriteTool = async ({ name, args = {}, reviewedBody = null, previousBody = null, owner = null, q = '', jobId, run } = {}) => {
      const inputArgs = { ...(args || {}) };
      if (!String(inputArgs.instruction || '').trim() && q) inputArgs.instruction = q;
      const cleanArgs = mnAiCleanVirtualToolArgs(name, inputArgs);
      const instruction = String(cleanArgs.instruction || q || '').trim();
      if (!instruction) throw new Error('Edit instruction is empty');
      if (name === 'edit-current-page') {
        if (!onApplyCurrentPageBody) throw new Error('Current page editing is not available');
        const targetNote = owner?.noteId
          ? (allNotes || []).find(note => String(note?.id || '') === String(owner.noteId)) || null
          : currentNote;
        if (!targetNote) throw new Error('The target note is no longer available.');
        setActiveAction('Applying reviewed page edit...');
        aiRuntime.recordTrace?.(run, 'tool.run', { actionId: name, actionLabel: 'Apply reviewed page edit', args: { instruction } });
        const currentBody = mnAiCurrentNoteMarkdown(targetNote);
        if (owner) {
          const ownership = mnAiValidateNoteEditOwner(owner, { vaultId, note: targetNote, body: currentBody });
          if (!ownership.ok) throw new Error(ownership.error);
        }
        const bodyBeforeApply = typeof previousBody === 'string' ? previousBody : currentBody;
        const bodyToApply = typeof reviewedBody === 'string' ? reviewedBody : await askEdit({
          scope: 'current page',
          instruction,
          text: bodyBeforeApply,
          jobId,
        });
        const applied = onApplyCurrentPageBody(bodyToApply, {
          source: 'ai',
          instruction,
          previousBody: bodyBeforeApply,
          reviewedBody: bodyToApply,
          targetVaultId: owner?.vaultId || vaultId,
          targetNoteId: owner?.noteId || targetNote.id,
          expectedRevision: owner?.baseRevision || targetNote.diskRevision || null,
          expectedBodyHash: owner?.bodyHash || null,
        });
        if (applied?.ok === false) throw new Error(applied.error || 'Could not apply reviewed AI edit.');
        aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: 'Edit current page', affected: 1 });
        return {
          answer: `Updated "${targetNote.title || 'current page'}".`,
          sources: [{ id: targetNote.id, title: targetNote.title || 'Current page', snippet: String(bodyToApply || '').slice(0, 200) }],
          restore: applied?.restoreAvailable === false ? null : { noteId: targetNote.id, title: targetNote.title || 'Current page' },
          action: true,
        };
      }
      if (name === 'edit-supporting-notes') {
        aiRuntime.recordTrace?.(run, 'tool.run', { actionId: name, actionLabel: 'Edit supporting notes', args: { instruction } });
        const result = await runSupportingNotesEdit({
          q,
          action: /\b(format|formatting|clean up|clean|organize|organise)\b/i.test(instruction) ? 'format' : 'improve',
          instruction,
          jobId,
        });
        aiRuntime.recordTrace?.(run, result.clarify ? 'run.clarify' : 'tool.done', { actionId: name, actionLabel: 'Edit supporting notes', affected: result.sources?.length || 0 });
        return result;
      }
      throw new Error(`Unsupported AI write tool: ${name}`);
    };
  return { askEdit, askNotes, askVaultSummary, runSupportingNotesEdit, makeVirtualWriteReview, runConfirmedVirtualWriteTool };
}

export { createVirtualWriteActions };
