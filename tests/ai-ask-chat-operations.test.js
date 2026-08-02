const test = require('node:test');
const assert = require('node:assert/strict');

const { createOperationDomain } = require('../lib/ai/operations.js');

// ask/askStream and chat/chatStream were the two largest entirely uncovered
// blocks in lib/ai/operations.js. Each pair is a near-duplicate, so these also
// pin that the two halves cannot drift apart in anything but token emission.

function makeDomain({
  chatReply = 'the answer', notes = [{ id: 'n1', title: 'One', body: 'b'.repeat(500), modifiedAt: 'm1' }],
  memories = [], status: st, enabled = true, fastAnswer = null, throwOnChat = null,
} = {}) {
  const calls = { tokens: [], jobsFinished: [], chatArgs: [], sentMessages: [] };
  const scope = {
    ASK_MAX_TOKENS: 111, CHAT_MAX_TOKENS: 222, CHAT_SYSTEM_PROMPT: 'chat-system',
    EDIT_SYSTEM_PROMPT: 'edit', TOOL_PLAN_MAX_TOKENS: 100, TOOL_PLAN_TIMEOUT_MS: 100,
    CONFIG: { enabled, provider: 'ollama' },
    ollama: { getHost: () => 'http://localhost:11434' },
    currentProviderMeta: () => ({ label: 'Ollama' }),
    providerSetupMessage: r => `setup: ${r}`,
    beginCancellableJob: () => ({ aborted: false }),
    finishCancellableJob: id => calls.jobsFinished.push(id),
    status: async () => st ?? { reachable: true, chatModelOk: true, chatModel: 'm' },
    buildVaultContext: async () => ({ notes, mode: 'semantic', capped: false }),
    recallMemoryContext: async () => memories,
    memorySources: m => m.map(x => ({ kind: 'memory', id: x.id })),
    buildRagPrompt: () => [{ role: 'user', content: 'prompt' }],
    fastChatAnswer: () => fastAnswer,
    notePreview: () => '',
    normalizeToolCalls: x => x, sanitizeAiTools: x => x,
    providerToolPlan: async () => ({ toolCalls: [] }),
    summarizeVaultInternal: async () => ({ ok: true, answer: 'vault summary' }),
    vaultStore: {},
    providerChat: async (messages, opts) => {
      calls.chatArgs.push(opts); calls.sentMessages.push(messages);
      if (throwOnChat) throw throwOnChat;
      return { text: chatReply };
    },
    providerChatStream: async (messages, opts) => {
      calls.chatArgs.push(opts); calls.sentMessages.push(messages);
      if (throwOnChat) throw throwOnChat;
      if (opts?.onToken) opts.onToken(chatReply);
      return { text: chatReply };
    },
  };
  return { domain: createOperationDomain(scope), calls };
}

const ASKERS = ['ask', 'askStream'];

