import { platformApi } from '../platform/index.js';
import { getAppActionRegistry } from '../app/actions/actionRegistryRuntime.js';
import * as aiModels from './aiModels.js';
const { MN_ASK_EDIT_ACTIONS, MN_NOVEL_STRUCTURE_TAGS, mnIsSupportingNovelNote, mnSupportingNovelNotes, mnSupportingNotesEditInstruction, MN_ASK_SUGGESTIONS, MN_AI_PLANNER_TIMEOUT_MS, MN_AI_CHAT_TIMEOUT_MS, MN_AI_NOTES_TIMEOUT_MS, MN_AI_VIRTUAL_WRITE_TOOLS, MN_AI_REPORT_TARGETS, MN_AI_VIRTUAL_TOOLS, mnReportAiOutput, mnAskAiJobId, mnAskMessageId, mnNormalizeAskMessages, mnAskMessageThreadText, mnBuildAskThreadMessages, mnBuildAskThreadPrompt, mnRecentAskThreadNote, mnLastAskMessage, mnLooksLikeNoteEditRequest, mnMentionsThreadNote, mnAssistantAskedForActionDetail, mnBuildContextualActionQuery, mnAiCurrentNoteMarkdown, mnAiMarkdownMarkers, mnAiMissingMarkdownMarkers, mnAiBuildMarkdownPreview, mnAiShouldShareCurrentContext, mnWantsZoteroAssistedNoteEdit, mnWantsZoteroSummaryNote, mnAiCurrentContextMessage, mnAiVirtualToolMeta, mnAiCleanVirtualToolArgs, mnAiToolCallsFromPlanResult } = aiModels;

