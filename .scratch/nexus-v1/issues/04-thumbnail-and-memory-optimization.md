# 04 — High-Performance Thumbnail Engine & Memory Trim

**What to build:**
A lightweight, downsampled thumbnail engine in Rust producing 128x128 JPEG thumbnails (~3KB) for image files, coupled with viewport lazy loading using `IntersectionObserver` in grid view, and Win32 `SetProcessWorkingSetSize` automatic memory trim to keep memory usage under 1.5% RAM.

**Blocked by:**
None — can start immediately.

**Status:** ready-for-agent

- [x] Rust `get_thumbnail_base64` decodes and proportionally resizes images to 128x128 (or requested preview size), returning compact JPEG base64 data (~3KB).
- [x] Grid View uses `IntersectionObserver` to only load thumbnails when image rows enter the visible viewport (+150px margin).
- [x] Grid chunk size `GRID_CHUNK` is tuned to 60 items for low DOM footprint.
- [x] Win32 `trim_memory` command is triggered automatically on directory change idle, window blur, and visibility hidden.
- [x] Command Palette (`Ctrl+K`) exposes a manual "Trim Memory" / "釋放記憶體" command.
