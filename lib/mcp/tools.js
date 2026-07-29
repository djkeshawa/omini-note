// Vault tools exposed over MCP. Read tools are always available; write tools
// (create_note, append_to_note) are registered only when the server is
// started with writes explicitly allowed. All access goes through the same
// store/index modules the app uses, so validation, atomic writes, versioning,
// and search indexing behave identically.

const { randomUUID } = require('crypto');

const MAX_QUERY_LENGTH = 300;
const MAX_TITLE_LENGTH = 240;
const MAX_BODY_LENGTH = 200 * 1024;
const MAX_RESULT_BODY_LENGTH = 100 * 1024;

function capString(value, label, maxLength) {
  const clean = String(value ?? '').replace(/\0/g, '').trim();
  if (clean.length > maxLength) throw new Error(`${label} is too long (max ${maxLength} characters)`);
  return clean;
}

function stripSnippetMarks(snippet) {
  return String(snippet || '').replace(/<\/?mark>/g, '');
}

function noteSummary(note) {
  return {
    id: note.id,
    title: note.title || 'Untitled',
    tags: Array.isArray(note.tags) ? note.tags : [],
    modifiedAt: note.modifiedAt || note.diskModifiedAt || note.date || null,
    diskRevision: note.diskRevision || null,
  };
}

