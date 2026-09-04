/**
 * Nexus Files — Undo Manager
 * Manages file operation undo stack (Ctrl+Z)
 * Supports restoring deleted files from Recycle Bin, reverting renames, moves, copies, and creations.
 */
import { restoreFromTrash, renamePath, movePath, deletePath, refreshCurrent } from './tauri-bridge.js';
import store from '../store/store.js';
import { toast } from './toast.js';
import { t } from '../i18n/index.js';

const MAX_UNDO_STACK = 50;
const undoStack = [];
const redoStack = [];

export const undoManager = {
  /**
   * Push an operation to the undo stack.
   * @param {object} op
   */
  push(op) {
    if (!op || !op.type) return;
    undoStack.push({ ...op, timestamp: Date.now() });
    if (undoStack.length > MAX_UNDO_STACK) {
      undoStack.shift();
    }
    redoStack.length = 0;
  },

  /** Record file deletion for Ctrl+Z restore */
  recordDelete(paths, label = '') {
    if (!paths || paths.length === 0) return;
    const pathsArray = Array.isArray(paths) ? paths : [paths];
    const displayLabel = label || (pathsArray.length === 1
      ? (pathsArray[0].split(/[/\\]/).pop() || pathsArray[0])
      : `${pathsArray.length} 個項目`);

    this.push({
      type: 'delete',
      paths: pathsArray,
      label: displayLabel,
    });
  },

  /** Record file/folder rename */
  recordRename(oldPath, newPath, oldName, newName) {
    this.push({
      type: 'rename',
      oldPath,
      newPath,
      oldName,
      newName,
    });
  },

  /** Record move / cut & paste */
  recordMove(items) {
    if (!items || items.length === 0) return;
    this.push({
      type: 'move',
      items, // array of { from, to }
    });
  },

  /** Record copy / paste */
  recordCopy(createdPaths) {
    if (!createdPaths || createdPaths.length === 0) return;
    this.push({
      type: 'copy',
      createdPaths: Array.isArray(createdPaths) ? createdPaths : [createdPaths],
    });
  },

  /** Record creation of new folder or file */
  recordCreate(path, name) {
    this.push({
      type: 'create',
      path,
      name,
    });
  },

  /**
   * Perform Undo (Ctrl+Z)
   */
  async undo() {
    if (undoStack.length === 0) {
      toast(t('undo.nothingToUndo') || '沒有可復原的動作', 'info');
      return false;
    }

    const op = undoStack.pop();

    try {
      switch (op.type) {
        case 'delete': {
          let count = 0;
          try {
            count = await restoreFromTrash(op.paths);
          } catch (e) {
            // Fallback: try restoring latest item from trash
            count = await restoreFromTrash([]);
          }

          await refreshCurrent();

          // Select the restored files if present
          if (op.paths && op.paths.length > 0) {
            store.setState({ selectedFiles: new Set(op.paths) });
          }

          const msg = t('undo.restored', { name: op.label }) || `已還原刪除「${op.label}」(Ctrl+Z)`;
          toast(msg, 'success');
          return true;
        }

        case 'rename': {
          await renamePath(op.newPath, op.oldName);
          await refreshCurrent();
          store.setState({ selectedFiles: new Set([op.oldPath]) });
          const msg = t('undo.renameRestored', { name: op.oldName }) || `已還原重新命名「${op.oldName}」(Ctrl+Z)`;
          toast(msg, 'success');
          return true;
        }

        case 'move': {
          for (const item of op.items) {
            try {
              await movePath(item.to, item.from);
            } catch (err) {
              console.warn('Undo move item failed:', err);
            }
          }
          await refreshCurrent();
          toast(t('undo.moveRestored') || '已還原移動 (Ctrl+Z)', 'success');
          return true;
        }

        case 'copy': {
          for (const p of op.createdPaths) {
            try {
              await deletePath(p);
            } catch (err) {
              console.warn('Undo copy item failed:', err);
            }
          }
          await refreshCurrent();
          toast('已撤銷複製 (Ctrl+Z)', 'info');
          return true;
        }

        case 'create': {
          await deletePath(op.path);
          await refreshCurrent();
          const msg = t('undo.createRestored', { name: op.name }) || `已撤銷建立「${op.name}」(Ctrl+Z)`;
          toast(msg, 'info');
          return true;
        }

        default:
          console.warn('Unknown undo operation:', op);
          return false;
      }
    } catch (err) {
      console.error('Undo failed:', err);
      toast((t('undo.failed') || '復原失敗') + ': ' + err, 'error');
      undoStack.push(op);
      return false;
    }
  },
};
