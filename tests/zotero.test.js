const test = require('node:test');
const assert = require('node:assert/strict');

const zotero = require('../lib/zotero');

function withMockFetch(handler, fn) {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => handler(String(url), init || {});
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = originalFetch;
    });
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

test('Zotero search calls local API and normalizes metadata', async () => {
  const calls = [];
  await withMockFetch((url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).origin, 'http://127.0.0.1:23119');
    return jsonResponse([
      {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'Attention Is All You Need',
          creators: [{ firstName: 'Ashish', lastName: 'Vaswani' }],
          date: '2017',
          publicationTitle: 'NIPS',
          DOI: '10.5555/3295222.3295349',
          abstractNote: 'Transformer abstract',
        },
      },
    ]);
  }, async () => {
    const result = await zotero.search({ query: ' transformer ', limit: 50 });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/api/users/0/items');
    assert.equal(url.searchParams.get('q'), 'transformer');
    assert.equal(url.searchParams.get('qmode'), 'everything');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(url.searchParams.has('sort'), false);
    assert.equal(calls[0].init.headers['Zotero-API-Version'], '3');
    assert.deepEqual(result.results, [{
      key: 'ABCD1234',
      itemType: 'journalArticle',
      title: 'Attention Is All You Need',
      creators: 'Ashish Vaswani',
      date: '2017',
      publicationTitle: 'NIPS',
      url: '',
      doi: '10.5555/3295222.3295349',
      abstractNote: 'Transformer abstract',
      parentItem: '',
    }]);
  });
});

test('Zotero search reports disabled local API and prefers parent items', async () => {
  await withMockFetch(() => jsonResponse('Local API is not enabled'), async () => {
    await assert.rejects(
      () => zotero.search({ query: 'rlm' }),
      /Local API is not enabled/
    );
  });

  await withMockFetch(() => jsonResponse([
    { key: 'NOTE1', data: { key: 'NOTE1', itemType: 'note', parentItem: 'PARENT1', note: 'child note' } },
    { key: 'PARENT1', data: { key: 'PARENT1', itemType: 'preprint', title: 'Recursive Language Models' } },
  ]), async () => {
    const result = await zotero.search({ query: 'recursive language models' });
    assert.deepEqual(result.results.map(item => item.key), ['PARENT1', 'NOTE1']);
  });
});

test('Zotero search falls back to local title ranking when API query has no hits', async () => {
  const calls = [];
  await withMockFetch((url) => {
    calls.push(new URL(url));
    if (calls.length === 1) return jsonResponse([]);
    return jsonResponse([
      { key: 'OTHER1', data: { key: 'OTHER1', itemType: 'preprint', title: 'Unrelated Paper' } },
      { key: 'RLM1', data: { key: 'RLM1', itemType: 'preprint', title: 'Recursive Language Models' } },
    ]);
  }, async () => {
    const result = await zotero.search({ query: 'tell me about recursive language model paper', limit: 3 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].searchParams.get('q'), 'tell me about recursive language model paper');
    assert.equal(calls[1].searchParams.has('q'), false);
    assert.deepEqual(result.results.map(item => item.key), ['RLM1']);
  });
});

test('Zotero list returns recent top-level document items without a query', async () => {
  const calls = [];
  await withMockFetch((url) => {
    calls.push(new URL(url));
    return jsonResponse([
      { key: 'NOTE1', data: { key: 'NOTE1', itemType: 'note', parentItem: 'PARENT1', note: 'child note' } },
      { key: 'ATTACH1', data: { key: 'ATTACH1', itemType: 'attachment', parentItem: 'PARENT1', title: 'PDF' } },
      { key: 'PARENT1', data: { key: 'PARENT1', itemType: 'preprint', title: 'Recursive Language Models', date: '2025' } },
      { key: 'BOOK1', data: { key: 'BOOK1', itemType: 'book', title: 'Local First Software' } },
    ]);
  }, async () => {
    const result = await zotero.list({ limit: 1 });
    assert.equal(calls[0].searchParams.has('q'), false);
    assert.equal(calls[0].searchParams.get('sort'), 'dateModified');
    assert.equal(calls[0].searchParams.get('limit'), '100');
    assert.deepEqual(result.results.map(item => item.key), ['PARENT1']);
  });
});

test('Zotero read includes attachment full text when available', async () => {
  await withMockFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/users/0/items/ITEM1') {
      return jsonResponse({ key: 'ITEM1', data: { key: 'ITEM1', itemType: 'book', title: 'Local First' } });
    }
    if (parsed.pathname === '/api/users/0/items/ITEM1/children') {
      return jsonResponse([{ key: 'ATTACH1', data: { key: 'ATTACH1', itemType: 'attachment', title: 'PDF', contentType: 'application/pdf' } }]);
    }
    if (parsed.pathname === '/api/users/0/items/ATTACH1/fulltext') {
      return jsonResponse({ content: 'Indexed PDF text' });
    }
    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const result = await zotero.read({ itemKey: 'ITEM1' });
    assert.equal(result.item.title, 'Local First');
    assert.equal(result.attachments[0].key, 'ATTACH1');
    assert.equal(result.fullText, 'Indexed PDF text');
    assert.equal(result.fullTextItemKey, 'ATTACH1');
    assert.equal(result.fullTextError, '');
  });
});

test('Zotero read tolerates missing full text', async () => {
  await withMockFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/users/0/items/ITEM1') {
      return jsonResponse({ key: 'ITEM1', data: { key: 'ITEM1', itemType: 'webpage', title: 'Metadata only' } });
    }
    if (parsed.pathname === '/api/users/0/items/ITEM1/children') {
      return jsonResponse([{ key: 'ATTACH1', data: { key: 'ATTACH1', itemType: 'attachment', title: 'Snapshot' } }]);
    }
    if (parsed.pathname === '/api/users/0/items/ATTACH1/fulltext') {
      return jsonResponse('missing', 404);
    }
    throw new Error(`Unexpected URL ${url}`);
  }, async () => {
    const result = await zotero.read({ itemKey: 'ITEM1' });
    assert.equal(result.fullText, '');
    assert.match(result.fullTextError, /No indexed full text/);
  });
});

test('Zotero validates search text and item keys', async () => {
  assert.throws(() => zotero.__test.cleanQuery('  '), /empty/);
  assert.throws(() => zotero.__test.cleanItemKey('../bad'), /Invalid/);
  assert.equal(zotero.__test.cleanLimit(999), 20);
  assert.equal(zotero.__test.localApiUrl('/users/0/items', { q: 'x' }), 'http://127.0.0.1:23119/api/users/0/items?q=x');
  assert.ok(zotero.__test.titleMatchScore({ title: 'Recursive Language Models' }, 'tell me about recursive language model paper') >= 250);
  assert.ok(zotero.__test.titleMatchScore({ title: 'Recursive Language Models' }, 'RLM') >= 900);
  assert.ok(zotero.__test.titleMatchScore({ title: 'Recursive Language Models' }, 'zotero RLM papper') >= 900);
});
