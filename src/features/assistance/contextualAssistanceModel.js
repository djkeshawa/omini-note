// Pure model for source-linked, preview-first assistance outputs.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const ACTIONS = Object.freeze([
    {
      id: 'brief',
      label: 'Brief',
      suffix: 'Brief',
      description: 'A compact summary of what matters.',
      instruction: 'Create a concise Markdown brief from the source note. Preserve concrete facts, decisions, dates, tasks, names, and uncertainty. Use a short overview followed by key points. Do not invent details. Return Markdown only and do not include a Sources section.',
    },
    {
      id: 'outline',
      label: 'Outline',
      suffix: 'Outline',
      description: 'A structured map of the note.',
      instruction: 'Create a clear hierarchical Markdown outline from the source note. Preserve its actual order and meaning. Use headings and nested lists where useful. Do not invent details. Return Markdown only and do not include a Sources section.',
    },
    {
      id: 'decisions',
      label: 'Decisions',
      suffix: 'Decisions',
      description: 'Explicit decisions and unresolved choices.',
      instruction: 'Extract the decisions and unresolved choices in the source note as concise Markdown. Separate explicit decisions from open questions. If none are present, say so plainly. Do not invent decisions. Return Markdown only and do not include a Sources section.',
    },
    {
      id: 'next-actions',
      label: 'Next actions',
      suffix: 'Next actions',
      description: 'Actionable follow-ups as checkboxes.',
      instruction: 'Extract actionable next steps from the source note as a Markdown task list. Keep explicit tasks faithful to the source and label any reasonable inference as inferred. If no actions are supported, say so plainly. Return Markdown only and do not include a Sources section.',
    },
  ]);

  function actionById(value) {
    return ACTIONS.find(action => action.id === String(value || '')) || null;
  }

  function cleanSourceTitle(value) {
    return String(value || 'Untitled')
      .replace(/[\[\]\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'Untitled';
  }

  function cleanMarkdown(value) {
    let body = String(value || '').trim();
    const fenced = body.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
    if (fenced) body = fenced[1].trim();
    const sourceHeading = body.search(/^##?\s+Sources?\s*$/im);
    if (sourceHeading >= 0) body = body.slice(0, sourceHeading).trim();
    return body;
  }

  function buildOutput({ actionId, sourceNote = {}, text = '' } = {}) {
    const action = actionById(actionId);
    if (!action) throw new Error('Unsupported assistance action');
    const sourceTitle = cleanSourceTitle(sourceNote.title);
    const content = cleanMarkdown(text);
    if (!content) throw new Error('Assistance returned no Markdown');
    // Link resolution splits the target on '|' and '#' (mnLinkTargetsForNote in
    // src/shared/data.jsx), so a title containing either cannot be addressed by
    // a wiki link -- "[[Bug #42 triage]]" resolves to a note called "Bug". Name
    // the source in plain text instead: no link is better than a link that
    // silently points somewhere else.
    const sourceLine = /[|#]/.test(sourceTitle) ? sourceTitle : `[[${sourceTitle}]]`;
    return {
      actionId: action.id,
      title: `${sourceTitle} - ${action.suffix}`,
      body: `${content}\n\n## Source\n- ${sourceLine}\n`,
      source: {
        id: String(sourceNote.id || ''),
        title: sourceTitle,
      },
    };
  }

  return { ACTIONS, actionById, cleanSourceTitle, cleanMarkdown, buildOutput };
});
