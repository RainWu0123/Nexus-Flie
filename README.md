# Nexus Files

A **lean, fast** desktop file manager — Tauri 2 + Vite + vanilla JS.

> **Mission:** Take out what makes Explorer slow; keep what you use every day.  
> See **[PHILOSOPHY.md](./PHILOSOPHY.md)** for principles and performance budgets.

![Version](https://img.shields.io/badge/version-0.1.0-indigo)

## Features (on purpose, not bloated)

- Browse drives/folders (Windows-first; OneDrive-aware Known Folders)
- Tabs (pin, middle-click close, drag reorder, **session restore**, `Ctrl+Shift+T` reopen)
- **Clipboard:** Ctrl+C / X / V with conflict skip/overwrite
- **Keyboard:** arrows, Home/End, Enter, Backspace, Ctrl+A, type-ahead, F2 inline rename
- Drag-and-drop move (mouse-based, WebView2-safe)
- Command Palette (`Ctrl+K`) — commands **and files in the current folder**
- **Filter current folder** (`Ctrl+F`) — client-side, zero I/O
- Dual pane (toggle; off = zero cost)
- Tags + virtual `nexus://tag/…` views
- Image **and text/code** preview (on demand, cache-capped; text capped at 256 KB)
- Delete → **Recycle Bin**, plus *Empty Recycle Bin* (manual)
- **Manual folder size** (right-click → Calculate Size; cached, never automatic)
- **Open in Terminal** / **Show in Explorer** (right-click)
- **Select by pattern** (`*.jpg`) / invert selection (right-click)
- Sidebar: Quick Access, **Recent folders**, drives with free space
- **Current-directory watcher** — external changes auto-refresh (debounced, focused-only)
- i18n: en / zh-TW / zh-CN / ja
- **Virtualized list** for large folders (80+ items); grid renders in chunks
- **Minimal UI icons** by file type (SVG stroke — not OS shell icons)

## Requirements

- Node.js 18+
- Rust (for Tauri)
- Windows 10/11 recommended

## Development

```bash
npm install
npm run tauri dev    # hot reload
npm run dev          # frontend only (no native FS)
```

## Build release exe

```bash
npm run tauri build
```

Binary:

`src-tauri/target/release/nexus-files.exe`

**Source changes do not update an existing exe until you rebuild.**

## Project structure

```
PHILOSOPHY.md        Product principles & perf budgets
src/
  components/        UI (lazy modules: preview, dual-pane)
  store/             Thin pub/sub store
  utils/             Bridge, DnD, clipboard, toast
  i18n/
src-tauri/           Rust FS commands (blocking work off async runtime)
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette (commands + files in current folder) |
| `Ctrl+F` | Filter current folder (client-side) |
| `Ctrl+C` / `X` / `V` | Copy / cut / paste |
| `Ctrl+A` | Select all |
| `Ctrl+T` / `W` | New / close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Shift+N` | New folder |
| `Ctrl+1`…`9` | Switch to tab |
| `Ctrl+H` | Toggle hidden files |
| `↑` `↓` `Home` `End` | Move focus |
| letters | Type-ahead jump to name |
| `Enter` | Open |
| `Backspace` | Parent folder |
| `Alt+←/→/↑` | Back / forward / up (per-tab history) |
| `F2` | Inline rename |
| `F5` | Refresh |
| `Delete` | Move to Recycle Bin |

## Performance checklist (for contributors)

Before adding a feature:

1. Cost when **disabled** ≈ 0?
2. Cost only for **visible** work?
3. Does a **10k-file** folder still scroll smoothly?
4. Idle RAM increase acceptable?
5. No heavy FS on the UI thread?

Prefer: virtualize, queue, cap caches, cancel background work.

## Security notes

- Names via `textContent` (no HTML injection)
- Deletes use system trash (`trash` crate)
- Rename/create reject path traversal
- CSP set in `tauri.conf.json`
- `dragDropEnabled: false` so in-app DnD is not stolen by the OS webview
