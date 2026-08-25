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

  async movePath(source, destination) {
    return await invoke('move_path', { source, destination });
  },

  async copyPath(source, destination, overwrite = false) {
    return await invoke('copy_path', { source, destination, overwrite });
  },

  async deletePath(path) {
    return await invoke('delete_path', { path });
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
};

export default FileSystemGateway;
