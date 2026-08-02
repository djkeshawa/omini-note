const test = require('node:test');
const assert = require('node:assert/strict');

const { createOperationDomain } = require('../lib/ai/operations.js');

// lib/ai/operations.js had the worst branch coverage in the repo (35%). These
// tests state how the AI edit path is supposed to behave and then check it,
// rather than describing what it currently does.

function makeDomain({ chatReply = 'edited text', status: st, enabled = true, throwOnChat = null } = {}) {
  const calls = { chat: [], stream: [], jobsBegun: [], jobsFinished: [] };
  const scope = {
    ASK_MAX_TOKENS: 100, CHAT_MAX_TOKENS: 100, CHAT_SYSTEM_PROMPT: 'chat',
    EDIT_SYSTEM_PROMPT: 'edit', TOOL_PLAN_MAX_TOKENS: 100, TOOL_PLAN_TIMEOUT_MS: 100,
    CONFIG: { enabled, provider: 'ollama' },
    ollama: { getHost: () => 'http://localhost:11434' },
    currentProviderMeta: () => ({ label: 'Ollama' }),
    providerSetupMessage: reason => `setup: ${reason}`,
    beginCancellableJob: id => { calls.jobsBegun.push(id); return { aborted: false }; },
    finishCancellableJob: id => { calls.jobsFinished.push(id); },
    status: async () => st ?? { reachable: true, chatModelOk: true, chatModel: 'm' },
    providerChat: async (messages, opts) => {
      calls.chat.push({ messages, opts });
      if (throwOnChat) throw throwOnChat;
      return { text: chatReply };
    },
    providerChatStream: async (messages, opts) => {
      calls.stream.push({ messages, opts });
      if (throwOnChat) throw throwOnChat;
      if (opts?.onToken) opts.onToken(chatReply);
      return { text: chatReply };
    },
    buildRagPrompt: () => [], buildVaultContext: async () => ({ notes: [], mode: 'x', capped: false }),
    recallMemoryContext: async () => [], memorySources: () => [], notePreview: () => '',
    fastChatAnswer: async () => null, normalizeToolCalls: x => x, sanitizeAiTools: x => x,
    providerToolPlan: async () => ({ toolCalls: [] }), summarizeVaultInternal: async () => ({}),
    vaultStore: {},
  };
  return { domain: createOperationDomain(scope), calls };
}

const EDITORS = ['editText', 'editTextStream'];

// The renderer writes the returned text straight over the user's selection
// (outliner.jsx requestAiEdit -> applyTextReplacement), with no emptiness check.
// So "ok with empty text" means the selection is silently deleted.
for (const fn of EDITORS) {
  test(`${fn}: a model that returns nothing must not report success`, async () => {
    const { domain } = makeDomain({ chatReply: '' });
    const res = await domain[fn]({ text: 'keep me', instruction: 'improve' });
    assert.notEqual(res.ok && res.text === '', true,
      'returned {ok:true, text:""} -- the caller replaces the selection with this, deleting the user\'s text');
  });

  test(`${fn}: a whitespace-only reply must not report success`, async () => {
    const { domain } = makeDomain({ chatReply: '   \n\n  ' });
    const res = await domain[fn]({ text: 'keep me', instruction: 'improve' });
    assert.notEqual(res.ok && res.text === '', true,
      'whitespace trims to empty, so the selection is replaced with nothing');
  });

  test(`${fn}: a normal edit returns the edited text`, async () => {
    const { domain } = makeDomain({ chatReply: '  polished prose  ' });
    const res = await domain[fn]({ text: 'rough prose', instruction: 'improve' });
    assert.equal(res.ok, true);
    assert.equal(res.text, 'polished prose');
  });

  test(`${fn}: refuses when there is no text selected`, async () => {
    const { domain } = makeDomain();
    for (const text of ['', '   ', null, undefined]) {
      const res = await domain[fn]({ text, instruction: 'improve' });
      assert.equal(res.ok, false, `empty input ${JSON.stringify(text)} should be refused`);
    }
  });

  test(`${fn}: reports setup needed when the provider is unreachable`, async () => {
    const { domain } = makeDomain({ status: { reachable: false, reason: 'offline' } });
    const res = await domain[fn]({ text: 'hello', instruction: 'improve' });
    assert.equal(res.ok, false);
    assert.equal(res.setupRequired, true);
  });

  test(`${fn}: reports setup needed when the chat model is missing`, async () => {
    const { domain } = makeDomain({ status: { reachable: true, chatModelOk: false } });
    const res = await domain[fn]({ text: 'hello', instruction: 'improve' });
    assert.equal(res.ok, false);
    assert.equal(res.setupRequired, true);
  });

  test(`${fn}: refuses when AI is disabled in settings`, async () => {
    const { domain } = makeDomain({ enabled: false });
    const res = await domain[fn]({ text: 'hello', instruction: 'improve' });
    assert.equal(res.ok, false);
  });

  test(`${fn}: always releases the cancellable job, even when the provider throws`, async () => {
    const { domain, calls } = makeDomain({ throwOnChat: new Error('provider exploded') });
    await domain[fn]({ text: 'hello', instruction: 'improve', jobId: 'job-1' }).catch(() => {});
    assert.deepEqual(calls.jobsFinished, ['job-1'], 'a leaked job id blocks future cancellation');
  });
}

test('editText and editTextStream agree on every outcome', async () => {
  // They are near-duplicates, so they can silently drift apart.
  const cases = [
    { label: 'normal', opts: { chatReply: 'done' } },
    { label: 'empty reply', opts: { chatReply: '' } },
    { label: 'unreachable', opts: { status: { reachable: false, reason: 'x' } } },
    { label: 'no chat model', opts: { status: { reachable: true, chatModelOk: false } } },
    { label: 'disabled', opts: { enabled: false } },
  ];
  const drift = [];
  for (const { label, opts } of cases) {
    const a = await makeDomain(opts).domain.editText({ text: 'src', instruction: 'i' });
    const b = await makeDomain(opts).domain.editTextStream({ text: 'src', instruction: 'i' });
    if (JSON.stringify({ ok: a.ok, text: a.text, setupRequired: a.setupRequired })
      !== JSON.stringify({ ok: b.ok, text: b.text, setupRequired: b.setupRequired })) {
      drift.push(`${label}: editText=${JSON.stringify(a)} editTextStream=${JSON.stringify(b)}`);
    }
  }
  assert.deepEqual(drift, [], `the two edit paths disagree:\n  ${drift.join('\n  ')}`);
});
