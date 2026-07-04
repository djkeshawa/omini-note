// Attachment storage for vault image files.
// Layout: <root>/<vault-slug>/attachments/<fileName>
// Files are plain images next to the markdown notes so vaults stay portable.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');

const ATTACHMENTS_DIR_NAME = 'attachments';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_NAME_LENGTH = 120;
const ATTACHMENT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ATTACHMENT_REL_PATH_RE = new RegExp(`^${ATTACHMENTS_DIR_NAME}/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`);
const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
});
const EXTENSION_BY_IMAGE_MIME = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
});

function attachmentsDir(vaultPath) {
  return path.join(vaultPath, ATTACHMENTS_DIR_NAME);
}

async function requireVault(vaultId) {
  const cfg = await store.loadConfig();
  const id = String(vaultId || '');
  const vault = (cfg.vaults || []).find(v => v.id === id);
  if (!vault) throw new Error('Vault not found: ' + id);
  return vault;
}

function attachmentExtension(name, mimeType) {
  const fromName = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
  const nameExt = fromName ? fromName[1].toLowerCase() : '';
  if (IMAGE_MIME_BY_EXTENSION[nameExt]) return nameExt;
  return EXTENSION_BY_IMAGE_MIME[String(mimeType || '').toLowerCase()] || '';
}

function sanitizeAttachmentBaseName(name) {
  const withoutExt = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const clean = withoutExt
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60);
  return clean || 'pasted-image';
}

function attachmentStamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function normalizeAttachmentBytes(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new Error('Attachment bytes must be binary data');
}

function isValidAttachmentFileName(fileName) {
  const value = String(fileName || '');
  if (!ATTACHMENT_FILE_RE.test(value)) return false;
  if (value.includes('..')) return false;
  return !!IMAGE_MIME_BY_EXTENSION[value.split('.').pop().toLowerCase()];
}

function isVaultAttachmentRelPath(relPath) {
  const value = String(relPath || '');
  if (!ATTACHMENT_REL_PATH_RE.test(value)) return false;
  return isValidAttachmentFileName(value.slice(ATTACHMENTS_DIR_NAME.length + 1));
}

async function allocateAttachmentFile(dir, baseName, ext) {
  // baseName (≤60) + stamp (14) + suffix (5) + extension stay well under
  // MAX_ATTACHMENT_NAME_LENGTH, so no truncation is needed here.
  const stamp = attachmentStamp();
  let candidate = `${baseName}-${stamp}.${ext}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const file = path.join(dir, candidate);
    try {
      await fsp.access(file);
    } catch (e) {
      if (e.code === 'ENOENT') return { file, fileName: candidate };
      throw e;
    }
    const suffix = Math.random().toString(36).slice(2, 7);
    candidate = `${baseName}-${stamp}-${suffix}.${ext}`;
  }
  throw new Error('Could not allocate attachment file name');
}

async function saveAttachment(vaultId, payload = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid attachment payload');
  const vault = await requireVault(vaultId);
  const buffer = normalizeAttachmentBytes(payload.bytes);
  if (!buffer.length) throw new Error('Attachment is empty');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)`);
  }
  const ext = attachmentExtension(payload.name, payload.mimeType);
  if (!ext) throw new Error('Unsupported attachment type (images only)');
  const baseName = sanitizeAttachmentBaseName(payload.name);
  const dir = attachmentsDir(path.join(store.ROOT, vault.slug));
  await fsp.mkdir(dir, { recursive: true });
  const { file, fileName } = await allocateAttachmentFile(dir, baseName, ext);
  if (!isValidAttachmentFileName(fileName)) throw new Error('Could not build a safe attachment name');
  await store.atomicWriteFile(file, buffer, null);
  return {
    fileName,
    relPath: `${ATTACHMENTS_DIR_NAME}/${fileName}`,
    size: buffer.length,
    mimeType: IMAGE_MIME_BY_EXTENSION[ext],
  };
}

async function readAttachment(vaultId, fileName) {
  const vault = await requireVault(vaultId);
  const name = String(fileName || '');
  if (!isValidAttachmentFileName(name)) throw new Error('Invalid attachment name');
  const dir = attachmentsDir(path.join(store.ROOT, vault.slug));
  const file = path.resolve(dir, name);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Invalid attachment path');
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle = null;
  try {
    handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Attachment must be a regular file');
    if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment is too large');
    const buffer = await handle.readFile();
    return {
      buffer,
      mimeType: IMAGE_MIME_BY_EXTENSION[name.split('.').pop().toLowerCase()],
    };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = {
  ATTACHMENTS_DIR_NAME,
  MAX_ATTACHMENT_BYTES,
  saveAttachment,
  readAttachment,
  isValidAttachmentFileName,
  isVaultAttachmentRelPath,
  __test: {
    sanitizeAttachmentBaseName,
    attachmentExtension,
    normalizeAttachmentBytes,
    allocateAttachmentFile,
  },
};
