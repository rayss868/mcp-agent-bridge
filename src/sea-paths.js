import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function isSea() {
  return isSeaBuild();
}

export function isSeaBuild() {
  try {
    // node:sea only exists inside a SEA binary
    return typeof process.getBuiltinModule === 'function'
      ? Boolean(process.getBuiltinModule('node:sea'))
      : false;
  } catch {
    return false;
  }
}

function dirnameFromImportMeta(url) {
  try {
    return path.dirname(fileURLToPath(url));
  } catch {
    return process.cwd();
  }
}

// Project root: <exeDir> when SEA, else <fileDir>/.. in dev (src/ -> root).
export function getProjectRoot(importMetaUrl) {
  if (isSeaBuild()) {
    return path.dirname(process.execPath);
  }
  return path.resolve(dirnameFromImportMeta(importMetaUrl), '..');
}

// In SEA (single-exe bundle), import.meta.url points inside the snapshot,
// so __dirname is useless for finding files on disk. Use exe dir instead.
export function seaAwareDirname(importMetaUrl) {
  return getProjectRoot(importMetaUrl);
}

// Writable base dir: next to exe when SEA, else project root derived from file.
export function resolveDataDir(importMetaUrl) {
  if (isSeaBuild()) {
    return path.dirname(process.execPath);
  }
  return path.resolve(dirnameFromImportMeta(importMetaUrl), '..');
}

export function resolveUiDir(importMetaUrl) {
  // 1. next to exe: <exeDir>/ui/index.html (distribusi zip)
  // 2. fallback: embedded SEA asset 'ui/index.html' via node:sea
  const exeDir = path.dirname(process.execPath);
  return path.resolve(isSeaBuild() ? exeDir : path.resolve(dirnameFromImportMeta(importMetaUrl), '..'), 'ui');
}

export async function readUiHtml(importMetaUrl) {
  const { readFile } = await import('node:fs/promises');
  // Try on-disk first (works for both dev and SEA+sidecar ui/)
  const onDisk = path.join(resolveUiDir(importMetaUrl), 'index.html');
  try {
    return await readFile(onDisk, 'utf8');
  } catch {}
  // Try SEA embedded asset
  if (isSeaBuild()) {
    try {
      const sea = process.getBuiltinModule('node:sea');
      const asset = sea.getAsset('ui/index.html', 'utf8');
      if (asset) return asset;
    } catch {}
  }
  throw new Error('UI not found');
}
