import * as aiModels from './aiModels.js';
const { MN_ASK_EDIT_ACTIONS, MN_NOVEL_STRUCTURE_TAGS, mnIsSupportingNovelNote, mnSupportingNovelNotes, mnSupportingNotesEditInstruction, MN_ASK_SUGGESTIONS, MN_AI_PLANNER_TIMEOUT_MS, MN_AI_CHAT_TIMEOUT_MS, MN_AI_NOTES_TIMEOUT_MS, MN_AI_VIRTUAL_WRITE_TOOLS, MN_AI_REPORT_TARGETS, MN_AI_VIRTUAL_TOOLS, mnReportAiOutput, mnAskAiJobId, mnAskMessageId, mnNormalizeAskMessages, mnAskMessageThreadText, mnBuildAskThreadMessages, mnBuildAskThreadPrompt, mnRecentAskThreadNote, mnLastAskMessage, mnLooksLikeNoteEditRequest, mnMentionsThreadNote, mnAssistantAskedForActionDetail, mnBuildContextualActionQuery, mnAiCurrentNoteMarkdown, mnAiMarkdownMarkers, mnAiMissingMarkdownMarkers, mnAiBuildMarkdownPreview, mnAiShouldShareCurrentContext, mnWantsZoteroAssistedNoteEdit, mnWantsZoteroSummaryNote, mnAiCurrentContextMessage, mnAiVirtualToolMeta, mnAiCleanVirtualToolArgs, mnAiToolCallsFromPlanResult } = aiModels;

