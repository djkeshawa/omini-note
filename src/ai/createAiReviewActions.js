import { MN_AI_VIRTUAL_WRITE_TOOLS, mnAskAiJobId, mnAiCleanVirtualToolArgs } from './aiModels.js';
import { getAppActionRegistry } from '../app/actions/actionRegistryRuntime.js';

function createAiReviewActions({ updateSession, aiRuntime, runConfirmedVirtualWriteTool, onRestoreCurrentPageBody, currentNote, onOpenCurrentNoteVersions }) {
  const confirmReview = async (messageId, review) => {
      const registry = getAppActionRegistry();
      if (!review?.steps?.length) return;
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId ? { ...m, reviewBusy: true } : m),
      }));
      try {
        const jobId = mnAskAiJobId();
        const run = aiRuntime.makeRun ? aiRuntime.makeRun({ runId: jobId, query: review.query || '', mode: 'review' }) : null;
        const completed = [];
        const sources = [];
        let restore = null;
        for (const step of review.steps) {
          if (MN_AI_VIRTUAL_WRITE_TOOLS.has(step.actionId)) {
            const result = await runConfirmedVirtualWriteTool({
              name: step.actionId,
              args: step.args || {},
              reviewedBody: step.reviewedBody,
              previousBody: step.previousBody,
              q: review.query || '',
              jobId,
              run,
            });
            if (result.clarify) throw new Error(result.answer || 'AI action could not run');
            completed.push(result.answer || step.label || step.actionId);
            if (result.restore) restore = result.restore;
            (result.sources || []).forEach(item => {
              if (item?.id && !sources.some(source => source.id === item.id)) sources.push({ id: item.id, title: item.title || item.id, snippet: item.snippet || 'AI edit' });
            });
            continue;
          }
          if (!registry?.run) throw new Error('App actions are not available');
          const result = await registry.run(step.actionId, step.args || {}, { confirmed: true });
          if (result.ok === false) throw new Error(result.message || 'App action failed');
          completed.push(result.message || result.title || step.actionId);
          (result.affected || []).forEach(item => {
            if (item?.id && !sources.some(source => source.id === item.id)) sources.push({ type: item.type || '', id: item.id, title: item.title || item.id, snippet: item.type || 'App action' });
          });
        }
        updateSession(prev => ({
          ...(prev || {}),
          messages: (prev?.messages || []).map(m => m.id === messageId
            ? { ...m, text: completed.join('\n') || 'Confirmed and completed.', sources, restore, review: null, reviewBusy: false }
            : m),
        }));
      } catch (e) {
        updateSession(prev => ({
          ...(prev || {}),
          messages: (prev?.messages || []).map(m => m.id === messageId
            ? { ...m, text: e.message || String(e), error: true, review: null, reviewBusy: false }
            : m),
        }));
      }
    };
  
    const cancelReview = (messageId) => {
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId
          ? { ...m, text: 'Cancelled.', review: null, reviewBusy: false, stopped: true }
          : m),
      }));
    };
  
    const editReviewArgs = async (messageId, review) => {
      const registry = getAppActionRegistry();
      if (!review?.steps?.length) return;
      const currentSteps = review.steps.map(step => ({ actionId: step.actionId, args: step.args || {} }));
      const raw = window.prompt?.('Edit action arguments as JSON.', JSON.stringify(currentSteps, null, 2));
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const nextSteps = (Array.isArray(parsed) ? parsed : [parsed]).map((item, index) => {
          const original = review.steps[index] || review.steps[0];
          const actionId = String(item.actionId || item.tool || original.actionId || '').trim();
          const args = MN_AI_VIRTUAL_WRITE_TOOLS.has(actionId)
            ? mnAiCleanVirtualToolArgs(actionId, item.args && typeof item.args === 'object' ? item.args : {})
            : (() => {
                if (!registry?.validate) throw new Error('App actions are not available');
                return registry.validate(actionId, item.args && typeof item.args === 'object' ? item.args : {});
              })();
          return { ...original, actionId, args };
        });
        updateSession(prev => ({
          ...(prev || {}),
          messages: (prev?.messages || []).map(m => m.id === messageId
            ? { ...m, review: { ...review, steps: nextSteps, message: 'Review updated. Confirm to run the edited action.' } }
            : m),
        }));
      } catch (e) {
        updateSession(prev => ({
          ...(prev || {}),
          messages: (prev?.messages || []).map(m => m.id === messageId
            ? { ...m, text: e.message || String(e), error: true, reviewBusy: false }
            : m),
        }));
      }
    };
  
    const restoreAiEdit = async (messageId, restore) => {
      if (!restore?.noteId || !onRestoreCurrentPageBody) return;
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId ? { ...m, restoreBusy: true } : m),
      }));
      try {
        const result = await onRestoreCurrentPageBody(restore.noteId);
        if (result?.ok === false) throw new Error(result.error || 'Could not restore previous AI edit.');
        updateSession(prev => ({
          ...(prev || {}),
          messages: (prev?.messages || []).map(m => m.id === messageId
            ? {
                ...m,
                text: `${String(m.text || '').trim()}\nPrevious note body restored.`,
                restore: null,
                restoreBusy: false,
              }
            : m),
        }));
      } catch (e) {
        updateSession(prev => ({
          ...(prev || {}),
          messages: (prev?.messages || []).map(m => m.id === messageId
            ? { ...m, text: e.message || String(e), error: true, restore: null, restoreBusy: false }
            : m),
        }));
      }
    };
  
    const openAiEditVersionHistory = (restore) => {
      const noteId = restore?.noteId || currentNote?.id;
      if (!noteId || !onOpenCurrentNoteVersions) return;
      onOpenCurrentNoteVersions(noteId);
    };
  return { confirmReview, cancelReview, editReviewArgs, restoreAiEdit, openAiEditVersionHistory };
}

export { createAiReviewActions };
