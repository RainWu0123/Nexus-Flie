/**
 * Nexus Files — Tauri IPC Bridge (Compatibility Layer)
 * Delegates to stateless FileSystemGateway & NavigationEngine.
 */
import FileSystemGateway from '../services/fs/gateway.js';
import NavigationEngine from '../services/navigation/navigation-engine.js';
import store from '../store/store.js';

export const readDirectory = (path) => NavigationEngine.loadDirectory(path);
export const refreshCurrent = () => NavigationEngine.refreshCurrent();
export const navigateTo = (path) => NavigationEngine.navigateTo(path);
export const navigateBack = () => NavigationEngine.navigateBack();
export const navigateForward = () => NavigationEngine.navigateForward();
export const navigateUp = () => NavigationEngine.navigateUp();

export const getHomeDir = () => FileSystemGateway.getHomeDir();
export const getDrives = async () => {
  const drives = await FileSystemGateway.getDrives();
  store.setState({ drives });
  return drives;
};
export const getKnownFolders = () => FileSystemGateway.getKnownFolders();
export const openFile = (path) => FileSystemGateway.openFile(path);
export const movePath = (source, destination) => FileSystemGateway.movePath(source, destination);
export const copyPath = (source, destination, overwrite) => FileSystemGateway.copyPath(source, destination, overwrite);
export const deletePath = (path) => FileSystemGateway.deletePath(path);
export const renamePath = (oldPath, newName) => FileSystemGateway.renamePath(oldPath, newName);
export const createFolder = (path, name) => FileSystemGateway.createFolder(path, name);
export const createFile = (path, name) => FileSystemGateway.createFile(path, name);
export const calcFolderSize = (path) => FileSystemGateway.calcFolderSize(path);
export const openTerminal = (path) => FileSystemGateway.openTerminal(path);
export const revealInExplorer = (path) => FileSystemGateway.revealInExplorer(path);
export const emptyRecycleBin = () => FileSystemGateway.emptyRecycleBin();
export const readTextPreview = (path) => FileSystemGateway.readTextPreview(path);
export const extractZip = (zipPath, destination) => FileSystemGateway.extractZip(zipPath, destination);
export const extractArchive = (archivePath, destination) => FileSystemGateway.extractArchive(archivePath, destination);
export const readArchiveDirectory = (archivePath, internalPath) => FileSystemGateway.readArchiveDirectory(archivePath, internalPath);
export const executeAddressCommand = (command, workingDir) => FileSystemGateway.executeAddressCommand(command, workingDir);