function mnAiPlainInlineText(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function mnAiLooksLikeSectionLabel(text) {
  const clean = mnAiPlainInlineText(text);
  if (!clean.endsWith(':')) return false;
  const label = clean.slice(0, -1).trim();
  if (!label || label.length > 80) return false;
  if (/[.!?]/.test(label)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  return words.some(word => /^[A-Z0-9]/.test(word));
}

function mnAskStatusText(status) {
  const provider = String(status?.config?.provider || 'ollama').toLowerCase();
  const providerLabel = mnAiProviderLabel(provider);
  if (!status) return provider === 'ollama' ? 'Checking local AI' : `Checking ${providerLabel}`;
  if (provider !== 'ollama') return status.chatModelOk ? `${providerLabel} ready` : 'Setup needed';
  if (!status.reachable) return 'Setup needed';
  if (!status.chatModelOk) return 'Setup needed';
  if (!status.embedModelOk) return 'Keyword search mode';
  return 'Semantic search ready';
}

function mnAiProviderLabel(provider) {
  return ({
    ollama: 'Ollama',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    custom: 'Custom provider',
  })[String(provider || 'ollama').toLowerCase()] || 'AI provider';
}

function mnAskFooterHint(status, embedded) {
  const closeHint = embedded ? '' : ' · Esc to close';
  const askHint = `Enter to ask · Shift+Enter for newline${closeHint}`;
  if (!status) return `Checking AI setup · ${askHint}`;
  const provider = String(status?.config?.provider || 'ollama').toLowerCase();
  const providerLabel = mnAiProviderLabel(provider);
  if (provider !== 'ollama') {
    if (status.chatModelOk) return `${providerLabel} ready · ${askHint}`;
    return `${providerLabel} setup needed - check Settings > AI`;
  }
  if (status.reachable === false) return 'Local AI setup needed - Ask can still search notes and show setup steps';
  if (!status.chatModelOk) return 'Local chat model setup needed - Ask can still search notes and show setup steps';
  if (!status.embedModelOk) {
    return status?.embedModelReason || `Using keyword search. For semantic search: \`ollama pull ${status?.config?.embedModel}\``;
  }
  return `Semantic search ready · ${askHint}`;
}

function MnAiSetupNotice({ status, T }) {
  if (!status?.setupRequired) return null;
  const steps = Array.isArray(status.setupSteps) ? status.setupSteps.filter(Boolean).slice(0, 5) : [];
  const reason = String(status.reason || 'AI setup is incomplete.').trim();
  return (
    <div style={{
      padding: 13,
      borderRadius: 8,
      border: `1px solid color-mix(in oklab, ${T.warn || T.accent || T.ink} 36%, ${T.lineSub})`,
      background: `color-mix(in oklab, ${T.warn || T.accent || T.ink} 8%, ${T.bgSub})`,
      color: T.ink,
      marginBottom: 14,
    }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 700, color: T.ink }}>
        AI setup needed
      </div>
      <div style={{ marginTop: 5, fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.45, color: T.inkMed }}>
        {reason}
      </div>
      {steps.length > 0 && (
        <ol style={{
          margin: '9px 0 0',
          paddingLeft: 18,
          display: 'grid',
          gap: 4,
          fontFamily: 'var(--mn-body)',
          fontSize: 12.5,
          lineHeight: 1.45,
          color: T.inkMed,
        }}>
          {steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
        </ol>
      )}
    </div>
  );
}

function mnAiWikiLinkParts(label) {
  const raw = String(label || '').trim();
  const [targetPart, aliasPart] = raw.split('|');
  const target = String(targetPart || '').trim();
  const title = target.replace(/#[\s\S]*$/, '').trim();
  const alias = String(aliasPart || '').trim();
  return {
    raw,
    title,
    display: alias || target || raw,
  };
}

function mnAiHeadingKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[*_`#:[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MN_AI_GENERIC_SUMMARY_HEADINGS = new Set([
  'notes summary',
  'summary',
  'summary of all notes',
  'all notes summary',
  'vault summary',
]);

function mnAiIsGenericSummaryHeading(text) {
  return MN_AI_GENERIC_SUMMARY_HEADINGS.has(mnAiHeadingKey(text));
}

function mnNormalizeAiResponseBlocks(blocks = []) {
  let leadingGenericHeadings = 0;
  while (
    blocks[leadingGenericHeadings]?.type === 'heading' &&
    mnAiIsGenericSummaryHeading(blocks[leadingGenericHeadings]?.text)
  ) {
    leadingGenericHeadings++;
  }
  if (leadingGenericHeadings <= 1) return blocks;
  return blocks.slice(leadingGenericHeadings - 1);
}

function mnAiInlineText(text, T, options = {}) {
  const source = String(text || '');
  const parts = [];
  const re = /(\[\[[^\]]+\]\])|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = re.exec(source))) {
    if (match.index > last) parts.push(<span key={key++}>{source.slice(last, match.index)}</span>);
    const token = match[0];
    if (token.startsWith('[[')) {
      const link = mnAiWikiLinkParts(token.slice(2, -2));
      const canOpen = !!options.onOpenWikiLink && !!link.title;
      parts.push(
        <a key={key++}
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (canOpen) options.onOpenWikiLink(link.title);
          }}
          style={{
            color: T.accent,
            cursor: canOpen ? 'pointer' : 'default',
            borderBottom: `1px dotted ${T.accent}`,
            padding: '0 1px',
            textDecoration: 'none',
            fontFamily: 'inherit',
          }}>
          {link.display}
        </a>
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={key++} style={{
          fontFamily: 'var(--mn-mono)',
          fontSize: '0.9em',
          background: T.bgSub,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 4,
          padding: '1px 5px',
          color: T.ink,
        }}>{token.slice(1, -1)}</code>
      );
    } else if (token.startsWith('**')) {
      parts.push(<strong key={key++} style={{ color: T.ink, fontWeight: 700 }}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < source.length) parts.push(<span key={key++}>{source.slice(last)}</span>);
  return parts;
}

function mnParseAiResponseBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let code = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'p', text: paragraph.join(' ').trim() });
    paragraph = [];
  };
  for (const rawLine of lines) {
    const fence = rawLine.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (code) {
        blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = null;
      } else {
        flushParagraph();
        code = { lang: fence[1] || '', lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(rawLine);
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      const item = { index: ordered[1], text: ordered[2].trim() };
      if (prev?.type === 'ol') prev.items.push(item);
      else blocks.push({ type: 'ol', items: [item] });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (mnAiLooksLikeSectionLabel(bullet[1])) {
        blocks.push({ type: 'heading', level: 3, text: bullet[1].trim(), promoted: true });
        continue;
      }
      const prev = blocks[blocks.length - 1];
      const item = bullet[1].trim();
      if (prev?.type === 'ul') prev.items.push(item);
      else blocks.push({ type: 'ul', items: [item] });
      continue;
    }
    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'quote') prev.lines.push(quote[1].trim());
      else blocks.push({ type: 'quote', lines: [quote[1].trim()] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  if (code) blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
  return blocks;
}

function MnAiFormattedResponse({ text, T, allNotes = [], onOpenNote, onClose, embedded = false }) {
  const blocks = React.useMemo(() => mnNormalizeAiResponseBlocks(mnParseAiResponseBlocks(text)), [text]);
  const onOpenWikiLink = React.useCallback((title) => {
    const cleanTitle = String(title || '').trim().toLowerCase();
    if (!cleanTitle) return;
    const note = (allNotes || []).find(item => String(item?.title || '').trim().toLowerCase() === cleanTitle);
    const opened = note?.id ? onOpenNote?.(note.id) : false;
    if (opened !== false && !embedded) onClose && onClose();
  }, [allNotes, onOpenNote, onClose, embedded]);
  const renderInline = React.useCallback(
    value => mnAiInlineText(value, T, { onOpenWikiLink }),
    [T, onOpenWikiLink]
  );
  if (!blocks.length) return null;
  return (
    <div style={{
      display: 'grid',
      gap: 9,
      fontFamily: 'var(--mn-body)',
      fontSize: 14.5,
      lineHeight: 1.62,
      color: T.ink,
    }}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <div key={index} style={{
              marginTop: index === 0 ? 0 : 6,
              paddingBottom: 3,
              borderBottom: block.level <= 2 ? `1px solid ${T.lineSub}` : 'none',
              fontFamily: 'var(--mn-ui)',
              fontSize: block.level === 1 ? 15.5 : 14.5,
              fontWeight: 750,
              lineHeight: 1.35,
              color: T.ink,
            }}>{renderInline(block.text)}</div>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          return (
            <div key={index} style={{ display: 'grid', gap: 5 }}>
              {block.items.map((item, itemIndex) => {
                const textValue = typeof item === 'string' ? item : item.text;
                const marker = block.type === 'ol' ? `${item.index || itemIndex + 1}.` : '';
                return (
                  <div key={itemIndex} style={{
                    display: 'grid',
                    gridTemplateColumns: block.type === 'ol' ? '24px minmax(0, 1fr)' : '14px minmax(0, 1fr)',
                    gap: 7,
                    alignItems: 'start',
                  }}>
                    <span style={{
                      marginTop: block.type === 'ol' ? 0 : 9,
                      width: block.type === 'ol' ? 24 : 5,
                      height: block.type === 'ol' ? 'auto' : 5,
                      borderRadius: 5,
                      background: block.type === 'ol' ? 'transparent' : T.accent,
                      color: T.inkDim,
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}>{marker}</span>
                    <span>{renderInline(textValue)}</span>
                  </div>
                );
              })}
            </div>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={index} style={{
              margin: 0,
              padding: '7px 11px',
              borderLeft: `2px solid ${T.accent}`,
              background: T.bgSub,
              color: T.inkMed,
              borderRadius: 6,
            }}>{renderInline(block.lines.join(' '))}</blockquote>
          );
        }
        if (block.type === 'code') {
          return (
            <div key={index} style={{
              borderRadius: 7,
              border: `1px solid ${T.lineSub}`,
              background: T.bgSub,
              overflow: 'hidden',
            }}>
              {block.lang && (
                <div style={{
                  padding: '5px 10px',
                  borderBottom: `1px solid ${T.lineSub}`,
                  color: T.inkDim,
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                }}>{block.lang}</div>
              )}
              <pre style={{
                margin: 0,
                padding: '10px 11px',
                color: T.ink,
                overflow: 'auto',
                fontFamily: 'var(--mn-mono)',
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: 'pre',
              }}><code>{block.text}</code></pre>
            </div>
          );
        }
        return <p key={index} style={{ margin: 0 }}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

function MnCurrentNoteSuggestionsCard({ result, busy, error, T, onRefresh, onReject, onOpenNote, onClose, embedded, noteIdSet }) {
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const sourceById = new Map(sources.map(source => [String(source.id || source.title || ''), source]));
  const openSource = (source) => {
    const sourceId = String(source?.id || '');
    if (!sourceId || !noteIdSet?.has?.(sourceId)) return;
    const opened = onOpenNote?.(sourceId);
    if (opened !== false && !embedded) onClose && onClose();
  };
  return (
    <div style={{
      marginBottom: 16,
      padding: 12,
      borderRadius: 8,
      border: `1px solid ${T.lineSub}`,
      background: T.bgSub,
      color: T.ink,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720 }}>Current note suggestions</div>
        {result?.providerModelLabel && (
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{result.providerModelLabel}</div>
        )}
        {result?.hosted && (
          <div style={{
            fontFamily: 'var(--mn-ui)', fontWeight: 600,
            fontSize: 11,
            color: T.warn || T.inkDim,
          }}>Hosted provider</div>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onRefresh} disabled={busy} style={mnAskSecondaryButton(T)}>
          {busy ? 'Checking...' : 'Refresh'}
        </button>
        <button type="button" onClick={onReject} disabled={busy} style={mnAskSecondaryButton(T)}>
          Reject
        </button>
      </div>
      {error && (
        <div style={{
          border: `1px solid color-mix(in oklab, ${T.warn || T.danger || T.ink} 35%, ${T.lineSub})`,
          borderRadius: 7,
          background: T.bg,
          color: T.warn || T.danger || T.ink,
          padding: '8px 10px',
          fontFamily: 'var(--mn-ui)',
          fontSize: 12.5,
          marginBottom: result ? 10 : 0,
        }}>{error}</div>
      )}
      {busy && !result && !error && (
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkDim }}>Generating suggestions...</div>
      )}
      {result?.sections?.length > 0 && (
        <div style={{ display: 'grid', gap: 9 }}>
          {result.sections.map(section => {
            const sectionSources = (section.sourceIds || [])
              .map(id => sourceById.get(String(id)))
              .filter(Boolean)
              .slice(0, 4);
            return (
              <div key={`${section.kind}:${section.title}`} style={{
                border: `1px solid ${T.lineSub}`,
                borderRadius: 7,
                background: T.bg,
                padding: '9px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 720, color: T.ink }}>{section.title}</div>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontWeight: 600,
                    fontSize: 11,
                    color: section.kind === 'fact' ? T.inkDim : T.accent,
                  }}>{section.kind}</div>
                </div>
                <div style={{
                  fontFamily: 'var(--mn-body)',
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  color: T.inkMed,
                }}>{section.content}</div>
                {sectionSources.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, padding: '4px 0' }}>Evidence</span>
                    {sectionSources.map(source => (
                      <button
                        key={source.id || source.title}
                        type="button"
                        onClick={() => openSource(source)}
                        style={{
                          border: `1px solid ${T.lineSub}`,
                          borderRadius: 999,
                          background: T.bgSub,
                          color: T.inkMed,
                          cursor: source.id && noteIdSet?.has?.(String(source.id)) ? 'pointer' : 'default',
                          padding: '4px 8px',
                          fontFamily: 'var(--mn-ui)',
                          fontSize: 11.5,
                        }}>
                        {source.title || source.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { mnAiPlainInlineText, mnAiLooksLikeSectionLabel, mnAskStatusText, mnAiProviderLabel, mnAskFooterHint, MnAiSetupNotice, mnAiWikiLinkParts, mnAiHeadingKey, MN_AI_GENERIC_SUMMARY_HEADINGS, mnAiIsGenericSummaryHeading, mnNormalizeAiResponseBlocks, mnAiInlineText, mnParseAiResponseBlocks, MnAiFormattedResponse, MnCurrentNoteSuggestionsCard };
import { mnAskSecondaryButton } from './aiUi.jsx';
