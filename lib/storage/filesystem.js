function createFilesystem({ fs, path, maxJsonReadBytes, maxJsonWriteBytes }) {
  const fsp = fs.promises;

  async function ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true });
  }

  async function mapLimit(items, limit, mapper) {
    const list = Array.from(items || []);
    const out = new Array(list.length);
    let next = 0;
    const workerCount = Math.min(Math.max(1, limit), list.length || 1);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (next < list.length) {
        const index = next++;
        out[index] = await mapper(list[index], index);
      }
    }));
    return out;
  }

  function assertByteLength(value, maxBytes, message) {
    if (Buffer.byteLength(String(value || ''), 'utf8') > maxBytes) throw new Error(message);
  }

  function assertArrayLimit(items, maxItems, message) {
    if (Array.isArray(items) && items.length > maxItems) throw new Error(message);
  }

  function unsafeFileError(message) {
    const error = new Error(message);
    error.code = 'UNSAFE_FILE';
    return error;
  }

  async function retryRename(source, target) {
    const retryCodes = new Set(['EBUSY', 'EPERM']);
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fsp.rename(source, target);
        return;
      } catch (error) {
        lastError = error;
        if (!retryCodes.has(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async function quarantineBrokenJson(file, error) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const broken = `${file}.broken.${stamp}`;
      await retryRename(file, broken);
      console.warn(`Moved unreadable JSON to ${path.basename(broken)}: ${error?.message || String(error)}`);
    } catch (renameError) {
      if (renameError.code !== 'ENOENT') console.warn('Could not preserve unreadable JSON', path.basename(file), renameError.message || String(renameError));
    }
  }

  async function readJsonSafe(file, fallback) {
    let handle = null;
    try {
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      if (!stat.isFile()) throw unsafeFileError(`JSON file must be a regular file: ${path.basename(file)}`);
      if (stat.size > maxJsonReadBytes) {
        const error = new Error(`JSON file too large: ${path.basename(file)}`);
        error.code = 'JSON_TOO_LARGE';
        throw error;
      }
      const text = await handle.readFile('utf8');
      await handle.close();
      handle = null;
      if (Buffer.byteLength(text, 'utf8') > maxJsonReadBytes) {
        const error = new Error(`JSON file too large: ${path.basename(file)}`);
        error.code = 'JSON_TOO_LARGE';
        throw error;
      }
      return JSON.parse(text);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code === 'ENOENT') return fallback;
      if (error.code === 'ELOOP') {
        await quarantineBrokenJson(file, unsafeFileError(`JSON file cannot be a symlink: ${path.basename(file)}`));
        return fallback;
      }
      if (error instanceof SyntaxError || error.code === 'JSON_TOO_LARGE') await quarantineBrokenJson(file, error);
      else if (error.code === 'UNSAFE_FILE') console.warn('Ignored unsafe JSON file', path.basename(file), error.message || String(error));
      return fallback;
    }
  }

  async function syncDirectory(dir) {
    let handle = null;
    try {
      handle = await fsp.open(dir, 'r');
      await handle.sync();
    } catch {} finally {
      try { if (handle) await handle.close(); } catch {}
    }
  }

  async function atomicWriteFile(file, data, encoding = 'utf8', options = {}) {
    await ensureDir(path.dirname(file));
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    let handle = null;
    try {
      handle = await fsp.open(tmp, 'w', options.mode);
      if (options.mode !== undefined) await handle.chmod(options.mode);
      await handle.writeFile(data, encoding);
      await handle.sync();
      await handle.close();
      handle = null;
      await retryRename(tmp, file);
      if (options.mode !== undefined) await fsp.chmod(file, options.mode);
      await syncDirectory(path.dirname(file));
    } catch (error) {
      try { if (handle) await handle.close(); } catch {}
      try { await fsp.unlink(tmp); } catch {}
      throw error;
    }
  }

  async function writeJson(file, obj, options = {}) {
    await ensureDir(path.dirname(file));
    const text = JSON.stringify(obj, null, 2);
    assertByteLength(text, options.maxBytes || maxJsonWriteBytes, `${path.basename(file)} is too large`);
    await atomicWriteFile(file, text, 'utf8', options);
  }

  async function readRegularUtf8File(file, options = {}) {
    const label = options.label || 'File';
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    let handle = null;
    try {
      handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      if (!stat.isFile()) throw unsafeFileError(`${label} must be a regular file`);
      if (options.maxBytes && stat.size > options.maxBytes) throw new Error(options.tooLargeMessage || `${label} is too large`);
      const text = await handle.readFile('utf8');
      if (options.maxBytes && Buffer.byteLength(text, 'utf8') > options.maxBytes) throw new Error(options.tooLargeMessage || `${label} is too large`);
      return { text, stat };
    } catch (error) {
      if (error?.code === 'ELOOP') throw unsafeFileError(`${label} cannot be a symlink`);
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  return {
    ensureDir, mapLimit, quarantineBrokenJson, readJsonSafe, writeJson, assertByteLength, assertArrayLimit,
    unsafeFileError, readRegularUtf8File, retryRename, atomicWriteFile, syncDirectory,
  };
}

module.exports = { createFilesystem };
