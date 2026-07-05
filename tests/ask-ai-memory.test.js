const assert = require('node:assert/strict');
const test = require('node:test');

const ai = require('../lib/ai');

function sampleMemory(overrides = {}) {
  return {
    id: 'mem-1',
    content: 'User prefers dark mode and writes daily notes at 9am.',
    layer: 'longterm',
    category: 'preference',
    importance: 0.8,
    tags: ['prefs'],
    createdAt: '2026-06-01T09:00:00Z',
    ...overrides,
  };
}

test('recallMemoryContext returns empty without a provider', async () => {
  ai.setMemoryRecallProvider(null);
  assert.deepEqual(await ai.__test.recallMemoryContext('anything'), []);
});

test('recallMemoryContext sanitizes provider rows and caps the count', async () => {
  ai.setMemoryRecallProvider(async ({ query, limit }) => {
    assert.equal(query, 'morning routine');
    assert.ok(limit >= 1);
    return [
      sampleMemory(),
      { id: 42, content: '  padded  ', tags: 'not-an-array', importance: 'high' },
      { id: 'empty', content: '   ' },
      ...Array.from({ length: 10 }, (_, i) => sampleMemory({ id: `extra-${i}` })),
    ];
  });
  try {
    const memories = await ai.__test.recallMemoryContext('morning routine');
    assert.ok(memories.length <= 6);
    assert.equal(memories[0].id, 'mem-1');
    assert.equal(memories[0].importance, 0.8);
    assert.equal(memories[1].id, '42');
    assert.equal(memories[1].content, 'padded');
    assert.deepEqual(memories[1].tags, []);
    assert.equal(memories[1].importance, 0);
    assert.ok(!memories.some(memory => memory.id === 'empty'));
  } finally {
    ai.setMemoryRecallProvider(null);
  }
});

test('recallMemoryContext swallows provider failures', async () => {
  ai.setMemoryRecallProvider(async () => { throw new Error('bridge disabled'); });
  try {
    assert.deepEqual(await ai.__test.recallMemoryContext('anything'), []);
  } finally {
    ai.setMemoryRecallProvider(null);
  }
});

test('buildRagPrompt renders a distinct memory section', () => {
  const context = {
    mode: 'semantic',
    reason: 'test',
    totalNotes: 1,
    capped: false,
    notes: [{ id: 'n1', title: 'Routines', body: 'Wake up, journal, coffee.', modifiedAt: '2026-06-02T08:00:00Z', tags: ['daily'] }],
    memories: [sampleMemory()],
  };
  const messages = ai.__test.buildRagPrompt('What is my routine?', context);
  const user = messages.find(m => m.role === 'user').content;
  assert.match(user, /long-term memory/);
  assert.match(user, /--- Memory item 1 ---/);
  assert.match(user, /dark mode/);
  assert.match(user, /Memory items provided: 1/);
  assert.match(user, /Context from my notes:/);
  assert.match(user, /Wake up, journal, coffee\./);
  const system = messages.find(m => m.role === 'system').content;
  assert.match(system, /\[Memory\]/);
});

test('buildRagPrompt omits the memory section when no memories were recalled', () => {
  const context = {
    mode: 'semantic',
    reason: 'test',
    totalNotes: 1,
    capped: false,
    notes: [{ id: 'n1', title: 'Routines', body: 'Body', modifiedAt: '', tags: [] }],
  };
  const user = ai.__test.buildRagPrompt('q', context).find(m => m.role === 'user').content;
  assert.doesNotMatch(user, /long-term memory/);
  assert.doesNotMatch(user, /Memory items provided/);
});

test('buildRagPrompt truncates oversized memory content for the prompt budget', () => {
  const context = {
    mode: 'semantic',
    reason: 'test',
    totalNotes: 0,
    capped: false,
    notes: [],
    memories: [sampleMemory({ content: 'x'.repeat(5000) })],
  };
  const user = ai.__test.buildRagPrompt('q', context).find(m => m.role === 'user').content;
  assert.match(user, /\.\.\.\[truncated for prompt budget\]/);
  assert.ok(user.length < 5000);
  assert.match(user, /\(no matching notes\)/);
});

test('memorySources tags citations as memory with a title and snippet', () => {
  const sources = ai.__test.memorySources([sampleMemory()]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, 'memory');
  assert.equal(sources[0].type, 'memory');
  assert.equal(sources[0].id, 'memory:mem-1');
  assert.match(sources[0].title, /dark mode/);
  assert.match(sources[0].snippet, /daily notes/);
  assert.equal(sources[0].createdAt, '2026-06-01T09:00:00Z');
});

test('memorySources falls back to the category when content has no usable first line', () => {
  const sources = ai.__test.memorySources([sampleMemory({ content: '\n\n', category: 'preference' })]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'preference');
});