for (const fn of ASKERS) {
  test(`${fn}: refuses when AI is disabled`, async () => {
    const { domain } = makeDomain({ enabled: false });
    const res = await domain[fn]('v', 'question', {});
    assert.equal(res.ok, false);
  });

  test(`${fn}: says so plainly when nothing in the vault matches`, async () => {
    // Answering from the model with no context would invent an answer about
    // notes the user does not have.
    const { domain } = makeDomain({ notes: [], memories: [] });
    const res = await domain[fn]('v', 'question', {});
    assert.equal(res.ok, true);
    assert.match(res.answer, /couldn't find anything/i);
    assert.deepEqual(res.sources, []);
  });

  test(`${fn}: answers with sources when notes match`, async () => {
    const { domain } = makeDomain();
    const res = await domain[fn]('v', 'question', {});
    assert.equal(res.ok, true);
    assert.equal(res.answer, 'the answer');
    assert.equal(res.sources.length, 1);
    assert.equal(res.sources[0].kind, 'note');
    assert.equal(res.sources[0].id, 'n1');
  });

  test(`${fn}: source snippets are capped so the panel cannot render a whole note`, async () => {
    const { domain } = makeDomain({ notes: [{ id: 'n1', title: 'One', body: 'x'.repeat(10000) }] });
    const res = await domain[fn]('v', 'question', {});
    assert.equal(res.sources[0].snippet.length, 200);
  });

  test(`${fn}: memories alone are enough to answer`, async () => {
    // Notes empty but memories present must not hit the "nothing found" path.
    const { domain } = makeDomain({ notes: [], memories: [{ id: 'm1', text: 'remembered' }] });
    const res = await domain[fn]('v', 'question', {});
    assert.equal(res.ok, true);
    assert.equal(res.memoryCount, 1);
    assert.equal(res.sources.length, 1);
  });

  test(`${fn}: falls back to setup guidance when the model is unavailable`, async () => {
    const { domain } = makeDomain({ status: { reachable: false, reason: 'offline' } });
    const res = await domain[fn]('v', 'question', {});
    assert.ok(res, 'no result returned for an unavailable model');
  });

  test(`${fn}: releases the job even when the provider throws`, async () => {
    const { domain, calls } = makeDomain({ throwOnChat: new Error('boom') });
    await domain[fn]('v', 'question', {}, { jobId: 'j1' }).catch(() => {});
    assert.deepEqual(calls.jobsFinished, ['j1'], 'a leaked job id blocks future cancellation');
  });
}

test('askStream streams the answer while ask does not', async () => {
  const tokens = [];
  const { domain } = makeDomain();
  await domain.askStream('v', 'question', {}, { onToken: t => tokens.push(t) });
  assert.deepEqual(tokens, ['the answer']);
});

test('ask and askStream agree on every outcome but streaming', async () => {
  const cases = [
    { label: 'normal', opts: {} },
    { label: 'nothing found', opts: { notes: [], memories: [] } },
    { label: 'disabled', opts: { enabled: false } },
  ];
  const drift = [];
  for (const { label, opts } of cases) {
    const a = await makeDomain(opts).domain.ask('v', 'q', {});
    const b = await makeDomain(opts).domain.askStream('v', 'q', {});
    const shape = r => JSON.stringify({ ok: r.ok, answer: r.answer, sources: (r.sources || []).length });
    if (shape(a) !== shape(b)) drift.push(`${label}: ask=${shape(a)} askStream=${shape(b)}`);
  }
  assert.deepEqual(drift, [], `the two ask paths disagree:\n  ${drift.join('\n  ')}`);
});

const CHATTERS = ['chat', 'chatStream'];

for (const fn of CHATTERS) {
  test(`${fn}: a fast local answer skips the model entirely`, async () => {
    const { domain, calls } = makeDomain({ fastAnswer: 'quick reply' });
    const res = await domain[fn]({ text: 'hi' });
    assert.equal(res.ok, true);
    assert.equal(res.answer, 'quick reply');
    assert.equal(res.fast, true);
    assert.deepEqual(calls.chatArgs, [], 'called the model despite a fast answer');
  });

  test(`${fn}: only the last 8 turns are sent, system prompt first`, async () => {
    // An unbounded history would grow the prompt until the provider rejects it.
    const { domain, calls } = makeDomain();
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    await domain[fn]({ messages });
    const [sent] = calls.sentMessages;
    assert.equal(sent[0].role, 'system', 'the system prompt must lead');
    assert.equal(sent.length, 9, `expected system + 8 turns, got ${sent.length}`);
    // The 8 kept turns must be the LAST 8, not the first.
    assert.equal(sent[sent.length - 1].content, 'm29');
    assert.equal(sent[1].content, 'm22');
  });

  test(`${fn}: a bare string is accepted as the user's message`, async () => {
    const { domain } = makeDomain();
    const res = await domain[fn]({ text: 'hello there' });
    assert.equal(res.ok, true);
    assert.equal(res.answer, 'the answer');
  });

  test(`${fn}: a missing model is reported as setup, not as a crash`, async () => {
    const { domain } = makeDomain({ status: { reachable: true, chatModelOk: false } });
    const res = await domain[fn]({ text: 'hi' });
    assert.equal(res.ok, true);
    assert.equal(res.setupRequired, true);
  });

  test(`${fn}: an unknown-model error from Ollama becomes setup guidance`, async () => {
    const { domain } = makeDomain({ throwOnChat: new Error("model 'llama9' not found, try pulling it") });
    const res = await domain[fn]({ text: 'hi' });
    assert.equal(res.ok, true);
    assert.equal(res.setupRequired, true);
  });

  test(`${fn}: an unrelated provider error is not swallowed as setup guidance`, async () => {
    // Reporting a network failure as "install a model" sends the user to fix
    // the wrong thing.
    const { domain } = makeDomain({ throwOnChat: new Error('ECONNRESET') });
    await assert.rejects(() => domain[fn]({ text: 'hi' }));
  });
}
