(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_MEMORY_ACTIONS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function plural(count, singular, pluralValue = `${singular}s`) {
    return `${count} ${count === 1 ? singular : pluralValue}`;
  }

  function syncResultMessage(value = {}) {
    if (!value.notesRemembered) {
      return 'No remembered notes yet — run “Remember this note” on a few linked notes first, then sync.';
    }
    const parts = [
      `Processed ${plural(Number(value.wikiLinks) || 0, 'wiki-link')} across ${plural(Number(value.notesRemembered) || 0, 'remembered note')}.`,
      `${plural(Number(value.created) || 0, 'relationship')} created; ${plural(Number(value.updated) || 0, 'relationship')} refreshed.`,
    ];
    if (value.failed) parts.push(`${plural(Number(value.failed) || 0, 'relationship')} failed.`);
    if (value.remaining) parts.push(`${plural(Number(value.remaining) || 0, 'relationship')} remain for the next sync batch.`);
    if (value.staleManaged) parts.push(`${plural(Number(value.staleManaged) || 0, 'stale VispNote relationship')} remain because the memory server cannot delete relationships yet.`);
    if (value.unmanagedConflicts) parts.push(`${plural(Number(value.unmanagedConflicts) || 0, 'unmanaged relationship conflict')} were preserved.`);
    if (value.ambiguousLegacy) parts.push(`${plural(Number(value.ambiguousLegacy) || 0, 'legacy memory mapping')} were ambiguous and skipped.`);
    if (value.indexTruncated) parts.push('The memory index was truncated; run sync again after reducing or paging the memory set.');
    return parts.join(' ');
  }

  function insightsResultMessage(reportResult, duplicateResult) {
    if (reportResult?.ok === false) throw new Error(reportResult.error || 'Could not load memory insights');
    const summary = reportResult?.value?.summary || {};
    const parts = [
      `${summary.total_memories ?? 0} memories`,
      `${summary.total_relationships ?? 0} relationships`,
    ];
    if (summary.active_intents != null) parts.push(`${summary.active_intents} active intents`);
    if (duplicateResult?.ok === false) {
      parts.push('duplicate scan unavailable');
    } else {
      const candidates = duplicateResult?.value?.candidates || duplicateResult?.value?.duplicates || [];
      const count = Array.isArray(candidates) ? candidates.length : 0;
      parts.push(`${count} duplicate candidate${count === 1 ? '' : 's'}`);
    }
    return `Memory graph: ${parts.join(' · ')}.`;
  }

  return { syncResultMessage, insightsResultMessage };
});