function createVaultTools({ store, idx, allowWrites = false } = {}) {
  async function resolveVault(vaultRef) {
    const cfg = await store.loadConfig();
    const vaults = cfg.vaults || [];
    const ref = String(vaultRef || '').trim();
    if (!ref) {
      const active = vaults.find(v => v.id === cfg.activeVaultId) || vaults[0];
      if (!active) throw new Error('No vaults exist yet');
      return active;
    }
    const lower = ref.toLowerCase();
    const vault = vaults.find(v => v.id === ref)
      || vaults.find(v => v.slug === ref)
      || vaults.find(v => String(v.name || '').toLowerCase() === lower);
    if (!vault) throw new Error(`Vault not found: ${ref}. Use list_vaults to see available vaults.`);
    return vault;
  }

  // The app rescans vaults into the SQLite index at boot; a standalone MCP
  // process may see a fresh index instead. If a vault has zero indexed notes
  // (so there are no embeddings to lose), populate it from disk once.
  const ensuredVaults = new Set();
  async function ensureVaultIndexed(vault) {
    if (ensuredVaults.has(vault.id)) return;
    ensuredVaults.add(vault.id);
    try {
      const health = idx.indexHealth(vault.id);
      if ((health.indexedNoteCount || 0) > 0) return;
      const data = await store.loadVault(vault.id);
      if ((data.notes || []).length) idx.rescanVault(vault.id, data.notes);
    } catch (e) {
      console.error('[mcp] vault index ensure failed', e?.message || e);
    }
  }

  async function findNoteByTitle(vaultId, title) {
    const vault = await store.loadVault(vaultId);
    const needle = String(title || '').trim().toLowerCase();
    return (vault.notes || []).find(n => String(n.title || '').trim().toLowerCase() === needle) || null;
  }

  const vaultProperty = {
    type: 'string',
    description: 'Vault id, slug, or name. Omit to use the active vault.',
  };

  const tools = [
    {
      name: 'list_vaults',
      description: 'List the available note vaults and which one is active.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const cfg = await store.loadConfig();
        return {
          vaults: (cfg.vaults || []).map(v => ({
            id: v.id,
            name: v.name,
            slug: v.slug,
            active: v.id === cfg.activeVaultId,
          })),
        };
      },
    },
    {
      name: 'search_notes',
      description: 'Full-text search across note titles, bodies, and tags in a vault. Returns matching notes with snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search terms' },
          vault: vaultProperty,
          limit: { type: 'number', description: 'Max results (default 10, max 50)' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const vault = await resolveVault(args.vault);
        await ensureVaultIndexed(vault);
        const query = capString(args.query, 'query', MAX_QUERY_LENGTH);
        if (!query) throw new Error('query is required');
        const limit = Math.max(1, Math.min(50, Math.trunc(Number(args.limit) || 10)));
        const results = idx.searchDetailed(vault.id, query, limit).map(row => ({
          id: row.id,
          title: row.title,
          snippet: stripSnippetMarks(row.snippet),
          tags: row.tags || [],
          modifiedAt: row.modifiedAt || null,
        }));
        return { vault: vault.name, count: results.length, results };
      },
    },
    {
      name: 'get_note',
      description: 'Read a note in full (front matter fields plus markdown body) by note id or exact title.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: { type: 'string', description: 'Note id (preferred when known)' },
          title: { type: 'string', description: 'Exact note title (case-insensitive) if the id is unknown' },
          vault: vaultProperty,
        },
      },
      handler: async (args) => {
        const vault = await resolveVault(args.vault);
        let note = null;
        if (args.noteId) note = await store.getNote(vault.id, capString(args.noteId, 'noteId', 200));
        else if (args.title) note = await findNoteByTitle(vault.id, capString(args.title, 'title', MAX_TITLE_LENGTH));
        else throw new Error('Provide noteId or title');
        if (!note) throw new Error('Note not found');
        const body = String(note.body || '');
        return {
          ...noteSummary(note),
          date: note.date || null,
          pinned: !!note.pinned,
          body: body.length > MAX_RESULT_BODY_LENGTH ? `${body.slice(0, MAX_RESULT_BODY_LENGTH)}\n…[truncated]` : body,
        };
      },
    },
    {
      name: 'get_backlinks',
      description: 'List the notes that link to a given note title via [[wiki links]], with the linking line as context.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Target note title' },
          vault: vaultProperty,
        },
        required: ['title'],
      },
      handler: async (args) => {
        const vault = await resolveVault(args.vault);
        await ensureVaultIndexed(vault);
        const title = capString(args.title, 'title', MAX_TITLE_LENGTH);
        return { backlinks: idx.backlinks(vault.id, title, 50) };
      },
    },
    {
      name: 'get_unlinked_mentions',
      description: 'List notes that mention a title as plain text without linking to it.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title to look for' },
          vault: vaultProperty,
        },
        required: ['title'],
      },
      handler: async (args) => {
        const vault = await resolveVault(args.vault);
        await ensureVaultIndexed(vault);
        const title = capString(args.title, 'title', MAX_TITLE_LENGTH);
        return {
          mentions: idx.unlinkedMentions(vault.id, title, 20).map(m => ({
            ...m,
            snippet: stripSnippetMarks(m.snippet),
          })),
        };
      },
    },
    {
      name: 'list_notes_by_tag',
      description: 'List the notes in a vault that carry a tag.',
      inputSchema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Tag name without the leading #' },
          vault: vaultProperty,
        },
        required: ['tag'],
      },
      handler: async (args) => {
        const vault = await resolveVault(args.vault);
        await ensureVaultIndexed(vault);
        const tag = capString(args.tag, 'tag', 64).replace(/^#/, '');
        const ids = new Set(idx.notesByTag(vault.id, tag));
        const data = await store.loadVault(vault.id);
        return {
          notes: (data.notes || []).filter(n => ids.has(n.id)).map(noteSummary),
        };
      },
    },
  ];

  if (allowWrites) {
    tools.push(
      {
        name: 'create_note',
        description: 'Create a new markdown note in a vault. Writes are enabled for this server.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            body: { type: 'string', description: 'Markdown body' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags without the leading #' },
            vault: vaultProperty,
          },
          required: ['title'],
        },
        handler: async (args) => {
          const vault = await resolveVault(args.vault);
          const title = capString(args.title, 'title', MAX_TITLE_LENGTH);
          if (!title) throw new Error('title is required');
          const body = String(args.body ?? '');
          if (body.length > MAX_BODY_LENGTH) throw new Error('body is too large');
          const tags = Array.isArray(args.tags) ? args.tags.map(t => capString(t, 'tag', 64)).filter(Boolean).slice(0, 20) : [];
          const id = `n_${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 8)}`;
          const saved = await store.saveNote(vault.id, { id, title, body, tags }, {
            expectedRevision: null,
          });
          try { idx.indexNote(vault.id, saved); } catch (e) { console.error('[mcp] index after create failed', e.message); }
          return { created: noteSummary(saved) };
        },
      },
      {
        name: 'append_to_note',
        description: 'Append markdown to the end of an existing note. Writes are enabled for this server.',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Note id (use search_notes or get_note to find it)' },
            markdown: { type: 'string', description: 'Markdown to append' },
            vault: vaultProperty,
          },
          required: ['noteId', 'markdown'],
        },
        handler: async (args) => {
          const vault = await resolveVault(args.vault);
          const noteId = capString(args.noteId, 'noteId', 200);
          const markdown = String(args.markdown ?? '');
          if (!markdown.trim()) throw new Error('markdown is required');
          if (markdown.length > MAX_BODY_LENGTH) throw new Error('markdown is too large');
          const note = await store.getNote(vault.id, noteId);
          if (!note) throw new Error('Note not found: ' + noteId);
          const body = String(note.body || '');
          const nextBody = body ? `${body.replace(/\n+$/, '')}\n\n${markdown.trim()}\n` : `${markdown.trim()}\n`;
          const saved = await store.saveNote(vault.id, { ...note, body: nextBody }, {
            expectedRevision: note.diskRevision,
          });
          try { idx.indexNote(vault.id, saved); } catch (e) { console.error('[mcp] index after append failed', e.message); }
          return { appended: noteSummary(saved) };
        },
      }
    );
  }

  return tools;
}

module.exports = { createVaultTools };
