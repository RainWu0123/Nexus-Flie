<div align="center">

  <img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Nexus Files Icon" />

  # Nexus Files

  **A lightning-fast, lean, and modern Windows 11 desktop file manager.**  
  *Engineered with Tauri 2, Vite, and Rust — zero Explorer bloat, pure native performance.*

  [![Tauri 2](https://img.shields.io/badge/Tauri-v2.0-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
  [![Rust](https://img.shields.io/badge/Rust-1.75+-CE422B?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![Vite](https://img.shields.io/badge/Vite-v6.0-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
  [![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
  [![Cold Start](https://img.shields.io/badge/Cold%20Start-%3C%200.4s-success?style=flat-square)](#-performance-architecture)
  [![Memory](https://img.shields.io/badge/Memory%20Footprint-%3C%2060%20MB-blueviolet?style=flat-square)](#-performance-architecture)
  [![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

  <br />

  [Features](#-key-features) •
  [Architecture & Philosophy](#-philosophy--architecture) •
  [Keyboard Shortcuts](#-keyboard-shortcuts) •
  [Getting Started](#-getting-started) •
  [Building from Source](#-building-release-binary)

</div>

---

> **“把總管變慢的東西拿掉，把每天都在用的東西做快、做穩。”**  
> *"Take out what makes Windows Explorer sluggish; make everyday essentials blazingly fast, lightweight, and rock solid."*

---

## ⚡ Why Nexus Files?

Windows File Explorer is notoriously bloated: sluggish cold starts, background shell extensions, unpredictable indexing stalls, and memory leaks.

**Nexus Files** is built on a simple premise: **Fast is itself the best feature.** Every feature must pay for itself in performance. If a module is turned off, its CPU, disk I/O, and memory cost is strictly zero.

| Capability | Nexus Files | Windows File Explorer |
|:---|:---:|:---:|
| **Cold Start to Usable List** | **< 0.4s** (Instant) | ~ 1.5s - 4.0s |
| **Idle Memory Consumption** | **~ 40 - 60 MB** | 150 - 450+ MB |
| **10,000+ Files Directory** | **60 FPS Smooth Scroll** (Virtualized) | Janky / Freezing |
| **Session Restore on Launch** | **Instant Tabs & History Restore** | Limited / Inconsistent |
| **Direct Archive Browsing** | **Virtual File System (`archive://`)** | Slow extraction / Shell lag |
| **Safety Recovery** | **Ctrl+Z Undo (Recycle Bin restore)** | Inconsistent undo |
| **Run as Administrator** | **UAC Native Shell Execution** | Standard |

---

## ✨ Key Features

### 🚀 Extreme Performance & Zero Bloat
- **Sub-0.4s Cold Boot**: Zero blocking IPC, non-blocking asynchronous system paths resolution.
- **Virtualized Rendering**: Handles directories with 10,000+ files effortlessly using high-performance DOM recycling.
- **Working Set Trimming**: Automatically invokes Win32 memory compaction on window blur and idle states to keep memory footprint under 60 MB.
- **On-Demand Caching**: Thumbnail downsampling (128x128 JPEG ~3KB) with bounded LRU caches and viewport-only `IntersectionObserver` triggers.

### 🪟 Authentic Windows 11 Fluent Design
- **Native Two-Row Ribbon Toolbar**: Fast access to Cut, Copy, Paste, Undo, Rename, Delete, Sort, View, and System tools.
- **Fluent Mica & Acrylic Context Menus**: Glass-morphism context menus with top command bars, smooth entrance animations, and shortcut indicators.
- **Native Win32 File Properties Modal**: Accurate file metadata, real-time live recursive folder size/file counting, default application associations, and Win32 attribute toggles (Read-only / Hidden).
- **No HTML Alerts**: Browser `alert()` / `confirm()` completely eliminated in favor of sleek Fluent toast notifications and modal cards.

### 🛡️ Windows Native UAC & Elevation (Run as Administrator)
- **Direct UAC Prompt**: Powered by Win32 `ShellExecuteW` with `runas` verb — zero console flashing and seamless OS-level UAC integration.
- **Executable & Script Elevation**: Right-click any `.exe`, `.bat`, `.cmd`, `.msi`, `.ps1`, `.vbs`, or `.reg` to launch elevated.
- **Protected File Editing**: Right-click system configuration files (`hosts`, `.ini`, `.json`, `.log`) to open in an elevated Notepad.
- **Administrator Terminal**: Open Windows Terminal, PowerShell, or Command Prompt as Administrator at the current path.

### 📑 Tab Management & Dual-Pane Workspace
- **Chrome-Grade Tabs**: Reorder via drag-and-drop, pin important directories, middle-click to close, and restore closed tabs with `Ctrl+Shift+T`.
- **Automatic Session Recovery**: Restores your exact tab layout, active tabs, and navigation histories across app restarts.
- **Dual-Pane Mode (`F10`)**: Instant split-view navigation for seamless side-by-side file comparisons and cross-folder transfers.

### 📂 Windows-Grade Frecency Recent Folders
- **Frecency Engine**: Combines visit count with working dwell time (>= 4 seconds required to count, preventing traversal pollution).
- **Full Context Control**: Pin recent folders to Quick Access, remove unwanted items, or clear history with a single click.

### 🏷️ Dynamic File Tagging System
- **Custom Tags**: Create color-coded tags with custom names and hex colors.
- **Virtual URI Views**: Browse all files across drives tagged with a specific label via `nexus://tag/<tag-id>`.
- **Drag-to-Tag**: Drag files directly from the file list or the Windows Desktop onto sidebar tags to apply them instantly.

### 📦 Virtual Archive File System
- **Browse Archives like Folders**: Explore `.zip`, `.tar.gz`, and `.tar.bz2` seamlessly using the `archive://` protocol without full extraction.
- **Instant Preview**: Double-click images or text files inside archives for instant previewing.
- **External Drag & Drop**: Drag files out of archives directly to Windows Explorer or Desktop.

### ↩️ Global Undo Subsystem (`Ctrl+Z`)
- **Accidental Deletion Recovery**: Instantly restores deleted files from the Windows Recycle Bin back to their original paths.
- **Action History**: Revert accidental renames, file moves, and new folder creations with a single keystroke.

---

## ⌨️ Keyboard Shortcuts

Nexus Files is engineered for keyboard-first navigation:

### Navigation & Views
| Shortcut | Action |
|:---|:---|
| `Alt + ←` / `Alt + →` | Navigate backward / forward in tab history |
| `Alt + ↑` / `Backspace` | Navigate to parent directory |
| `F5` / `Ctrl + R` | Refresh current folder |
| `Ctrl + F` | Toggle instant in-folder filter (Zero I/O) |
| `Ctrl + K` | Open Command Palette (Commands & files) |
| `Ctrl + H` | Toggle hidden files and system items |
| `F10` | Toggle Split Dual-Pane View |

### File Operations
| Shortcut | Action |
|:---|:---|
| `Enter` | Open file / Enter directory |
| `F2` | Inline file renaming |
| `Ctrl + C` / `Ctrl + X` | Copy / Cut selected files |
| `Ctrl + V` | Paste clipboard contents |
| `Ctrl + Z` | **Undo last action** (Recycle Bin restore, revert rename/move) |
| `Delete` | Move selected items to Recycle Bin |
| `Alt + Enter` | Open Windows 11 Native Properties Dialog |
| `Ctrl + Shift + N` | Create a new folder |

### Tab Management
| Shortcut | Action |
|:---|:---|
| `Ctrl + T` | Open a new tab |
| `Ctrl + W` | Close active tab |
| `Ctrl + Shift + T` | Reopen last closed tab |
| `Ctrl + 1` … `Ctrl + 9` | Switch directly to tab 1 through 9 |

---

## 🏛️ Philosophy & Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Nexus Files Architecture                   │
├───────────────────────────┬─────────────────────────────┤
│      Frontend (UI)        │       Backend (Rust)        │
│                           │                             │
│   Vanilla JS (No VDOM)    │      Tauri 2 Core API       │
│   Virtual List Rendering  │      tokio::task (Blocking) │
│   Window Event Tracking   │      trash-rs (Recycle Bin) │
│   Mica & Acrylic Styling  │      Win32 ShellExecuteW    │
│   Sub-millisecond Filters │      Archive Virtual FS     │
└───────────────────────────┴─────────────────────────────┘
```

Nexus Files adheres strictly to the guidelines defined in **[PHILOSOPHY.md](./PHILOSOPHY.md)**:

1. **Cold start is a feature** — First meaningful paint in under 400ms.
2. **No heavy work by default** — No startup full-disk crawlers, no auto folder-size calculations.
3. **Features must unload** — Preview panel, dual-pane, and watchers incur zero cost when closed.
4. **Pay only for what is visible** — Icons, thumbnails, and DOM nodes exist only for rows on screen.
5. **UI-style stroke icons** — Clean SVG stroke icons matching the interface, avoiding COM shell icon latency.

---

## 🚀 Getting Started

### Prerequisites
- **Operating System**: Windows 10 (Build 19041+) or Windows 11
- **Node.js**: `18.0` or later
- **Rust Toolchain**: `stable` ([rustup.rs](https://rustup.rs/))
- **Visual Studio C++ Build Tools** (for Rust compilation on Windows)

### 1. Clone the repository
```bash
git clone https://github.com/RainWu0123/Nexus-Flie.git
cd Nexus-Flie
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start development server (Hot Reload)
```bash
npm run tauri dev
```

---

## 📦 Building Release Binary

To generate an optimized, stripped standalone Windows executable (`.exe`) and installer (`.msi`):

```bash
npm run tauri build
```

The output artifacts will be placed in:
- Standalone Executable: `src-tauri/target/release/nexus-files.exe`
- MSI Installer: `src-tauri/target/release/bundle/msi/Nexus Files_0.1.0_x64_en-US.msi`
- NSIS Setup: `src-tauri/target/release/bundle/nsis/Nexus Files_0.1.0_x64-setup.exe`

---

## 🌐 Supported Languages

Nexus Files provides complete multi-lingual localization:
- **English** (en)
- **繁體中文** (zh-TW)
- **简体中文** (zh-CN)
- **日本語** (ja)

Language is automatically detected from the system locale with manual override options.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<div align="center">
  <sub>Crafted with passion for a faster desktop experience. If you find Nexus Files helpful, give it a ⭐️!</sub>
</div>
