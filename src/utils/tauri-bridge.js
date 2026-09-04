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
export const openFileAsAdmin = (path) => FileSystemGateway.openFileAsAdmin(path);
export const openTerminalAsAdmin = (path) => FileSystemGateway.openTerminalAsAdmin(path);
export const movePath = (source, destination) => FileSystemGateway.movePath(source, destination);
export const copyPath = (source, destination, overwrite) => FileSystemGateway.copyPath(source, destination, overwrite);
export const deletePath = (path) => FileSystemGateway.deletePath(path);
export const restoreFromTrash = (paths) => FileSystemGateway.restoreFromTrash(paths);
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
export const getLaunchArgs = () => FileSystemGateway.getLaunchArgs();
export const checkIsDefaultFileManager = () => FileSystemGateway.checkIsDefaultFileManager();
export const setAsDefaultFileManager = () => FileSystemGateway.setAsDefaultFileManager();
export const restoreDefaultFileManager = () => FileSystemGateway.restoreDefaultFileManager();
export const getThumbnailBase64 = (path, maxSize) => FileSystemGateway.getThumbnailBase64(path, maxSize);
export const trimMemory = () => FileSystemGateway.trimMemory();
export const extractArchiveEntries = (archivePath, entries, destination) => FileSystemGateway.extractArchiveEntries(archivePath, entries, destination);
export const setClipboardFiles = (paths, isCut) => FileSystemGateway.setClipboardFiles(paths, isCut);
export const startNativeDrag = (paths) => FileSystemGateway.startNativeDrag(paths);
export const getOpenWithApps = (path) => FileSystemGateway.getOpenWithApps(path);
export const openFileWith = (path, appPath) => FileSystemGateway.openFileWith(path, appPath);
export const showOpenWithDialog = (path) => FileSystemGateway.showOpenWithDialog(path);
export const pickExecutableFile = () => FileSystemGateway.pickExecutableFile();
export const getFileProperties = (path) => FileSystemGateway.getFileProperties(path);
export const calcFolderDetail = (path) => FileSystemGateway.calcFolderDetail(path);
export const setFileAttributes = (path, readonly, hidden) => FileSystemGateway.setFileAttributes(path, readonly, hidden);




