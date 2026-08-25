/**
 * Nexus Files — Path Domain Utilities
 * Pure string/path manipulation for Windows & POSIX paths.
 */

/** Check if path is a Windows or POSIX root */
export function isRootPath(p) {
  if (!p) return false;
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:$/.test(normalized) || normalized === '' || normalized === '/';
}

/** Join path segments with OS-aware separator. */
export function joinPath(...parts) {
  const isWin = parts.some(p => p && p.includes('\\')) || (typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win'));
  const sep = isWin ? '\\' : '/';
  return parts
    .filter(Boolean)
    .map((p, i) => {
      let s = String(p).replace(/[/\\]+/g, sep);
      if (i > 0) s = s.replace(new RegExp(`^${sep === '\\' ? '\\\\' : '/'}+`), '');
      if (i < parts.length - 1) s = s.replace(new RegExp(`${sep === '\\' ? '\\\\' : '/'}+$`), '');
      return s;
    })
    .join(sep);
}

/** Parent directory of a path. */
export function parentPath(path) {
  if (!path) return path;
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  // Drive root like C: or C:/
  if (/^[A-Za-z]:$/.test(normalized) || /^[A-Za-z]:\/?$/.test(normalized + '/')) {
    return path;
  }
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return path;
  const parent = normalized.substring(0, idx);
  // Keep Windows drive root as C:\
  if (/^[A-Za-z]:$/.test(parent)) {
    return parent + '\\';
  }
  return parent.includes('/') && path.includes('\\')
    ? parent.replace(/\//g, '\\')
    : parent;
}

/** Extract base filename or folder name from path. */
export function baseName(path) {
  if (!path) return '';
  const normalized = path.replace(/[/\\]+$/, '');
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Check if a filename or path is a supported compressed archive. */
export function isArchiveFile(pathOrName) {
  if (!pathOrName) return false;
  const lower = String(pathOrName).toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tar')
  );
}

/** Strip archive extensions to get folder name */
export function stripArchiveExt(name) {
  return String(name).replace(/(\.json)?\.(tar\.gz|tgz|zip|tar)$/i, '');
}