function createAiOrchestrator({ currentNote, setActiveAction, aiRuntime, askEdit, askNotes, askVaultSummary, makeVirtualWriteReview, onCreateNote }) {
  const mnAiToolCatalogForPrompt = (tools = []) => (Array.isArray(tools) ? tools : [])
      .map(tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        section: tool.section,
        kind: tool.kind,
        risk: tool.risk,
        readOnly: !!tool.readOnly,
        input_schema: tool.inputSchema || tool.input_schema,
        output_schema: tool.outputSchema || tool.output_schema,
        requires: tool.requires || [],
        examples: tool.examples || [],
      }));
  
    const buildOrchestratorMessages = (q, priorMessages = [], tools = []) => {
      const conversation = mnBuildAskThreadMessages(priorMessages, q, { limit: 8 });
      const context = mnAiShouldShareCurrentContext(q) ? mnAiCurrentContextMessage(currentNote) : '';
      const toolContext = {
        type: 'vispnote_tool_planning_input',
        request: String(q || '').trim(),
        instruction: 'Choose the best registered VispNote API. Use answer-notes for specific vault, note, task, tag, decision, link, backlink, recent-change, latest-note, or latest-update questions. Use summarize-vault only for explicit whole-vault summaries. Plugin APIs are exposed as plugin-* tools.',
        available_apis: mnAiToolCatalogForPrompt(tools),
      };
      const messages = [
        {
          role: 'assistant',
          content: `Structured VispNote API context:\n${JSON.stringify(toolContext, null, 2).slice(0, 12000)}`,
        },
        ...conversation,
      ];
      if (!context) return messages;
      return [
        { role: 'user', content: context },
        ...messages,
      ];
    };
  
    const orchestratorTools = () => {
      const registryTools = getAppActionRegistry()?.describeForAi?.() || [];
      const pluginTools = registryTools.filter(tool => /^plugin-/.test(tool.name || '')).slice(0, 20);
      const regularTools = registryTools.filter(tool => !/^plugin-/.test(tool.name || ''));
      const regularLimit = Math.max(0, 100 - MN_AI_VIRTUAL_TOOLS.length - pluginTools.length);
      const tools = [...MN_AI_VIRTUAL_TOOLS, ...regularTools.slice(0, regularLimit), ...pluginTools];
      const available = currentNote
        ? tools
        : tools.filter(tool => tool.name !== 'edit-current-page');
      return available.slice(0, 100);
    };
  
    const executeOrchestratorTool = async ({ call, q, jobId, run }) => {
      const name = String(call?.name || '').trim();
      const args = call?.args && typeof call.args === 'object' ? call.args : {};
      if (name === 'answer-notes') {
        setActiveAction('Researching notes...');
        aiRuntime.recordTrace?.(run, 'tool.run', { actionId: name, actionLabel: 'Answer from notes', args });
        const prompt = String(args.query || q || '').trim();
        const result = await askNotes({ prompt, jobId });
        aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: 'Answer from notes', affected: result.sources?.length || 0 });
        return { final: { answer: result.answer, sources: result.sources || [] } };
      }
      if (name === 'summarize-vault') {
        setActiveAction('Summarizing notes in batches...');
        aiRuntime.recordTrace?.(run, 'tool.run', { actionId: name, actionLabel: 'Summarize vault', args });
        const prompt = String(args.query || q || '').trim();
        const result = await askVaultSummary({ prompt, jobId });
        aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: 'Summarize vault', affected: result.sources?.length || 0 });
        return { final: { answer: result.answer, sources: result.sources || [] } };
      }
      if (name === 'edit-current-page') {
        aiRuntime.recordTrace?.(run, 'tool.preview', { actionId: name, actionLabel: 'Edit current page', risk: 'confirm' });
        return { final: await makeVirtualWriteReview(name, args, q) };
      }
      if (name === 'edit-supporting-notes') {
        aiRuntime.recordTrace?.(run, 'tool.preview', { actionId: name, actionLabel: 'Edit supporting notes', risk: 'confirm' });
        return { final: await makeVirtualWriteReview(name, args, q) };
      }
  
      const registry = getAppActionRegistry();
      if (!registry?.run || !registry?.validate) throw new Error('App actions are not available');
      const meta = registry.list?.({ includeHidden: true })?.find?.(item => item.id === name);
      const cleanArgs = registry.validate(name, args);
      const step = { actionId: name, args: cleanArgs, label: meta?.label || name, risk: meta?.risk || 'safe' };
      setActiveAction(step.label);
      aiRuntime.recordTrace?.(run, 'tool.preview', { actionId: name, actionLabel: step.label, risk: step.risk });
      const result = await registry.run(name, cleanArgs, {});
      run?.toolCalls?.push?.({ actionId: name, args: cleanArgs, ok: result?.ok !== false, requiresConfirmation: !!result?.requiresConfirmation });
      if (result.requiresConfirmation) {
        return {
          final: {
            answer: result.preview?.message || result.message || 'Review this action before it runs.',
            action: true,
            review: aiRuntime.makeReview
              ? aiRuntime.makeReview({ query: q, plan: { steps: [step] }, result })
              : { query: q, steps: [step], preview: result.preview || null },
            sources: [],
          },
        };
      }
      if (result.ok === false) throw new Error(result.message || 'App action failed');
      aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: step.label, affected: result.affected?.length || 0 });
      if (meta?.readOnly && ['search-notes', 'read-note'].includes(name)) {
        return {
          toolResult: {
            tool: name,
            args: cleanArgs,
            ok: true,
            message: result.message || '',
            structuredContent: {
              results: result.results || undefined,
              note: result.note || undefined,
              affected: result.affected || [],
            },
          },
        };
      }
      return {
        final: {
          answer: result.message || result.title || `${step.label} completed.`,
          sources: (result.affected || []).filter(item => item?.id).map(item => ({
            type: item.type || '',
            id: item.id,
            title: item.title || item.id,
            snippet: item.type || 'App action',
          })),
          action: true,
        },
      };
    };
  
    const runLlmOrchestrator = async ({ q, actionQuery, priorMessages, jobId, run }) => {
      if (!platformApi.ai?.toolPlan) return null;
      const tools = orchestratorTools();
      if (!tools.length) return null;
      const toolMessages = buildOrchestratorMessages(actionQuery, priorMessages, tools);
      for (let round = 0; round < 4; round++) {
        setActiveAction(round === 0 ? 'Understanding request...' : 'Using tool results...');
        aiRuntime.recordTrace?.(run, 'planner.request', { tools: tools.length, round: round + 1, llmFirst: true });
        const response = await platformApi.ai.toolPlan({
          jobId,
          timeoutMs: MN_AI_PLANNER_TIMEOUT_MS,
          maxTokens: 900,
          tools,
          messages: toolMessages,
        });
        if (!response.ok || (response.value && response.value.ok === false)) {
          const error = response.error || response.value?.error || 'The model could not choose an API for this request.';
          aiRuntime.recordTrace?.(run, 'planner.failed', { error });
          return { answer: error, sources: [], clarify: true };
        }
        const planned = mnAiToolCallsFromPlanResult(response.value || response);
        aiRuntime.recordTrace?.(run, 'planner.result', { toolCalls: planned.toolCalls.length, answer: !!planned.answer, round: round + 1 });
        if (!planned.toolCalls.length) {
          if (planned.mode === 'planner_failed' || planned.mode === 'no_tools' || planned.mode === 'error') {
            aiRuntime.recordTrace?.(run, 'planner.failed', { error: planned.error || planned.mode });
            return {
              answer: planned.error || 'The model did not return a valid API call.',
              sources: [],
              clarify: true,
            };
          }
          return {
            answer: planned.answer || 'I need a little more detail before I can help with that.',
            sources: [],
            clarify: !planned.answer,
          };
        }
        const toolResults = [];
        for (const call of planned.toolCalls.slice(0, 4)) {
          const result = await executeOrchestratorTool({ call, q, jobId, run });
          if (result.final) return result.final;
          if (result.toolResult) toolResults.push(result.toolResult);
        }
        if (!toolResults.length) {
          return {
            answer: planned.answer || 'Done.',
            sources: [],
            action: true,
          };
        }
        toolMessages.push({
          role: 'assistant',
          content: `Tool results:\n${JSON.stringify(toolResults, null, 2).slice(0, 12000)}`,
        });
        toolMessages.push({
          role: 'user',
          content: 'Use these tool results to answer the user directly. If more action is necessary, call the next best tool. Do not repeat tool results as raw JSON.',
        });
      }
      return { answer: 'I inspected the available context, but I need a more specific instruction before I can continue.', sources: [], clarify: true };
    };
  
    const runActionPlan = async (q, plan, jobId) => {
      if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error('No AI action steps found');
      let previousAnswer = '';
      let created = null;
      const sources = [];
      const completed = [];
      const createdTags = (plan.steps || [])
        .filter(step => step?.type === 'tag-created-note' && step.tag)
        .map(step => step.tag)
        .filter((tag, index, arr) => arr.indexOf(tag) === index);
  
      for (const step of plan.steps) {
        if (!step || !step.type) continue;
        if (step.type === 'notes-answer') {
          setActiveAction(step.purpose === 'summary' ? 'Summarizing notes...' : 'Researching notes...');
          const result = step.purpose === 'summary'
            ? await askVaultSummary({ prompt: step.prompt || q, jobId })
            : await askNotes({ prompt: step.prompt || q, jobId });
          previousAnswer = result.answer;
          result.sources.forEach(source => {
            if (source?.id && !sources.some(item => item.id === source.id)) sources.push(source);
          });
          completed.push(step.purpose === 'summary' ? 'summarized your notes' : 'researched your notes');
        } else if (step.type === 'create-note') {
          if (!onCreateNote) throw new Error('Page creation is not available here');
          setActiveAction('Creating page...');
          const title = step.title || plan.title || 'AI draft';
          const tags = [...(step.tags || []), ...createdTags]
            .filter(Boolean)
            .filter((tag, index, arr) => arr.indexOf(tag) === index);
          const body = step.bodyFrom === 'previous-answer'
            ? previousAnswer
            : await askEdit({
                scope: 'new page',
                instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
                text: q,
                jobId,
              });
          const id = onCreateNote({ title, body, tags, open: false });
          created = { id, title, body, tags };
          completed.push(`created "${title}"`);
        } else if (step.type === 'tag-created-note') {
          if (!created) continue;
          completed.push(`tagged it #${step.tag}`);
        } else {
          throw new Error(`Unsupported AI action step: ${step.type}`);
        }
      }
  
      const createdSource = created?.id
        ? [{ id: created.id, title: created.title, snippet: String(created.body || '').slice(0, 200) }]
        : [];
      const answer = created
        ? `I ${completed.filter((item, index, arr) => arr.indexOf(item) === index).join(', ')}.`
        : `I ${completed.join(', ')}.`;
      return {
        answer,
        sources: [
          ...createdSource,
          ...sources.filter(source => source?.id !== created?.id),
        ],
        action: true,
      };
    };
  
    const runAppActionPlan = async (q, plan, jobId, run) => {
      const registry = getAppActionRegistry();
      if (!registry?.run) throw new Error('App actions are not available');
      if (!Array.isArray(plan?.steps) || !plan.steps.length) throw new Error('No app action steps found');
      const completed = [];
      const sources = [];
      let lastNote = null;
      const noteFollowupActions = new Set(['append-to-note', 'add-todo-to-note', 'add-reminder-to-note', 'link-note', 'tag-note', 'untag-note', 'set-workflow-status']);
      for (const step of plan.steps) {
        setActiveAction(step.label || 'Running app action...');
        const args = { ...(step.args || {}) };
        if (!args.noteId && lastNote && noteFollowupActions.has(step.actionId)) {
          args.noteId = lastNote.id;
        }
        aiRuntime.recordTrace?.(run, 'tool.preview', { actionId: step.actionId, actionLabel: step.label || step.actionId, risk: step.risk || '' });
        if (step.actionId === 'new-note' && !String(args.body || '').trim()) {
          setActiveAction('Drafting page...');
          args.body = await askEdit({
            scope: 'new page',
            instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
            text: q,
            jobId,
          });
        }
        aiRuntime.recordTrace?.(run, 'tool.run', { actionId: step.actionId, actionLabel: step.label || step.actionId, args });
        const result = await registry.run(step.actionId, args, {});
        run?.toolCalls?.push?.({ actionId: step.actionId, args, ok: result?.ok !== false, requiresConfirmation: !!result?.requiresConfirmation });
        if (result.requiresConfirmation) {
          return {
            answer: result.preview?.message || result.message || 'Review this action before it runs.',
            action: true,
            review: aiRuntime.makeReview
              ? aiRuntime.makeReview({ query: q, plan, result })
              : {
                  query: q,
                  title: result.preview?.title || result.title || 'Review action',
                  message: result.preview?.message || result.message || '',
                  risk: result.risk,
                  steps: plan.steps,
                  preview: result.preview,
                },
            sources,
          };
        }
        if (result.ok === false) throw new Error(result.message || 'App action failed');
        aiRuntime.recordTrace?.(run, 'tool.done', { actionId: step.actionId, actionLabel: step.label || step.actionId, affected: result.affected?.length || 0 });
        const noteAffected = (result.affected || []).find(item => item?.type === 'note' && item.id);
        if (noteAffected) lastNote = { id: noteAffected.id, title: noteAffected.title || noteAffected.id };
        completed.push(result.message || result.title || step.actionId);
        (result.affected || []).forEach(item => {
          if (item?.id && !sources.some(source => source.id === item.id)) {
            sources.push({ type: item.type || '', id: item.id, title: item.title || item.id, snippet: item.type || 'App action' });
          }
        });
      }
      return {
        answer: completed.length ? completed.join('\n') : 'Done.',
        sources,
        action: true,
      };
    };
  return { orchestratorTools, executeOrchestratorTool, runLlmOrchestrator, runActionPlan, runAppActionPlan };
}

export { createAiOrchestrator };
