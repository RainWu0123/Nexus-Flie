# 03 — Universal Undo System with Recycle Bin Restore (Ctrl+Z)

**What to build:**
A comprehensive Undo subsystem triggered by `Ctrl+Z` that restores deleted files from the Windows Recycle Bin back to their original disk locations, reverts file renames, undoes cut-and-paste moves, and deletes newly created files/folders.

**Blocked by:**
None — can start immediately.

**Status:** ready-for-agent

- [x] Pressing `Delete` sends files to the OS Recycle Bin and records the action in `UndoManager`.
- [x] Pressing `Ctrl+Z` restores the deleted files via Rust backend `restore_from_trash` and selects the restored items in the file list.
- [x] Toast notification appears on successful restoration showing the restored item's name.
- [x] `Ctrl+Z` correctly reverts renames, cut-and-paste file moves, and new folder/file creations.
- [x] Command Palette (`Ctrl+K`) includes "Undo (Ctrl+Z)" / "復原" command.
