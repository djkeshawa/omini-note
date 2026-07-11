import { hasDesktopBridge, platformApi } from '../../../platform/index.js';
import { storage } from '../../../shared/storageUtils.js';
import connectionsModel from '../../../editor/connectionsModel.js';

const { useEffect, useMemo, useState } = React;

function memoryNodeTitle(node) {
  const firstLine = String(node?.content || '')
    .split('\n')
    .map(line => line.replace(/^[#>\-*\s]+/, '').trim())
    .find(Boolean) || '';
  return firstLine.slice(0, 80) || node?.category || 'Memory';
}

export function useConnectionsController({
  note,
  notes,
  links,
  vaultId,
  memoryEnabled,
  connectionsRefreshToken,
  blocksToMarkdown,
  onLinkMention,
  onAcceptSuggestedConnection,
  onIgnoreSuggestedConnection,
}) {
  const hasDisk = hasDesktopBridge();
  const inMemoryBacklinks = useMemo(() => {
    if (hasDisk) return [];
    const escapedTitle = note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(`\\[\\[${escapedTitle}\\]\\]`, 'i');
    return notes.filter(candidate => {
      if (candidate.id === note.id) return false;
      return linkPattern.test(candidate.body || blocksToMarkdown(candidate.blocks || []));
    }).map(candidate => {
      const body = candidate.body || blocksToMarkdown(candidate.blocks || []);
      const context = body.split('\n').find(line => line.toLowerCase().includes(`[[${note.title.toLowerCase()}]]`));
      return { id: candidate.id, title: candidate.title, context: context || '' };
    });
  }, [blocksToMarkdown, hasDisk, note, notes]);

  const [diskBacklinks, setDiskBacklinks] = useState(null);
  useEffect(() => {
    if (!hasDisk || !vaultId) {
      setDiskBacklinks(null);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await platformApi.search.backlinks(vaultId, note.title);
        if (!cancelled && response.ok) setDiskBacklinks(response.value);
      } catch (error) {
        console.error('backlinks failed', error);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [connectionsRefreshToken, hasDisk, note.id, note.title, vaultId]);
  const backlinks = diskBacklinks != null ? diskBacklinks : inMemoryBacklinks;

  const [mentions, setMentions] = useState([]);
  useEffect(() => {
    if (!hasDisk || !vaultId || !String(note.title || '').trim()) {
      setMentions([]);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await platformApi.search.unlinkedMentions(vaultId, note.title, 8);
        if (!cancelled && response.ok) setMentions(response.value || []);
      } catch (error) {
        console.error('unlinked mentions failed', error);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [connectionsRefreshToken, hasDisk, note.id, note.title, vaultId]);
  const linkMention = (mention) => {
    if (!onLinkMention) return;
    onLinkMention(mention.id);
    setMentions(items => items.filter(item => item.id !== mention.id));
  };

  const [related, setRelated] = useState({ items: [], mode: null, loading: false });
  useEffect(() => {
    if (!hasDisk || !vaultId || !note.id) {
      setRelated({ items: [], mode: null, loading: false });
      return undefined;
    }
    let cancelled = false;
    setRelated(previous => ({ ...previous, loading: true }));
    const handle = setTimeout(async () => {
      try {
        const response = await platformApi.ai.related(vaultId, note.id, { limit: 6 });
        if (cancelled) return;
        if (response?.ok && response.value?.ok) {
          setRelated({ items: response.value.items || [], mode: response.value.mode, loading: false });
        } else {
          setRelated({ items: [], mode: null, loading: false });
        }
      } catch (_error) {
        if (!cancelled) setRelated({ items: [], mode: null, loading: false });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [hasDisk, note.id, vaultId]);

  const ignoredKey = `mn:ignoredConnections:${vaultId || 'local'}:${note.id}`;
  const [ignoredIds, setIgnoredIds] = useState(() => storage.getJson(ignoredKey, []) || []);
  useEffect(() => setIgnoredIds(storage.getJson(ignoredKey, []) || []), [ignoredKey]);
  const suggested = useMemo(() => connectionsModel.suggestedConnections?.({
    noteId: note.id,
    currentNote: note,
    notes,
    related: related.items,
    mode: related.mode,
    links,
    ignoredIds,
    limit: 4,
  }) || [], [ignoredIds, links, note, notes, related.items, related.mode]);
  const suggestedIds = useMemo(() => new Set(suggested.map(item => String(item.noteId || item.id || ''))), [suggested]);
  const passiveRelated = useMemo(
    () => related.items.filter(item => !suggestedIds.has(String(item.noteId || item.id || ''))),
    [related.items, suggestedIds]
  );
  const ignoreSuggested = (item) => {
    const id = connectionsModel.connectionNoteId?.(item) || item?.noteId || item?.id;
    if (!id) return;
    setIgnoredIds(current => {
      const next = [...new Set([...(current || []), String(id)])];
      storage.setJson(ignoredKey, next);
      return next;
    });
    onIgnoreSuggestedConnection?.(item);
  };
  const acceptSuggested = (item) => {
    if (onAcceptSuggestedConnection?.(item) !== false) ignoreSuggested(item);
  };

  const [connected, setConnected] = useState({ items: [], explanation: '', via: '', loading: false });
  useEffect(() => {
    const memory = platformApi.integrations.memory;
    if (!hasDisk || !memoryEnabled || !vaultId || !note.id || !memory.connected) {
      setConnected({ items: [], explanation: '', via: '', loading: false });
      return undefined;
    }
    let cancelled = false;
    setConnected(previous => ({ ...previous, loading: true }));
    const handle = setTimeout(async () => {
      try {
        const response = await memory.connected(vaultId, note.id, { limit: 8 });
        if (cancelled) return;
        const value = response?.ok ? response.value : null;
        const neighbors = value?.neighbors;
        if (!neighbors?.nodes?.length) {
          setConnected({ items: [], explanation: '', via: '', loading: false });
          return;
        }
        const items = neighbors.nodes
          .filter(node => node.id && node.id !== value.memoryId)
          .filter(node => node.relevanceScore == null || node.relevanceScore >= 0.2)
          .slice(0, 6)
          .map(node => ({
            id: node.id,
            title: memoryNodeTitle(node),
            content: String(node.content || '').replace(/\s+/g, ' ').trim(),
            snippet: String(node.content || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            category: node.category || '',
          }));
        setConnected({ items, explanation: String(neighbors.explanation || ''), via: value.via || '', loading: false });
      } catch (_error) {
        if (!cancelled) setConnected({ items: [], explanation: '', via: '', loading: false });
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [connectionsRefreshToken, hasDisk, memoryEnabled, note.id, vaultId]);

  return {
    backlinks,
    mentions,
    linkMention,
    related,
    suggestedConnections: suggested,
    passiveRelatedItems: passiveRelated,
    ignoreSuggestedConnection: ignoreSuggested,
    acceptSuggestedConnection: acceptSuggested,
    connected,
  };
}
