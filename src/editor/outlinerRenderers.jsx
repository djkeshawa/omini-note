// Outliner rendering helpers and AI edit action metadata.

const MnInline = window.MnInline;

const MN_AI_ACTIONS = [
  {
    id: 'improve',
    icon: '✦',
    pageLabel: 'Improve writing on this page',
    sectionLabel: 'Improve this section',
    selectionLabel: 'Improve selected text',
    hint: 'Polish wording while preserving meaning',
    instruction: 'Improve the writing. Keep the meaning, tone, markdown structure, wiki-links, tags, and tasks intact.',
  },
  {
    id: 'format',
    icon: '≡',
    pageLabel: 'Format this page',
    sectionLabel: 'Format this section',
    selectionLabel: 'Format selected text',
    hint: 'Clean up structure and markdown',
    instruction: 'Format and organize the text. Improve markdown structure without adding new facts.',
  },
  {
    id: 'summarize',
    icon: 'Σ',
    pageLabel: 'Summarize this page',
    sectionLabel: 'Summarize this section',
    selectionLabel: 'Summarize selected text',
    hint: 'Replace with a concise summary',
    instruction: 'Summarize the text concisely. Preserve concrete decisions, tasks, dates, and named references.',
  },
  {
    id: 'concise',
    icon: '↘',
    pageLabel: 'Make this page concise',
    sectionLabel: 'Make this section concise',
    selectionLabel: 'Make selected text concise',
    hint: 'Shorten without losing meaning',
    instruction: 'Make the text more concise while preserving the important meaning and markdown structure.',
  },
  {
    id: 'fix',
    icon: '✓',
    pageLabel: 'Fix spelling and grammar on this page',
    sectionLabel: 'Fix spelling and grammar in this section',
    selectionLabel: 'Fix selected text',
    hint: 'Correct spelling and grammar',
    instruction: 'Fix spelling, grammar, and punctuation only. Do not rewrite more than necessary.',
  },
  {
    id: 'write',
    icon: '+',
    pageLabel: 'Write on this page',
    sectionLabel: 'Write in this section',
    selectionLabel: 'Write for selected text',
    hint: 'Draft new text from your instruction',
    instruction: 'Write new text for this location based on the user request. Preserve useful markdown style and return only the replacement text.',
    needsPrompt: true,
    preview: true,
  },
];

function mnAiAction(id) {
  return MN_AI_ACTIONS.find(a => a.id === id) || MN_AI_ACTIONS[0];
}

function MnAiIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
      <path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" strokeLinejoin="round"/>
      <path d="M4 3.5L4.7 5.1L6.2 5.8L4.7 6.5L4 8L3.3 6.5L1.8 5.8L3.3 5.1L4 3.5Z" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Annotated text rendering ───────────────────────────────────────────
// Annotations: array of { start, end, kind } overlapping spans
function mnRenderAnnotated(text, annotations, T, onOpen, onTagClick, allNotes) {
  if (!annotations || annotations.length === 0) {
    return <MnInline text={text} T={T} onOpen={onOpen} onTagClick={onTagClick} allNotes={allNotes} />;
  }
  // Build segments: split text at every annotation boundary
  const points = new Set([0, text.length]);
  for (const a of annotations) { points.add(a.start); points.add(a.end); }
  const sorted = [...points].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1];
    if (s === e) continue;
    const kinds = annotations.filter(a => a.start <= s && a.end >= e).map(a => a.kind);
    segs.push({ s, e, kinds });
  }
  return (
    <>
      {segs.map((seg, i) => {
        const sub = text.slice(seg.s, seg.e);
        let content = <MnInline text={sub} T={T} onOpen={onOpen} onTagClick={onTagClick} allNotes={allNotes} />;
        let style = {};
        let wrap = (n) => n;
        for (const k of seg.kinds) {
          if (k === 'bold') style.fontWeight = 600;
          else if (k === 'italic') style.fontStyle = 'italic';
          else if (k === 'strike') style.textDecoration = 'line-through';
          else if (k === 'underline') style.textDecoration = (style.textDecoration ? style.textDecoration + ' underline' : 'underline');
          else if (k === 'code') {
            style.fontFamily = 'var(--mn-mono)';
            style.fontSize = '0.92em';
            style.background = T.bgSub;
            style.padding = '1px 5px';
            style.borderRadius = 3;
            style.border = `1px solid ${T.lineSub}`;
          }
          else if (k === 'hi-yellow') style.background = 'oklch(0.93 0.10 95 / 0.55)';
          else if (k === 'hi-green')  style.background = 'oklch(0.92 0.09 145 / 0.55)';
          else if (k === 'hi-pink')   style.background = 'oklch(0.90 0.08 0 / 0.55)';
          else if (k === 'hi-blue')   style.background = 'oklch(0.91 0.08 240 / 0.55)';
          else if (k === 'color-red')    style.color = 'oklch(0.55 0.18 27)';
          else if (k === 'color-blue')   style.color = 'oklch(0.50 0.16 240)';
          else if (k === 'color-purple') style.color = 'oklch(0.50 0.18 290)';
          else if (k === 'color-green')  style.color = 'oklch(0.50 0.13 150)';
          else if (k === 'fs-small') style.fontSize = '0.88em';
          else if (k === 'fs-default') style.fontSize = '1em';
          else if (k === 'fs-large') style.fontSize = '1.14em';
          else if (k === 'fs-x-large') style.fontSize = '1.3em';
        }
        return <span key={i} style={style}>{content}</span>;
      })}
    </>
  );
}

