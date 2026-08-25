# Nexus Files — Product Philosophy

> **把總管變慢的東西拿掉，把每天都在用的東西做快、做穩。**

## Mission

Windows 檔案總管最大的問題不是功能太少，而是**太肥**：啟動載入一堆 shell 擴充、預覽處理器、雲端與索引，功能永遠開著，資料夾一大就卡。

Nexus Files 的使命：

**在最佳化效能的同時，只增加真正好用的功能。**  
預設極簡、需要時才載入；每一個新功能都要付得起效能帳單。

## Core principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **Cold start is a feature** | Open → usable list as fast as possible |
| 2 | **No heavy work by default** | No full-disk scan, no auto folder-size, no preload all thumbs |
| 3 | **Features must unload** | Preview, dual pane, tags, search ≈ zero cost when off |
| 4 | **Pay only for what’s visible** | Virtual list; icons/thumbs only for on-screen rows |
| 5 | **Background work is cancellable** | Copy/search/thumb queues: limited concurrency + cancel |
| 6 | **Budget every feature** | Before merge: memory, disk I/O, main-thread cost |
| 7 | **Refuse Explorer bloat** | No always-on shell preview hosts, no startup indexing |

**Fast is itself the best feature.** Prefer “usable every day” over “feature parity with Explorer.”

## Feature gate (two questions)

Before adding anything:

1. **When disabled, is cost ≈ 0?**
2. **When enabled, do we only pay for what the user is looking at?**

| Accept | Reject / defer |
|--------|----------------|
| Clipboard C/X/V, keyboard nav, inline rename | Startup full-disk index |
| Virtual list + LRU caches with hard caps | Auto-calc every folder size |
| Icons/thumbs for visible rows only | Always-on preview handlers |
| **UI-style stroke icons** (SVG, by type) | OS shell icon extraction / COM |
| Watcher on *current* directory only | Heavy per-row animations |
| Dual pane / tags as optional modules | Feature ribbon that never unloads |

## Performance budgets (targets)

| Metric | Target |
|--------|--------|
| Cold start to interactive | Prefer &lt; 1s perceived |
| Open folder with 10k files (list skeleton) | Fast first paint; scroll stays smooth |
| Idle memory | Far below typical Explorer |
| Icon/thumb concurrency | ≤ 8 in flight; hard cache cap |
| FS work on UI thread | Never — Rust `spawn_blocking` / workers |

PR self-check: *Does this slow a 10k-file folder? Does idle RAM go up?* If yes, redesign.

## Architecture sketch

```
Startup → shell + store + current path list (light metadata only)

Browse  → virtual list
        → metadata cache (LRU, capped)
        → icon/thumb queue (visible only, limited concurrency)

Actions → copy/move/delete in background; UI doesn’t rebuild entire tree

Modules (lazy / toggleable)
  Preview | Dual pane | Tags | Search | Folder size (manual)
```

## Icons: match the UI, not the OS

We **do not** pull Windows shell icons (`SHGetFileInfo`, thumbnail handlers). Reasons:

- Shell icons pull in COM, preview handlers, and unpredictable latency  
- Inconsistent with glass / indigo minimal UI  
- Violates “pay only for what’s visible” and cold-start budgets  

Instead: one **stroke icon set** (same language as toolbar), colored by type  
(`folder`, `image`, `video`, `code`, `pdf`, …). Instant, zero I/O, brand-coherent.

Optional later: on-demand image **thumbnails** in grid only (already capped) — still not shell icons.

## What “good” means here

- Muscle-memory basics (nav, clipboard, rename, delete-to-bin) feel instant  
- Large directories stay scrollable  
- Optional power features don’t tax users who never open them  
- We would rather ship **one fast path** than five slow ones  

## Related docs

- `README.md` — setup, shortcuts, structure  
- This file — **why** we build the way we do  

When in doubt: **leave it out, or load it later.**
