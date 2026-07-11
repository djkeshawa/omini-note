(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
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
  const ACTION_REQUIREMENTS = Object.freeze({
    graph: 'labs',
    'smart-views': 'labs',
    calendar: 'agenda',
    todos: 'agenda',
    'set-workflow-status': 'workflow',
    'archive-workflow-note': 'workflow',
    canvas: 'canvas',
    'create-canvas': 'canvas',
    'open-canvas': 'canvas',
    'add-note-to-canvas': 'canvas',
    'delete-canvas': 'canvas',
    'ask-ai': 'assistance',
    'ai-backfill': 'assistance',
    'memory-import': 'agents',
    'memory-remember': 'agents',
    'memory-sync-links': 'agents',
    'memory-insights': 'agents',
    'template-project': 'planning',
    'template-reading': 'research',
    'template-novel-scene': 'writer',
    'capture-template-research': 'research',
    'capture-template-book-paper': 'research',
  });

  function normalizePacks(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => String(item || '').trim().toLowerCase()).filter(id => PACK_IDS.has(id)))];
  }

  function pluginTypes(plugins = []) {
    return new Set((Array.isArray(plugins) ? plugins : [])
      .filter(plugin => plugin && plugin.enabled !== false)
      .map(plugin => String(plugin.type || '')));
  }

  function pluginActionRequirements(plugins = []) {
    const requirements = {};
    for (const plugin of Array.isArray(plugins) ? plugins : []) {
      if (!plugin || plugin.enabled === false || !plugin.id) continue;
      const type = String(plugin.type || '');
      if (type === 'zotero-reader') requirements[`plugin-${plugin.id}`] = 'research';
      if (type === 'llm-memory') requirements[`plugin-${plugin.id}`] = 'agents';
    }
    return requirements;
  }

  function blocksContainWorkflow(blocks = []) {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (block?.workflow) return true;
      if (blocksContainWorkflow(block?.children)) return true;
    }
    return false;
  }

  function detectFeatureArtifacts(notes = []) {
    const result = {
      canvasArtifactCount: 0,
      smartViewArtifactCount: 0,
      workflowArtifactCount: 0,
      writerArtifactCount: 0,
    };
    for (const note of Array.isArray(notes) ? notes : []) {
      const body = String(note?.body || '');
      if (/\{\{canvas\s+[A-Za-z0-9_-]+\}\}/.test(body)) result.canvasArtifactCount += 1;
      if (/\{\{\s*smart-view(?:\s|\}\})/i.test(body)) result.smartViewArtifactCount += 1;
      if (blocksContainWorkflow(note?.blocks)) result.workflowArtifactCount += 1;
      if ((Array.isArray(note?.tags) ? note.tags : []).some(tag => /^novel-[a-z0-9-]+$/.test(String(tag || '')))
        || /(^|\n):::\s*plot-points(?:\s|\n)/.test(body)) {
        result.writerArtifactCount += 1;
      }
    }
    return result;
  }

  function deriveFeatureState(input = {}) {
    const explicit = new Set(normalizePacks(input.enabledPacks));
    const plugins = pluginTypes(input.plugins);
    const inferred = new Set();
    const hasCanvasData = Number(input.canvasCount) > 0 || Number(input.canvasArtifactCount) > 0;
    const hasWriterData = input.novelistMode === true
      || (Array.isArray(input.vaults) ? input.vaults : []).some(vault => vault?.novelistMode)
      || Number(input.writerArtifactCount) > 0;
    const hasWorkflowData = Number(input.workflowTotal) > 0 || Number(input.workflowArtifactCount) > 0;
    const hasAgendaData = Number(input.agendaCount) > 0;
    const hasLabsData = Number(input.smartViewArtifactCount) > 0;
    if (hasCanvasData) inferred.add('canvas');
    if (hasWriterData) inferred.add('writer');
    if (plugins.has('zotero-reader')) inferred.add('research');
    if (plugins.has('llm-memory')) inferred.add('agents');
    if (hasWorkflowData || hasAgendaData) inferred.add('planning');
    if (hasLabsData) inferred.add('labs');
    const enabled = new Set([...explicit, ...inferred]);
    const has = id => enabled.has(id);
    return {
      explicit: [...explicit],
      inferred: [...inferred],
      enabled: [...enabled],
      actionRequirements: pluginActionRequirements(input.plugins),
      showAgenda: explicit.has('planning') || hasAgendaData,
      showWorkflow: explicit.has('planning') || hasWorkflowData,
      showCanvas: has('canvas'),
      writerAvailable: has('writer'),
      showWriter: has('writer') && input.novelistMode === true,
      showResearch: has('research'),
      showAgents: has('agents'),
      showLabs: has('labs'),
      showAskAi: input.assistanceEnabled === true,
    };
  }

  function actionRequirement(actionId, featureState = {}) {
    const id = String(actionId || '');
    if (featureState.actionRequirements?.[id]) return featureState.actionRequirements[id];
    if (id.startsWith('smart-view-')) return 'labs';
    if (id.startsWith('canvas-')) return 'canvas';
    if (id.startsWith('zotero-')) return 'research';
    return ACTION_REQUIREMENTS[id] || '';
  }

  function requirementAvailable(requirement, featureState = {}) {
    const enabled = new Set(Array.isArray(featureState.enabled) ? featureState.enabled : []);
    if (!requirement) return true;
    if (requirement === 'agenda') return featureState.showAgenda === true;
    if (requirement === 'workflow') return featureState.showWorkflow === true;
    if (requirement === 'canvas') return featureState.showCanvas === true;
    if (requirement === 'labs') return featureState.showLabs === true;
    if (requirement === 'assistance') return featureState.showAskAi === true;
    return enabled.has(requirement);
  }

  function isActionAvailable(actionId, featureState = {}) {
    return requirementAvailable(actionRequirement(actionId, featureState), featureState);
  }

  function isViewAvailable(view, featureState = {}) {
    const viewId = String(view || '');
    if (viewId === 'novelist') return featureState.showWriter === true;
    const requirements = {
      ai: 'assistance',
      graph: 'labs',
      'smart-views': 'labs',
      calendar: 'agenda',
      todos: 'agenda',
      workflow: 'workflow',
      canvas: 'canvas',
    };
    return requirementAvailable(requirements[viewId] || '', featureState);
  }

  function togglePack(value, packId, enabled) {
    const current = new Set(normalizePacks(value));
    const id = String(packId || '').trim().toLowerCase();
    if (!PACK_IDS.has(id)) return [...current];
    if (enabled) current.add(id);
    else current.delete(id);
    return [...current];
  }

  return {
    PACKS,
    PACK_IDS,
    ACTION_REQUIREMENTS,
    normalizePacks,
    detectFeatureArtifacts,
    deriveFeatureState,
    isActionAvailable,
    isViewAvailable,
    togglePack,
  };
});