const MN_CODE_LANGUAGES = window.MN_CODE_HIGHLIGHTER?.languages || [];

function mnNormalizeCodeLanguage(value) {
  return window.MN_CODE_HIGHLIGHTER?.normalizeLanguage?.(value) || '';
}

function mnCodeLanguageLabel(value) {
  return window.MN_CODE_HIGHLIGHTER?.languageLabel?.(value) || 'Plain text';
}

function mnRenderCode(text, language, T) {
  return window.MN_CODE_HIGHLIGHTER?.render?.(text, language, T) ?? String(text || '');
}

// KaTeX block renderer. Renders the source as displayMode TeX. KaTeX is
// loaded as a UMD <script> in vispnote.html so this is a no-op fallback if
// it failed to load (e.g. user replaced the bundle).
function MnMathBlock({ source, T }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    if (!window.katex) {
      ref.current.textContent = String(source || '');
      return;
    }
    try {
      window.katex.render(String(source || ''), ref.current, {
        displayMode: true,
        throwOnError: false,
        output: 'html',
      });
    } catch (e) {
      ref.current.textContent = `Math error: ${e.message || e}`;
    }
  }, [source]);
  return (
    <div
      ref={ref}
      style={{
        fontFamily: 'KaTeX_Main, Newsreader, serif',
        fontSize: 16,
        color: T.ink,
        overflowX: 'auto',
        padding: '4px 0',
      }}
    />
  );
}

// Mermaid block renderer. Mermaid is async — renderToString creates a fresh
// SVG keyed by id. We dedupe on (source, T.bg) so the diagram only
// re-renders when content or theme changes, not on every keystroke elsewhere.
let _mnMermaidInited = false;
function mnMermaidInit(theme) {
  if (!window.mermaid) return false;
  if (_mnMermaidInited) return true;
  try {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
    });
    _mnMermaidInited = true;
  } catch (e) {
    console.warn('mermaid init failed', e);
  }
  return _mnMermaidInited;
}

function mnDetectThemeFromT(T) {
  return (T && window.MN_THEMES && T === window.MN_THEMES.dark) ? 'dark' : 'light';
}

function mnMermaidSvgHeight(svg) {
  const text = String(svg || '');
  const viewBox = text.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s*["']/i);
  const viewBoxHeight = viewBox ? Number(viewBox[1]) : 0;
  if (Number.isFinite(viewBoxHeight) && viewBoxHeight > 0) return Math.ceil(viewBoxHeight + 16);
  const height = text.match(/\bheight=["']\s*([\d.]+)(?:px)?\s*["']/i);
  const attrHeight = height ? Number(height[1]) : 0;
  if (Number.isFinite(attrHeight) && attrHeight > 0) return Math.ceil(attrHeight + 16);
  return 260;
}

function MnMermaidBlock({ source, T }) {
  const idRef = React.useRef(`mn_mer_${Math.random().toString(36).slice(2, 10)}`);
  const [error, setError] = React.useState(null);
  const [doc, setDoc] = React.useState('');
  const [height, setHeight] = React.useState(0);
  const themeMode = mnDetectThemeFromT(T);
  React.useEffect(() => {
    let cancelled = false;
    const code = String(source || '').trim();
    if (!code) { setDoc(''); setHeight(0); setError(null); return; }
    if (!mnMermaidInit(themeMode)) {
      setDoc('');
      setHeight(0);
      setError('Mermaid renderer unavailable');
      return;
    }
    setError(null);
    window.mermaid.render(idRef.current, code).then(({ svg }) => {
      if (cancelled) return;
      setHeight(mnMermaidSvgHeight(svg));
      setDoc(`<!doctype html><html><head><style>html,body{margin:0;background:transparent;}body{display:flex;justify-content:center;align-items:flex-start;overflow:visible;padding:4px 0;}svg{max-width:100%;height:auto;font-family:inherit;}</style></head><body>${svg}</body></html>`);
    }).catch(err => {
      if (cancelled) return;
      setDoc('');
      setHeight(0);
      setError(err?.message || String(err));
    });
    return () => { cancelled = true; };
  }, [source, themeMode]);
  if (error) {
    return (
      <pre style={{
        margin: 0, padding: 8, color: T.warn || T.ink,
        fontFamily: 'var(--mn-mono)', fontSize: 12,
        whiteSpace: 'pre-wrap',
      }}>Mermaid error: {error}</pre>
    );
  }
  return (
    <iframe
      title="Mermaid diagram"
      sandbox=""
      srcDoc={doc || '<!doctype html><html><body></body></html>'}
      style={{
        display: 'block',
        width: '100%',
        height: doc ? Math.max(160, height) : 0,
        minHeight: doc ? 160 : 0,
        border: 0,
        overflowX: 'auto',
        pointerEvents: 'none',
      }}
    />
  );
}

window.MnMathBlock = MnMathBlock;
window.MnMermaidBlock = MnMermaidBlock;

window.MN_OUTLINER_RENDERERS = {
  MN_AI_ACTIONS,
  mnAiAction,
  MnAiIcon,
  mnRenderAnnotated,
  MN_CODE_LANGUAGES,
  mnNormalizeCodeLanguage,
  mnCodeLanguageLabel,
  mnRenderCode,
  MnMathBlock,
  MnMermaidBlock,
};
