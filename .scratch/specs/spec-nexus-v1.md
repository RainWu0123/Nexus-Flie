# Spec: Nexus Files — Windows 11 Native Architecture & Memory-Optimized File Management

**Labels**: `ready-for-agent`

## Problem Statement

Users of modern desktop file managers require a seamless Windows 11 Fluent aesthetic, complete keyboard navigation reliability, customizable organization (such as dynamic tags), intuitive drive and folder navigation, safety mechanisms (undoing accidental deletions via Recycle Bin recovery), and lightweight performance with minimal RAM and CPU footprints. Previously, native dialogs looked dated, deletions lacked Ctrl+Z recovery, full-size images caused RAM spikes (>8% system memory), and navigation lacked This PC drive capacity visualization.

## Solution

Nexus Files provides an authentic Windows 11 native file manager experience with:
1. **Custom Tagging Engine**: User-defined tag creation with custom color swatches, tag editing, tag deletion with cascade cleanup, and tag virtual filtering.
2. **This PC & Storage Dashboard**: A collapsible "This PC" tree hierarchy and modern drive storage view with colored progress indicators showing remaining volume capacity.
3. **Fluent Dialog & Notification Model**: Modern custom modal cards for creation, prompt, confirmation, and toast feedback replacing native browser dialogs.
4. **Undo / Revert Subsystem (Ctrl+Z)**: Instant recovery of deleted files from the OS Recycle Bin back to their original locations, along with undo for renames, moves, and creations.
5. **Memory-Optimized Thumbnail & Working Set Architecture**: Real-time Rust-based downsampling of images to 128x128 JPEG (~3KB), intersection observer viewport lazy loading, and automatic Win32 working set memory trimming to maintain minimal memory footprint (<1.5% RAM).

## User Stories

1. As a power user, I want to undo an accidental file deletion by pressing `Ctrl + Z`, so that my file is immediately restored from the Windows Recycle Bin back to its original folder.
2. As a user, I want to see a confirmation toast when I press `Ctrl + Z`, so that I know exactly which file or folder was restored.
3. As a user, I want to undo renames, file moves, and new folder creations with `Ctrl + Z`, so that mistakes can be quickly corrected without manual reconstruction.
4. As an organizer, I want to create custom tags with custom names and colors from the sidebar `+` button, so that I can categorize my files flexibly.
5. As an organizer, I want to right-click on any tag in the sidebar to edit its name, change its color, or delete it, so that my tagging structure stays up to date.
6. As a user, I want deleted tags to be automatically cleared from all tagged files, so that no orphaned tag references remain.
7. As a user, I want to see "This PC" in the sidebar with a collapsible tree showing all drives and their free storage capacity, so that I can monitor disk space at a glance.
8. As a user, I want clicking "This PC" (`nexus://this-pc`) to display folder shortcuts and Fluent drive cards with capacity progress bars that turn red when usage exceeds 90%, so that low-space warnings are visually prominent.
9. As a photographer or designer browsing folders with hundreds of high-resolution photos, I want thumbnails to load instantly without freezing the UI or blowing up RAM usage, so that the file manager remains responsive.
10. As a user running Nexus Files on laptops or memory-constrained PCs, I want background memory to be automatically trimmed and unreferenced memory returned to Windows when the app is idle or minimized, so that the app uses minimal system resources.
11. As a user, I want modern Windows 11 Fluent popups for renaming, creating folders, and confirmations instead of browser alert/confirm/prompt boxes, so that the app looks like a native Windows 11 application.
12. As a user, I want full keyboard accessibility (`Ctrl+T`, `Ctrl+W`, `Ctrl+Z`, `Ctrl+F`, `Ctrl+K`, `F2`, `Delete`), so that my workflow matches Windows File Explorer conventions.

## Implementation Decisions

- **Undo System**:
  - Encapsulate all undo operations in an `UndoManager` deep module with a small interface (`recordDelete`, `recordRename`, `recordMove`, `recordCreate`, `undo`).
  - Integrate with Rust `trash::os_limited::restore_all` / `list` for Recycle Bin recovery across Windows volumes.
  - Wire `Ctrl+Z` globally in `main.js` keydown listener, toolbar, and command palette.
- **Thumbnail & Performance Engine**:
  - Implement `get_thumbnail_base64` in Rust using the `image` crate with fast downsampling to max 128x128 / 800x800 and JPEG quality 80, capping image data sent across IPC to ~3KB per thumbnail.
  - In frontend grid view, implement `IntersectionObserver` with 150px rootMargin to only request thumbnails when elements scroll into the viewport.
  - Implement `trim_memory` in Rust invoking Win32 `SetProcessWorkingSetSize(GetCurrentProcess(), -1, -1)` and trigger it on directory change completion, window blur, and visibility hidden.
- **This PC & Navigation**:
  - Register `nexus://this-pc` as a first-class virtual URI in `NavigationEngine`, tab titles, toolbar breadcrumbs, and sidebar.
  - Render Quick Access shortcuts and interactive drive cards with real-time byte calculations and percentage thresholds.
- **Tag Subsystem**:
  - Persist custom tags in `localStorage` under `nexus_custom_tags` with fallback to default color palette.
  - Expose CRUD methods through the store and helper layers, updating UI reactivity in sidebar, preview panel, and file context menus.

## Testing Decisions

- **External Behavior Testing**:
  - Verify `restoreFromTrash` recovers files deleted in the current session and verifies file existence post-recovery.
  - Verify `get_thumbnail_base64` returns valid JPEG base64 data under 10KB for 10MB+ images.
  - Verify `trim_memory` returns `Ok(())` without crashing process memory.
  - Verify directory navigation maintains back/forward stack consistency across real paths and `nexus://` URIs.
- **Regression Gates**:
  - Full Rust compile check with `cargo check`.
  - Frontend bundle optimization with `npm run build` (Vite).
  - Release packaging with `tauri build`.

## Out of Scope

- Cloud drive synchronization (OneDrive, Google Drive deep sync hooks).
- Multi-threaded mass batch file checksum generation.
- Custom file system kernel drivers.

## Further Notes

All UI styling adheres to Windows 11 Fluent design principles (Mica backdrop, Segoe UI Variable fonts, 4px/8px corner radii, subtle borders, and smooth transitions).
