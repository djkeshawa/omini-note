// Safe attachment storage for portable vault files.
// Layout: <root>/<vault-slug>/attachments/<fileName>

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const store = require('./store');
const attachmentDescriptor = require('../src/shared/attachmentDescriptor');

const ATTACHMENTS_DIR_NAME = 'attachments';
const MAX_ATTACHMENT_BYTES = attachmentDescriptor.MAX_ATTACHMENT_BYTES;
const ATTACHMENT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ATTACHMENT_REL_PATH_RE = new RegExp(`^${ATTACHMENTS_DIR_NAME}/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`);

function attachmentsDir(vaultPath) {
  return path.join(vaultPath, ATTACHMENTS_DIR_NAME);
}

async function requireVault(vaultId) {
  const cfg = await store.loadConfig();
  const id = String(vaultId || '');
  const vault = (cfg.vaults || []).find(item => item.id === id);
  if (!vault) throw new Error('Vault not found: ' + id);
  return vault;
}

function attachmentExtension(name, mimeType) {
  return attachmentDescriptor.classifyAttachment(name, mimeType)?.extension || '';
}

function sanitizeAttachmentBaseName(name, fallback = 'pasted-image') {
  const withoutExt = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.[A-Za-z0-9]{1,10}$/, '');
  const clean = withoutExt
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60);
  return clean || fallback;
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
  if (!ATTACHMENT_FILE_RE.test(value) || value.includes('..')) return false;
  return !!attachmentDescriptor.classifyAttachment(value, '');
}

function isVaultAttachmentRelPath(relPath) {
  const value = String(relPath || '');
  if (!ATTACHMENT_REL_PATH_RE.test(value)) return false;
  return isValidAttachmentFileName(value.slice(ATTACHMENTS_DIR_NAME.length + 1));
}

function isWithinDirectory(filePath, directoryPath) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function toDescriptor(fileName, size) {
  const classified = attachmentDescriptor.classifyAttachment(fileName, '');
  if (!classified) throw new Error('Unsupported attachment type');
  return {
    fileName,
    relPath: `${ATTACHMENTS_DIR_NAME}/${fileName}`,
    size,
    mimeType: classified.mimeType,
    kind: classified.kind,
    typeLabel: classified.typeLabel,
    isImage: classified.isImage,
  };
}

async function allocateAttachmentFile(dir, baseName, ext) {
  const stamp = attachmentStamp();
  let candidate = `${baseName}-${stamp}.${ext}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const file = path.join(dir, candidate);
    try {
      const handle = await fsp.open(file, 'wx', 0o600);
      return { file, fileName: candidate, handle };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
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
  const classified = attachmentDescriptor.classifyAttachment(payload.name, payload.mimeType);
  if (!classified) throw new Error('Unsupported attachment type or mismatched MIME type');
  const fallback = classified.isImage ? 'pasted-image' : 'attachment';
  const baseName = sanitizeAttachmentBaseName(payload.name, fallback);
  const vaultPath = path.join(store.ROOT, vault.slug);
  const dir = attachmentsDir(vaultPath);
  await fsp.mkdir(dir, { recursive: true });
  const dirStat = await fsp.lstat(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('Attachments folder must be a regular directory');
  const realVaultPath = await fsp.realpath(vaultPath);
  const realDir = await fsp.realpath(dir);
  if (!isWithinDirectory(realDir, realVaultPath)) throw new Error('Attachments folder escapes the vault');
  const { file, fileName, handle } = await allocateAttachmentFile(dir, baseName, classified.extension);
  if (!isValidAttachmentFileName(fileName) || !isWithinDirectory(file, dir)) {
    await handle.close().catch(() => {});
    await fsp.unlink(file).catch(() => {});
    throw new Error('Could not build a safe attachment name');
  }
  let writeError = null;
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } catch (error) {
    writeError = error;
  } finally {
    await handle.close().catch(() => {});
  }
  if (writeError) {
    await fsp.unlink(file).catch(() => {});
    throw writeError;
  }
  return toDescriptor(fileName, buffer.length);
}

async function withValidatedAttachment(vaultId, fileName, callback) {
  const vault = await requireVault(vaultId);
  const name = String(fileName || '');
  if (!isValidAttachmentFileName(name)) throw new Error('Invalid attachment name');
  const vaultPath = path.join(store.ROOT, vault.slug);
  const dir = attachmentsDir(vaultPath);
  const file = path.resolve(dir, name);
  if (!isWithinDirectory(file, dir)) throw new Error('Invalid attachment path');
  const dirStat = await fsp.lstat(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('Attachments folder must be a regular directory');
  const linkStat = await fsp.lstat(file);
  if (linkStat.isSymbolicLink()) throw new Error('Attachment must be a regular file');
  const [realVaultPath, realDir, realFile] = await Promise.all([
    fsp.realpath(vaultPath),
    fsp.realpath(dir),
    fsp.realpath(file),
  ]);
  if (!isWithinDirectory(realDir, realVaultPath) || !isWithinDirectory(realFile, realDir)) {
    throw new Error('Attachment escapes the vault');
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle = null;
  try {
    handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Attachment must be a regular file');
    if (!stat.size) throw new Error('Attachment is empty');
    if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment is too large');
    return await callback({ descriptor: toDescriptor(name, stat.size), filePath: file, handle });
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function describeAttachment(vaultId, fileName) {
  return withValidatedAttachment(vaultId, fileName, ({ descriptor }) => descriptor);
}

async function readAttachment(vaultId, fileName) {
  return withValidatedAttachment(vaultId, fileName, async ({ descriptor, handle }) => ({
    ...descriptor,
    buffer: await handle.readFile(),
  }));
}

async function openAttachment(vaultId, fileName, openPath) {
  if (typeof openPath !== 'function') throw new Error('Attachment opener is unavailable');
  return withValidatedAttachment(vaultId, fileName, async ({ descriptor, filePath }) => {
    const error = await openPath(filePath);
    if (error) throw new Error('Could not open attachment');
    return { opened: true, descriptor };
  });
}

module.exports = {
  ATTACHMENTS_DIR_NAME,
  MAX_ATTACHMENT_BYTES,
  describeAttachment,
  openAttachment,
  readAttachment,
  saveAttachment,
  isValidAttachmentFileName,
  isVaultAttachmentRelPath,
  __test: {
    attachmentExtension,
    isWithinDirectory,
    normalizeAttachmentBytes,
    sanitizeAttachmentBaseName,
    toDescriptor,
  },
};
