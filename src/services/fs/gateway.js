/**
 * Nexus Files — FileSystem Gateway (Stateless Port & Adapter)
 * Wraps Tauri IPC operations cleanly without mutating global UI state.
 */
import { invoke } from '@tauri-apps/api/core';

export const FileSystemGateway = {
  async readDirectory(path) {
    return await invoke('read_directory', { path });
  },

  async statPaths(paths) {
    return await invoke('stat_paths', { paths });
  },

  async getHomeDir() {
    return await invoke('get_home_dir');
  },

  async getDrives() {
    return await invoke('get_drives');
  },

  async getKnownFolders() {
    try {
      return await invoke('get_known_folders');
    } catch {
      return {};
    }
  },

  async openFile(path) {
    return await invoke('open_file', { path });
  },

  async openFileAsAdmin(path) {
    return await invoke('open_file_as_admin', { path });
  },

  async openTerminalAsAdmin(path) {
    return await invoke('open_terminal_as_admin', { path });
  },

  async movePath(source, destination) {
    return await invoke('move_path', { source, destination });
  },

  async copyPath(source, destination, overwrite = false) {
    return await invoke('copy_path', { source, destination, overwrite });
  },

  async deletePath(path) {
    return await invoke('delete_path', { path });
  },

  async restoreFromTrash(paths = []) {
    return await invoke('restore_from_trash', { paths });
  },

  async renamePath(oldPath, newName) {
    try {
      return await invoke('rename_path', { oldPath, newName });
    } catch {
      return await invoke('rename_path', { old_path: oldPath, new_name: newName });
    }
  },

  async createFolder(path, name) {
    return await invoke('create_folder', { path, name });
  },

  async createFile(path, name) {
    return await invoke('create_file', { path, name });
  },

  async calcFolderSize(path) {
    return await invoke('calc_folder_size', { path });
  },

  async openTerminal(path) {
    return await invoke('open_terminal', { path });
  },

  async revealInExplorer(path) {
    return await invoke('reveal_in_explorer', { path });
  },

  async emptyRecycleBin() {
    return await invoke('empty_recycle_bin');
  },

  async readTextPreview(path) {
    return await invoke('read_text_preview', { path });
  },

  async readArchiveDirectory(archivePath, internalPath = '') {
    return await invoke('read_archive_directory', { archivePath, internalPath });
  },

  async extractArchive(archivePath, destination) {
    return await invoke('extract_archive', { archivePath, destination });
  },

  async readZipDirectory(zipPath, internalPath = '') {
    return await this.readArchiveDirectory(zipPath, internalPath);
  },

  async extractZip(zipPath, destination) {
    return await this.extractArchive(zipPath, destination);
  },

  async executeAddressCommand(command, workingDir = '') {
    return await invoke('execute_address_command', { command, workingDir });
  },

  async getLaunchArgs() {
    try {
      return await invoke('get_launch_args');
    } catch {
      return null;
    }
  },

  async checkIsDefaultFileManager() {
    try {
      return await invoke('check_is_default_file_manager');
    } catch {
      return false;
    }
  },

  async getThumbnailBase64(path, maxSize = 128) {
    return await invoke('get_thumbnail_base64', { path, maxSize });
  },

  async trimMemory() {
    try {
      return await invoke('trim_memory');
    } catch {
      return null;
    }
  },

  async extractArchiveEntries(archivePath, entries, destination) {
    return await invoke('extract_archive_entries', { archivePath, entries, destination });
  },

  async setClipboardFiles(paths, isCut = false) {
    try {
      return await invoke('set_clipboard_files', { paths, isCut });
    } catch (err) {
      console.warn('Set OS clipboard error:', err);
    }
  },

  async startNativeDrag(paths) {
    try {
      return await invoke('start_native_drag', { paths });
    } catch (err) {
      console.warn('Start native drag error:', err);
    }
  },

  async getOpenWithApps(path) {
    try {
      return await invoke('get_open_with_apps', { path });
    } catch (err) {
      console.warn('getOpenWithApps error:', err);
      return [];
    }
  },

  async openFileWith(path, appPath) {
    return await invoke('open_file_with', { path, appPath });
  },

  async showOpenWithDialog(path) {
    return await invoke('show_open_with_dialog', { path });
  },

  async pickExecutableFile() {
    try {
      return await invoke('pick_executable_file');
    } catch (err) {
      console.warn('pickExecutableFile error:', err);
      return null;
    }
  },

  async setAsDefaultFileManager() {
    return await invoke('set_as_default_file_manager');
  },

  async restoreDefaultFileManager() {
    return await invoke('restore_default_file_manager');
  },

  async getFileProperties(path) {
    return await invoke('get_file_properties', { path });
  },

  async calcFolderDetail(path) {
    return await invoke('calc_folder_detail', { path });
  },

  async setFileAttributes(path, readonly = null, hidden = null) {
    return await invoke('set_file_attributes', { path, readonly, hidden });
  },
};

export default FileSystemGateway;
