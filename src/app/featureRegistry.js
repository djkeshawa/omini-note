(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_FEATURES = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const PACKS = Object.freeze([
    { id: 'planning', label: 'Planning', description: 'Agenda and workflow views for structured work.' },
    { id: 'canvas', label: 'Thinking Board', description: 'Arrange notes and ideas spatially.' },
    { id: 'research', label: 'Research', description: 'Zotero-assisted source reading and synthesis.' },
    { id: 'writer', label: 'Writer', description: 'Novel structure, scenes, and long-form planning.' },
    { id: 'agents', label: 'Agents', description: 'MCP and local memory integrations.' },
    { id: 'labs', label: 'Labs', description: 'Advanced graph, saved views, and experimental tools.' },
  ]);
  const PACK_IDS = new Set(PACKS.map(pack => pack.id));

  function normalizePacks(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => String(item || '').trim().toLowerCase()).filter(id => PACK_IDS.has(id)))];
  }

  function pluginTypes(plugins = []) {
    return new Set((Array.isArray(plugins) ? plugins : [])
      .filter(plugin => plugin && plugin.enabled !== false)
      .map(plugin => String(plugin.type || '')));
  }

  function deriveFeatureState(input = {}) {
    const explicit = new Set(normalizePacks(input.enabledPacks));
    const plugins = pluginTypes(input.plugins);
    const inferred = new Set();
    if (Number(input.canvasCount) > 0) inferred.add('canvas');
    if (input.novelistMode === true || (input.vaults || []).some(vault => vault?.novelistMode)) inferred.add('writer');
    if (plugins.has('zotero-reader')) inferred.add('research');
    if (plugins.has('llm-memory')) inferred.add('agents');
    if (Number(input.workflowTotal) > 0 || Number(input.agendaCount) > 0) inferred.add('planning');
    const enabled = new Set([...explicit, ...inferred]);
    const has = id => enabled.has(id);
    return {
      explicit: [...explicit],
      inferred: [...inferred],
      enabled: [...enabled],
      showAgenda: has('planning') || Number(input.agendaCount) > 0,
      showWorkflow: has('planning') || Number(input.workflowTotal) > 0,
      showCanvas: has('canvas') || Number(input.canvasCount) > 0,
      showWriter: has('writer') && input.novelistMode === true,
      showResearch: has('research'),
      showAgents: has('agents'),
      showLabs: has('labs'),
      showAskAi: input.assistanceEnabled === true,
    };
  }

  function togglePack(value, packId, enabled) {
    const current = new Set(normalizePacks(value));
    const id = String(packId || '').trim().toLowerCase();
    if (!PACK_IDS.has(id)) return [...current];
    if (enabled) current.add(id);
    else current.delete(id);
    return [...current];
  }

  return { PACKS, PACK_IDS, normalizePacks, deriveFeatureState, togglePack };
});
