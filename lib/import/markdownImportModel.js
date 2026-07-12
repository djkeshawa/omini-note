const path = require('path');
const { parseFrontMatter } = require('../storage/frontMatter');

const MARKDOWN_EXTENSION_RE = /\.(?:md|markdown)$/i;
const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
});
const MARKDOWN_LINK_RE = /(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(\s+["'][^)]*["'])?\)/g;

function cleanTitle(value, fallback = 'Untitled') {
  const title = String(value || '')
    .replace(/[\0\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return title || fallback;
}

function titleFromDocument(meta, body, filePath) {
  const frontMatterTitle = ['string', 'number', 'boolean'].includes(typeof meta?.title) ? String(meta.title) : '';
  if (frontMatterTitle.trim()) return cleanTitle(frontMatterTitle);
  const heading = String(body || '').match(/^#\s+(.+)$/m);
  if (heading) return cleanTitle(heading[1]);
  return cleanTitle(path.basename(filePath, path.extname(filePath)), 'Imported note');
}

function allocateUniqueTitle(rawTitle, usedTitles) {
  const base = cleanTitle(rawTitle);
  let candidate = base;
  let suffix = 2;
  while (usedTitles.has(candidate.toLocaleLowerCase())) candidate = `${base} (${suffix++})`;
  usedTitles.add(candidate.toLocaleLowerCase());
  return candidate;
}

function pathKey(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function isWithinRoot(targetPath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function decodeRelativeTarget(rawTarget) {
  let target = String(rawTarget || '').trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  if (!target || target.startsWith('#') || target.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  try { target = decodeURIComponent(target); } catch { return null; }
  if (!target || target.includes('\0') || path.isAbsolute(target)) return null;
  const hashIndex = target.indexOf('#');
  const anchor = hashIndex >= 0 ? target.slice(hashIndex + 1) : '';
  const withoutAnchor = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const queryIndex = withoutAnchor.indexOf('?');
  const filePart = queryIndex >= 0 ? withoutAnchor.slice(0, queryIndex) : withoutAnchor;
  if (!filePart) return null;
  return { filePart, anchor };
}

function resolveRelativeTarget(sourceFile, rawTarget, rootPath) {
  const decoded = decodeRelativeTarget(rawTarget);
  if (!decoded) return null;
  const targetPath = path.resolve(path.dirname(sourceFile), decoded.filePart.replace(/[\\/]/g, path.sep));
  if (!isWithinRoot(targetPath, rootPath)) return null;
  return { ...decoded, targetPath };
}

function parseImportDocument(text, filePath) {
  const parsed = parseFrontMatter(text);
  return {
    meta: parsed.meta,
    frontMatter: parsed.source,
    body: parsed.body,
    sourceTitle: titleFromDocument(parsed.meta, parsed.body, filePath),
  };
}

function collectAttachmentReferences(body, sourceFile, rootPath) {
  const references = [];
  for (const match of String(body || '').matchAll(MARKDOWN_LINK_RE)) {
    if (match[1] !== '!') continue;
    const resolved = resolveRelativeTarget(sourceFile, match[3], rootPath);
    if (!resolved) {
      references.push({ rawTarget: match[3], error: 'Attachment path is not a safe relative path.' });
      continue;
    }
    const mimeType = IMAGE_MIME_BY_EXTENSION[path.extname(resolved.targetPath).toLocaleLowerCase()] || '';
    references.push({ rawTarget: match[3], ...resolved, mimeType, supported: !!mimeType });
  }
  return references;
}

function rewriteImportedLinks(body, sourceFile, rootPath, titleByPath, renamedTitles) {
  let rewritten = String(body || '').replace(MARKDOWN_LINK_RE, (whole, image, label, rawTarget) => {
    if (image) return whole;
    const resolved = resolveRelativeTarget(sourceFile, rawTarget, rootPath);
    if (!resolved || !MARKDOWN_EXTENSION_RE.test(resolved.filePart)) return whole;
    const title = titleByPath.get(pathKey(resolved.targetPath));
    if (!title) return whole;
    const anchor = resolved.anchor ? `#${resolved.anchor}` : '';
    const alias = label && label !== title ? `|${label}` : '';
    return `[[${title}${anchor}${alias}]]`;
  });
  rewritten = rewritten.replace(/\[\[([^\]#|]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g, (whole, title, anchor = '', alias = '') => {
    const replacement = renamedTitles.get(String(title || '').trim().toLocaleLowerCase());
    return replacement ? `[[${replacement}${anchor || ''}${alias || ''}]]` : whole;
  });
  return rewritten;
}

function rewriteAttachmentLinks(body, replacements) {
  return String(body || '').replace(MARKDOWN_LINK_RE, (whole, image, label, rawTarget, titleSuffix = '') => {
    if (!image) return whole;
    const replacement = replacements.get(rawTarget);
    return replacement ? `![${label}](${replacement}${titleSuffix || ''})` : whole;
  });
}

module.exports = {
  IMAGE_MIME_BY_EXTENSION,
  MARKDOWN_EXTENSION_RE,
  allocateUniqueTitle,
  cleanTitle,
  collectAttachmentReferences,
  isWithinRoot,
  parseImportDocument,
  pathKey,
  resolveRelativeTarget,
  rewriteAttachmentLinks,
  rewriteImportedLinks,
  titleFromDocument,
};
