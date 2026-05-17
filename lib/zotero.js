// Read-only connector for Zotero Desktop's local API.
// The API is intentionally pinned to localhost so AI tools cannot redirect it.

const LOCAL_API_BASE = 'http://127.0.0.1:23119/api';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_QUERY_CHARS = 300;
const MAX_ITEM_KEY_CHARS = 80;
const MAX_RESULTS = 20;
const FALLBACK_SCAN_LIMIT = 100;
const MAX_FULLTEXT_CHARS = 12000;
const ZOTERO_ITEM_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;

function timeoutSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function cleanQuery(value) {
  const query = String(value || '').replace(/\0/g, '').trim();
  if (!query) throw new Error('Zotero query is empty');
  return query.slice(0, MAX_QUERY_CHARS);
}

function cleanItemKey(value) {
  const itemKey = String(value || '').trim();
  if (!ZOTERO_ITEM_KEY_RE.test(itemKey) || itemKey.length > MAX_ITEM_KEY_CHARS) {
    throw new Error('Invalid Zotero item key');
  }
  return itemKey;
}

function cleanLimit(value, fallback = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_RESULTS, Math.trunc(n)));
}

function localApiUrl(path, params = {}) {
  const url = new URL(`${LOCAL_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.href;
}

async function fetchJson(path, params = {}, options = {}) {
  const timeout = timeoutSignal(options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(localApiUrl(path, params), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Zotero-API-Version': '3',
      },
      signal: timeout.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const error = new Error(text.trim() || `Zotero API returned ${res.status}`);
      error.status = res.status;
      throw error;
    }
    const raw = text.trim();
    try {
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      const error = new Error(raw || 'Zotero API did not return JSON');
      if (/local api is not enabled/i.test(raw)) error.code = 'ZOTERO_LOCAL_API_DISABLED';
      throw error;
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Zotero local API timed out');
    if (e?.status || e?.code) throw e;
    throw new Error('Zotero Desktop is not reachable on 127.0.0.1:23119');
  } finally {
    timeout.clear();
  }
}

function itemTitle(data = {}) {
  return String(data.title || data.nameOfAct || data.subject || data.caseName || 'Untitled Zotero item').trim();
}

function creatorsText(creators = []) {
  return (Array.isArray(creators) ? creators : [])
    .map(creator => [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() || String(creator.name || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(', ');
}

function normalizeItem(item = {}) {
  const data = item.data || item;
  const key = String(item.key || data.key || '').trim();
  return {
    key,
    itemType: String(data.itemType || '').trim(),
    title: itemTitle(data),
    creators: creatorsText(data.creators),
    date: String(data.date || data.year || '').trim(),
    publicationTitle: String(data.publicationTitle || data.bookTitle || data.proceedingsTitle || '').trim(),
    url: String(data.url || '').trim(),
    doi: String(data.DOI || data.doi || '').trim(),
    abstractNote: String(data.abstractNote || '').trim().slice(0, 1600),
    parentItem: String(data.parentItem || '').trim(),
  };
}

function normalizeAttachment(item = {}) {
  const data = item.data || item;
  return {
    key: String(item.key || data.key || '').trim(),
    title: itemTitle(data),
    contentType: String(data.contentType || '').trim(),
    filename: String(data.filename || '').trim(),
    linkMode: String(data.linkMode || '').trim(),
  };
}

function pickFullTextPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(payload.content || payload.text || payload.fulltext || '').trim();
}

function titleWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(word => word && !['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'zotero', 'paper', 'papper', 'article', 'document', 'pdf'].includes(word));
}

function titleMatchScore(item, query) {
  const queryWords = titleWords(query);
  const title = String(item?.title || '');
  const titleText = title.toLowerCase();
  const titleWordList = titleWords(title);
  const titleKey = titleWordList.join(' ');
  const titleAcronym = titleWordList.map(word => word[0]).join('');
  const queryKey = queryWords.join(' ');
  if (!queryWords.length || !titleKey) return 0;
  if (titleKey === queryKey) return 1000;
  if (titleAcronym && queryKey === titleAcronym) return 950;
  if (titleAcronym && queryWords.includes(titleAcronym)) return 900;
  if (titleKey.includes(queryKey) || queryKey.includes(titleKey)) return 800;
  let hits = 0;
  for (const word of queryWords) {
    if (titleText.includes(word)) hits += 1;
  }
  return hits ? Math.round((hits / queryWords.length) * 500) + hits : 0;
}

function parentFirst(items) {
  return [...items].sort((a, b) => {
    const aChild = a.parentItem || a.itemType === 'note' || a.itemType === 'attachment';
    const bChild = b.parentItem || b.itemType === 'note' || b.itemType === 'attachment';
    if (aChild !== bChild) return aChild ? 1 : -1;
    return 0;
  });
}

async function status() {
  try {
    await fetchJson('/users/0/items', { limit: 1, format: 'json' });
    return { reachable: true, baseUrl: LOCAL_API_BASE };
  } catch (e) {
    return { reachable: false, baseUrl: LOCAL_API_BASE, error: e.message || String(e) };
  }
}

async function search(input = {}) {
  const query = cleanQuery(input.query);
  const limit = cleanLimit(input.limit);
  const items = await fetchJson('/users/0/items', {
    q: query,
    qmode: 'everything',
    itemType: '-attachment',
    limit,
    format: 'json',
  });
  let normalized = parentFirst((Array.isArray(items) ? items : []).map(normalizeItem).filter(item => item.key));
  if (!normalized.length) {
    const fallbackItems = await fetchJson('/users/0/items', {
      itemType: '-attachment',
      limit: FALLBACK_SCAN_LIMIT,
      format: 'json',
    });
    normalized = parentFirst((Array.isArray(fallbackItems) ? fallbackItems : [])
      .map(normalizeItem)
      .filter(item => item.key)
      .map(item => ({ ...item, matchScore: titleMatchScore(item, query) }))
      .filter(item => item.matchScore >= 250)
      .sort((a, b) => b.matchScore - a.matchScore));
  }
  return {
    query,
    results: normalized.slice(0, limit),
  };
}

async function read(input = {}) {
  const itemKey = cleanItemKey(input.itemKey || input.key);
  const includeFullText = input.includeFullText !== false;
  const item = normalizeItem(await fetchJson(`/users/0/items/${encodeURIComponent(itemKey)}`, { format: 'json' }));
  const children = await fetchJson(`/users/0/items/${encodeURIComponent(itemKey)}/children`, {
    itemType: 'attachment',
    format: 'json',
  }).catch(() => []);
  const attachments = (Array.isArray(children) ? children : []).map(normalizeAttachment).filter(attachment => attachment.key);
  let fullText = '';
  let fullTextItemKey = '';
  let fullTextError = '';
  let fullTextTruncated = false;
  if (includeFullText) {
    for (const attachment of attachments) {
      try {
        const payload = await fetchJson(`/users/0/items/${encodeURIComponent(attachment.key)}/fulltext`, { format: 'json' });
        const text = pickFullTextPayload(payload);
        if (text) {
          fullText = text.slice(0, MAX_FULLTEXT_CHARS);
          fullTextTruncated = text.length > MAX_FULLTEXT_CHARS;
          fullTextItemKey = attachment.key;
          break;
        }
      } catch (e) {
        fullTextError = e.status === 404 ? 'No indexed full text is available for this attachment.' : (e.message || String(e));
      }
    }
  }
  return {
    item,
    attachments,
    fullText,
    fullTextItemKey,
    fullTextTruncated,
    fullTextError: fullText ? '' : fullTextError,
  };
}

module.exports = {
  status,
  search,
  read,
  __test: {
    cleanQuery,
    cleanItemKey,
    cleanLimit,
    localApiUrl,
    normalizeItem,
    normalizeAttachment,
    pickFullTextPayload,
    titleWords,
    titleMatchScore,
    parentFirst,
  },
};
