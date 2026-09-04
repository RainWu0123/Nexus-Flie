/**
 * Nexus Files — Helper Utilities
 */
export { isRootPath, joinPath, parentPath, baseName, isArchiveFile, stripArchiveExt } from './path.js';
export { ICONS, FILE_TYPE_ICONS, icon, fileIconEl, getFileTypeCategory as getFileType } from '../assets/icons.js';

/** Escape text for safe insertion into HTML. */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format bytes to human-readable string matching Windows Explorer (KB/MB). */
export function formatFileSize(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes === 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb <= 1) return '1 KB';
  if (kb < 1024) {
    return `${Math.ceil(kb).toLocaleString()} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

/** Format UNIX timestamp to Windows 11 locale date string. */
export function formatDate(timestamp) {
  if (!timestamp) return '—';
  const ms = timestamp > 1e11 ? timestamp : timestamp * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const period = hours < 12 ? '上午' : '下午';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const hoursStr = String(displayHours).padStart(2, '0');
  return `${y}/${m}/${day} ${period} ${hoursStr}:${minutes}`;
}

/** Get localized friendly file type description matching Windows File Explorer. */
export function getFileTypeDescription(file) {
  if (!file) return '—';
  if (file.isDir) return '檔案資料夾';
  const ext = (file.extension || '').toLowerCase();
  const typeMap = {
    lnk: '捷徑',
    url: '網際網路捷徑',
    png: 'PNG 影像',
    jpg: 'JPEG 影像',
    jpeg: 'JPEG 影像',
    gif: 'GIF 影像',
    bmp: '點陣圖影像',
    webp: 'WebP 影像',
    svg: 'SVG 影像',
    ico: '圖示',
    txt: '文字文件',
    md: 'Markdown 文件',
    log: '文字文件 (LOG)',
    json: 'JSON 檔案',
    xml: 'XML 文件',
    yaml: 'YAML 檔案',
    yml: 'YAML 檔案',
    toml: 'TOML 檔案',
    js: 'JavaScript 檔案',
    mjs: 'JavaScript 檔案',
    cjs: 'JavaScript 檔案',
    ts: 'TypeScript 檔案',
    jsx: 'JSX 檔案',
    tsx: 'TSX 檔案',
    py: 'Python 檔案',
    rs: 'Rust 原始程式碼',
    go: 'Go 原始程式碼',
    c: 'C 原始程式碼',
    cpp: 'C++ 原始程式碼',
    h: 'C/C++ 標頭檔',
    hpp: 'C++ 標頭檔',
    java: 'Java 原始程式碼',
    html: 'HTML 文件',
    css: '級聯樣式表',
    scss: 'SCSS 樣式表',
    sh: 'Shell 指令碼',
    bat: 'Windows 批次檔案',
    ps1: 'PowerShell 指令碼',
    pdf: 'PDF 文件',
    zip: '壓縮 (zipped) 資料夾',
    rar: 'WinRAR 壓縮檔',
    '7z': '7-Zip 壓縮檔',
    tar: 'TAR 封存檔',
    gz: 'GZ 壓縮檔',
    tgz: 'TGZ 壓縮檔',
    exe: '應用程式',
    msi: 'Windows Installer 套件',
    mp4: 'MP4 視訊',
    mkv: 'MKV 視訊',
    avi: 'AVI 視訊',
    mov: 'MOV 視訊',
    mp3: 'MP3 音訊',
    wav: 'WAV 音訊',
    flac: 'FLAC 音訊',
    doc: 'Microsoft Word 文件',
    docx: 'Microsoft Word 文件',
    xls: 'Microsoft Excel 工作表',
    xlsx: 'Microsoft Excel 工作表',
    ppt: 'Microsoft PowerPoint 簡報',
    pptx: 'Microsoft PowerPoint 簡報',
    srt: '字幕檔案 (SRT)',
    edl: '編輯決策列表 (EDL)',
    key: '金鑰檔案',
    pub: '公開金鑰檔案',
  };
  if (typeMap[ext]) return typeMap[ext];
  return ext ? `${ext.toUpperCase()} 檔案` : '檔案';
}

/** Simple fuzzy match — returns true if all chars in query appear in text in order. */
export function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Generate a short unique ID. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

import store from '../store/store.js';

export const DEFAULT_TAGS = [
  { id: 'sidebar.tag.important', labelKey: 'sidebar.tag.important', color: '#f87171', bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.25)' },
  { id: 'sidebar.tag.work', labelKey: 'sidebar.tag.work', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: 'rgba(96, 165, 250, 0.25)' },
  { id: 'sidebar.tag.personal', labelKey: 'sidebar.tag.personal', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.25)' },
  { id: 'sidebar.tag.archive', labelKey: 'sidebar.tag.archive', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.25)' },
  { id: 'sidebar.tag.project', labelKey: 'sidebar.tag.project', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)', border: 'rgba(192, 132, 252, 0.25)' },
  { id: 'sidebar.tag.review', labelKey: 'sidebar.tag.review', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.25)' },
];

export const TAG_MAP = new Map(DEFAULT_TAGS.map(t => [t.id, t]));
export const TAG_COLORS = Object.fromEntries(DEFAULT_TAGS.map(t => [t.id, t.color]));

const FALLBACK_TAG = Object.freeze({
  id: '',
  labelKey: '',
  color: '#8b949e',
  bg: 'rgba(139, 148, 158, 0.12)',
  border: 'rgba(139, 148, 158, 0.25)',
});

/** Return all defined tags (custom + default) */
export function getAllTags() {
  return store.getTags(DEFAULT_TAGS);
}

/** Dynamic tag lookup */
export function getTagInfo(tagId) {
  const all = getAllTags();
  const found = all.find(t => t.id === tagId);
  if (found) return found;
  return TAG_MAP.get(tagId) || { ...FALLBACK_TAG, id: tagId, name: tagId, labelKey: tagId };
}

/** Create a lightweight minimalist tag dot */
export function createTagDot(tagId, extraClass = '') {
  const info = getTagInfo(tagId);
  const dot = document.createElement('span');
  dot.className = `tag-dot ${extraClass}`.trim();
  dot.style.setProperty('--tag-color', info.color);
  return dot;
}

/**
 * Calculate Windows 11 time interval group key for a timestamp.
 */
export function getDateGroupKey(timestampMs) {
  if (!timestampMs) return 'group.older';
  const ms = timestampMs < 1e11 ? timestampMs * 1000 : timestampMs;
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = today - diffToMonday * 86400000;
  const startOfLastWeek = startOfWeek - 7 * 86400000;

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1).getTime();

  if (ms >= today) return 'group.today';
  if (ms >= yesterday) return 'group.yesterday';
  if (ms >= startOfWeek) return 'group.thisWeek';
  if (ms >= startOfLastWeek) return 'group.lastWeek';
  if (ms >= startOfMonth) return 'group.thisMonth';
  if (ms >= startOfLastMonth) return 'group.lastMonth';
  if (ms >= startOfYear) return 'group.thisYear';
  if (ms >= startOfLastYear) return 'group.lastYear';
  return 'group.older';
}
