import { MN_THEMES } from '../shared/theme.jsx';

const MN_CODE_LANGUAGES = [
  { value: '', label: 'Plain text' },
  { value: 'javascript', label: 'JavaScript', aliases: ['js', 'mjs', 'cjs'] },
  { value: 'typescript', label: 'TypeScript', aliases: ['ts'] },
  { value: 'jsx', label: 'JSX' },
  { value: 'tsx', label: 'TSX' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown', aliases: ['md'] },
  { value: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  { value: 'python', label: 'Python', aliases: ['py'] },
  { value: 'sql', label: 'SQL' },
  { value: 'math', label: 'Math (KaTeX)', aliases: ['latex', 'tex', 'katex'] },
  { value: 'mermaid', label: 'Mermaid', aliases: ['flowchart', 'sequence'] },
];

const MN_CODE_LANGUAGE_CACHE = new Map();

function mnNormalizeCodeLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'plain' || raw === 'text' || raw === 'txt') return '';
  const cached = MN_CODE_LANGUAGE_CACHE.get(raw);
  if (cached !== undefined) return cached;
  let normalized = null;
  for (const lang of MN_CODE_LANGUAGES) {
    if (lang.value === raw || (lang.aliases || []).includes(raw)) { normalized = lang.value; break; }
  }
  if (normalized === null) normalized = raw.replace(/[^a-z0-9_+#.-]/g, '');
  if (MN_CODE_LANGUAGE_CACHE.size < 200) MN_CODE_LANGUAGE_CACHE.set(raw, normalized);
  return normalized;
}

function mnCodeLanguageLabel(value) {
  const normalized = mnNormalizeCodeLanguage(value);
  return MN_CODE_LANGUAGES.find(lang => lang.value === normalized)?.label || normalized || 'Plain text';
}

function mnCodeKeywords(language) {
  const lang = mnNormalizeCodeLanguage(language);
  if (['javascript', 'typescript', 'jsx', 'tsx'].includes(lang)) {
    return 'abstract|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield';
  }
  if (lang === 'python') {
    return 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield';
  }
  if (lang === 'bash') {
    return 'case|do|done|elif|else|esac|fi|for|function|if|in|select|then|until|while|export|local|readonly|return';
  }
  if (lang === 'sql') {
    return 'ALTER|AND|AS|ASC|BETWEEN|BY|CREATE|DELETE|DESC|DISTINCT|DROP|FROM|GROUP|HAVING|IN|INSERT|INTO|IS|JOIN|LEFT|LIKE|LIMIT|NOT|NULL|ON|OR|ORDER|RIGHT|SELECT|SET|TABLE|UPDATE|VALUES|WHERE';
  }
  return '';
}

// Keyword membership checked per token; a Set avoids recompiling the big
// alternation regex on every token of a code block.
const MN_CODE_KEYWORD_SETS = new Map();

function mnCodeKeywordSet(lang) {
  let set = MN_CODE_KEYWORD_SETS.get(lang);
  if (set === undefined) {
    const keywords = mnCodeKeywords(lang);
    set = keywords ? new Set(keywords.split('|')) : null;
    MN_CODE_KEYWORD_SETS.set(lang, set);
  }
  return set;
}

function mnCodeTokenStyle(token, language, T) {
  const lang = mnNormalizeCodeLanguage(language);
  if (lang === 'markdown' && /^(#{1,6}|[-*+]|\*\*|__|`|\[|\])/.test(token)) return { color: T.accent, fontWeight: 600 };
  if (/^(\/\/|\/\*|#|--|<!--)/.test(token)) return { color: T.inkDim, fontStyle: 'italic' };
  if (/^(['"`])/.test(token) || (/^".*"$/.test(token) && lang !== 'html')) return { color: 'oklch(0.48 0.12 150)' };
  if (/^\d/.test(token) || /^-\d/.test(token)) return { color: T.warn };
  if (lang === 'html' && /^<\/?/.test(token)) return { color: T.accent };
  if (lang === 'html' && /^[A-Za-z:-]+$/.test(token)) return { color: 'oklch(0.50 0.16 240)' };
  if (lang === 'css' && /^[@.#]?[A-Za-z_-][\w-]*/.test(token)) return { color: 'oklch(0.50 0.16 240)' };
  const keywords = mnCodeKeywordSet(lang);
  if (keywords && keywords.has(lang === 'sql' ? token.toUpperCase() : token)) {
    return { color: T.accent, fontWeight: 600 };
  }
  return null;
}

function mnCodeRegex(language) {
  const lang = mnNormalizeCodeLanguage(language);
  if (['javascript', 'typescript', 'jsx', 'tsx'].includes(lang)) {
    return /(\/\/.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  }
  if (lang === 'python') return /(#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  if (lang === 'bash') return /(#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$[A-Za-z_]\w*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  if (lang === 'sql') return /(--.*|"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  if (lang === 'html') return /(<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*|\/?>|[A-Za-z_:][\w:.-]*(?=\=)|"(?:\\.|[^"\\])*")/g;
  if (lang === 'css') return /(\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[A-Fa-f0-9]{3,8}\b|[@.#]?[A-Za-z_-][\w-]*|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)?\b)/g;
  if (lang === 'json') return /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\b\d+(?:\.\d+)?\b)/g;
  if (lang === 'markdown') return /(#{1,6}|[-*+](?=\s)|\*\*|__|`{1,3}|\[[^\]]*\]|\([^)]+\))/g;
  return null;
}

function mnTokenizeCode(text, language) {
  const regex = mnCodeRegex(language);
  const value = String(text || '');
  if (!regex) return [{ text: value, style: null }];
  const tokens = [];
  let last = 0, match;
  while ((match = regex.exec(value))) {
    if (match.index > last) tokens.push({ text: value.slice(last, match.index), style: null });
    const token = match[0];
    tokens.push({ text: token, style: mnCodeTokenStyle(token, language, MN_THEMES.light) });
    last = match.index + token.length;
  }
  if (last < value.length) tokens.push({ text: value.slice(last), style: null });
  return tokens;
}

function mnRenderCode(text, language, T) {
  const regex = mnCodeRegex(language);
  const value = String(text || '');
  if (!regex) return value;
  const parts = [];
  let last = 0, match, key = 0;
  while ((match = regex.exec(value))) {
    if (match.index > last) parts.push(<span key={key++}>{value.slice(last, match.index)}</span>);
    const token = match[0];
    parts.push(<span key={key++} style={mnCodeTokenStyle(token, language, T) || undefined}>{token}</span>);
    last = match.index + token.length;
  }
  if (last < value.length) parts.push(<span key={key++}>{value.slice(last)}</span>);
  return parts;
}

export { MN_CODE_LANGUAGES, mnCodeLanguageLabel, mnNormalizeCodeLanguage, mnRenderCode, mnTokenizeCode };
