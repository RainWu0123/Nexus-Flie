use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::Emitter;
use notify::Watcher as _;

/// Represents a single file or directory entry returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub extension: Option<String>,
    pub is_hidden: bool,
}

/// Represents a logical drive / volume on the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub mount_point: String,
    pub label: String,
    #[serde(default)]
    pub free: u64,
    #[serde(default)]
    pub total: u64,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Stat multiple paths (used by tag virtual folders).
#[tauri::command]
pub async fn stat_paths(paths: Vec<String>) -> Result<Vec<FileEntry>, String> {
    tokio_spawn_blocking(move || {
        let mut entries = Vec::new();
        for p in paths {
            if let Some(entry) = file_entry_from_path(Path::new(&p)) {
                entries.push(entry);
            }
        }
        Ok(entries)
    })
    .await
}

/// Read the contents of a directory and return structured file entries.
#[tauri::command]
pub async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    tokio_spawn_blocking(move || {
        let dir_path = Path::new(&path);

        if !dir_path.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
        if !dir_path.is_dir() {
            return Err(format!("Path is not a directory: {}", path));
        }

        let read_dir = fs::read_dir(dir_path)
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        let mut entries: Vec<FileEntry> = Vec::new();

        for entry in read_dir {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let file_path = entry.path();
            if let Some(fe) = file_entry_from_dir_entry(&entry, &file_path) {
                entries.push(fe);
            }
        }

        // Sort: directories first, then alphabetically (case-insensitive)
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        entries.shrink_to_fit();
        Ok(entries)
    })
    .await
}

/// Log frontend errors to stderr (no hardcoded disk paths).
#[tauri::command]
pub fn log_error(msg: String) {
    eprintln!("[Nexus Files] {}", msg);
}

/// Return the user's home directory path.
#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").map_err(|_| "Could not determine home directory".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").map_err(|_| "Could not determine home directory".to_string())
    }
}

/// Enumerate logical drives (Windows-specific, returns C:\, D:\, etc.).
#[tauri::command]
pub async fn get_drives() -> Result<Vec<DriveInfo>, String> {
    tokio_spawn_blocking(|| {
        let mut drives = Vec::new();

        #[cfg(target_os = "windows")]
        {
            for letter in b'A'..=b'Z' {
                let mount = format!("{}:\\", letter as char);
                let path = Path::new(&mount);
                if path.exists() {
                    let (free, total) = drive_space(path);
                    drives.push(DriveInfo {
                        label: format!("{}:", letter as char),
                        mount_point: mount,
                        free,
                        total,
                    });
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let (free, total) = drive_space(Path::new("/"));
            drives.push(DriveInfo {
                label: "Root".to_string(),
                mount_point: "/".to_string(),
                free,
                total,
            });
        }

        Ok(drives)
    })
    .await
}

/// Returns a map of known folder IDs to their actual paths.
#[tauri::command]
pub async fn get_known_folders() -> Result<HashMap<String, String>, String> {
    tokio_spawn_blocking(|| {
        let mut folders = HashMap::new();

        #[cfg(target_os = "windows")]
        {
            if let Ok(key) = winreg_get_user_shell_folder("Desktop") {
                folders.insert("desktop".to_string(), key);
            }
            if let Ok(key) = winreg_get_user_shell_folder("{374DE290-123F-4565-9164-39C4925E467B}") {
                folders.insert("downloads".to_string(), key);
            } else if let Ok(home) = std::env::var("USERPROFILE") {
                let dl = format!("{}\\Downloads", home);
                if Path::new(&dl).exists() {
                    folders.insert("downloads".to_string(), dl);
                }
            }
            if let Ok(key) = winreg_get_user_shell_folder("Personal") {
                folders.insert("documents".to_string(), key);
            }
            if let Ok(key) = winreg_get_user_shell_folder("My Pictures") {
                folders.insert("pictures".to_string(), key);
            }
            if let Ok(key) = winreg_get_user_shell_folder("My Music") {
                folders.insert("music".to_string(), key);
            }
            if let Ok(key) = winreg_get_user_shell_folder("My Video") {
                folders.insert("videos".to_string(), key);
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Ok(home) = std::env::var("HOME") {
                folders.insert("desktop".to_string(), format!("{}/Desktop", home));
                folders.insert("documents".to_string(), format!("{}/Documents", home));
                folders.insert("downloads".to_string(), format!("{}/Downloads", home));
                folders.insert("pictures".to_string(), format!("{}/Pictures", home));
                folders.insert("music".to_string(), format!("{}/Music", home));
                folders.insert("videos".to_string(), format!("{}/Videos", home));
            }
        }

        Ok(folders)
    })
    .await
}

// ─── File Actions ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open: {}", e))?;
    Ok(())
}

/// Move path to the system recycle bin / trash (not permanent delete).
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() {
            return Err("Path does not exist".into());
        }
        trash::delete(p).map_err(|e| format!("Failed to move to recycle bin: {}", e))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn rename_path(old_path: String, new_name: String) -> Result<String, String> {
    tokio_spawn_blocking(move || {
        let old = Path::new(&old_path);
        if !old.exists() {
            return Err("Path does not exist".into());
        }
        // Prevent path traversal in the new name
        if new_name.contains('/') || new_name.contains('\\') || new_name.contains("..") {
            return Err("Invalid file name".into());
        }
        let parent = old.parent().ok_or("Cannot determine parent directory")?;
        let new_path = parent.join(&new_name);
        if new_path.exists() {
            return Err(format!("'{}' already exists", new_name));
        }
        fs::rename(old, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;
        Ok(new_path.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn move_path(source: String, destination: String) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let src = Path::new(&source);
        let dst = Path::new(&destination);

        if !src.exists() {
            return Err("Source path does not exist".into());
        }

        let final_dest = if dst.is_dir() {
            dst.join(src.file_name().ok_or("Invalid source file name")?)
        } else {
            dst.to_path_buf()
        };

        if final_dest.exists() {
            return Err("Destination already exists".into());
        }

        // Prefer rename; fall back to copy+delete across volumes
        match fs::rename(src, &final_dest) {
            Ok(()) => Ok(()),
            Err(e) => {
                if src.is_dir() {
                    copy_dir_recursive(src, &final_dest)
                        .map_err(|err| format!("Failed to move directory: {} (rename: {})", err, e))?;
                    fs::remove_dir_all(src)
                        .map_err(|err| format!("Copied but failed to remove source: {}", err))?;
                } else {
                    fs::copy(src, &final_dest)
                        .map_err(|err| format!("Failed to copy file: {} (rename: {})", err, e))?;
                    fs::remove_file(src)
                        .map_err(|err| format!("Copied but failed to remove source: {}", err))?;
                }
                Ok(())
            }
        }
    })
    .await
}

/// Copy a file or directory into a destination folder (or to an explicit path).
/// `overwrite`: if true, replace existing destination.
#[tauri::command]
pub async fn copy_path(source: String, destination: String, overwrite: bool) -> Result<String, String> {
    tokio_spawn_blocking(move || {
        let src = Path::new(&source);
        let dst = Path::new(&destination);

        if !src.exists() {
            return Err("Source path does not exist".into());
        }

        let final_dest = if dst.is_dir() {
            dst.join(src.file_name().ok_or("Invalid source file name")?)
        } else {
            dst.to_path_buf()
        };

        if final_dest.exists() {
            if !overwrite {
                return Err(format!("Destination already exists: {}", final_dest.display()));
            }
            if final_dest.is_dir() {
                fs::remove_dir_all(&final_dest)
                    .map_err(|e| format!("Failed to remove existing directory: {}", e))?;
            } else {
                fs::remove_file(&final_dest)
                    .map_err(|e| format!("Failed to remove existing file: {}", e))?;
            }
        }

        if src.is_dir() {
            copy_dir_recursive(src, &final_dest)
                .map_err(|e| format!("Failed to copy directory: {}", e))?;
        } else {
            if let Some(parent) = final_dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent: {}", e))?;
            }
            fs::copy(src, &final_dest).map_err(|e| format!("Failed to copy file: {}", e))?;
        }

        Ok(final_dest.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_folder(path: String, name: String) -> Result<String, String> {
    tokio_spawn_blocking(move || {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err("Invalid folder name".into());
        }
        let dir = Path::new(&path).join(&name);
        if dir.exists() {
            return Err(format!("'{}' already exists", name));
        }
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {}", e))?;
        Ok(dir.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_file(path: String, name: String) -> Result<String, String> {
    tokio_spawn_blocking(move || {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err("Invalid file name".into());
        }
        let file_path = Path::new(&path).join(&name);
        if file_path.exists() {
            return Err(format!("'{}' already exists", name));
        }
        fs::File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
        Ok(file_path.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<String, String> {
    tokio_spawn_blocking(move || {
        use std::io::Read;
        let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
        let metadata = file
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        if metadata.len() > 20 * 1024 * 1024 {
            return Err("File too large for preview (>20MB)".into());
        }
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        Ok(base64_encode(&buffer))
    })
    .await
}

/// Latest calc wins: a new request supersedes (cancels) any walk still in flight,
/// so at most one recursive walk ever makes progress.
static SIZE_CALC_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Recursively sum file sizes under a folder (manual, on demand).
/// Skips symlinks/junctions; depth-capped against reparse loops.
#[tauri::command]
pub async fn calc_folder_size(path: String) -> Result<u64, String> {
    use std::sync::atomic::Ordering;
    let gen = SIZE_CALC_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    tokio_spawn_blocking(move || calc_size_recursive(Path::new(&path), 0, gen)).await
}

/// Open a terminal at the given directory (Windows Terminal if present, else cmd).
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

        let dir = if path.is_empty() || path.starts_with("nexus://") {
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
        } else {
            path
        };

        if std::process::Command::new("wt.exe")
            .args(["-d", &dir])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }

        std::process::Command::new("cmd.exe")
            .current_dir(&dir)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open terminal: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("sh")
            .current_dir(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open terminal: {}", e))
    }
}

/// Execute a command entered into the address bar (e.g. `cmd`, `powershell`, `wt`, `calc`, `notepad`, etc.)
#[tauri::command]
pub fn execute_address_command(command: String, working_dir: String) -> Result<(), String> {
    let cmd_trimmed = command.trim();
    if cmd_trimmed.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

        let dir = if working_dir.is_empty() || working_dir.starts_with("nexus://") {
            std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
        } else {
            working_dir
        };

        let cmd_lower = cmd_trimmed.to_lowercase();
        if cmd_lower == "cmd" || cmd_lower == "cmd.exe" {
            std::process::Command::new("cmd.exe")
                .current_dir(&dir)
                .creation_flags(CREATE_NEW_CONSOLE)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to spawn cmd: {}", e))
        } else if cmd_lower == "powershell" || cmd_lower == "powershell.exe" {
            std::process::Command::new("powershell.exe")
                .current_dir(&dir)
                .creation_flags(CREATE_NEW_CONSOLE)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to spawn powershell: {}", e))
        } else if cmd_lower == "pwsh" || cmd_lower == "pwsh.exe" {
            std::process::Command::new("pwsh.exe")
                .current_dir(&dir)
                .creation_flags(CREATE_NEW_CONSOLE)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to spawn pwsh: {}", e))
        } else if cmd_lower == "wt" || cmd_lower == "wt.exe" {
            std::process::Command::new("wt.exe")
                .args(["-d", &dir])
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to spawn wt: {}", e))
        } else {
            // General command execution in working directory via Windows start
            std::process::Command::new("cmd.exe")
                .args(["/c", "start", "", cmd_trimmed])
                .current_dir(&dir)
                .creation_flags(CREATE_NEW_CONSOLE)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to execute command: {}", e))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("sh")
            .args(["-c", cmd_trimmed])
            .current_dir(if working_dir.is_empty() { "." } else { &working_dir })
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to execute command: {}", e))
    }
}

/// Reveal a file/folder in Windows Explorer with the item selected.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let target = Path::new(&path);
        let parent = target.parent().unwrap_or(Path::new("/"));
        open::that(parent).map_err(|e| format!("Failed to reveal: {}", e))
    }
}

/// Permanently empty the system recycle bin.
#[tauri::command]
pub async fn empty_recycle_bin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        tokio_spawn_blocking(|| {
            let items = trash::os_limited::list().map_err(|e| format!("Failed to list recycle bin: {}", e))?;
            trash::os_limited::purge_all(items).map_err(|e| format!("Failed to empty recycle bin: {}", e))
        })
        .await
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Not supported on this platform".to_string())
    }
}

/// Read the first 256 KB of a file as lossy UTF-8 text (preview only).
#[tauri::command]
pub async fn read_text_preview(path: String) -> Result<String, String> {
    const CAP: usize = 256 * 1024;
    tokio_spawn_blocking(move || {
        use std::io::Read;
        let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
        let mut buf = vec![0u8; CAP];
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        buf.truncate(n);
        Ok(String::from_utf8_lossy(&buf).into_owned())
    })
    .await
}

// ─── Current-directory watcher (notify) ──────────────────────────────────────

static WATCHER: Mutex<Option<(notify::RecommendedWatcher, String)>> = Mutex::new(None);

/// Watch exactly one directory (the current one); replaces any previous watch.
#[tauri::command]
pub fn watch_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut guard = WATCHER.lock().map_err(|_| "Watcher lock poisoned")?;
    if let Some((_, current)) = guard.as_ref() {
        if current == &path {
            return Ok(());
        }
    }
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        // Frontend debounces; payload carries no data to keep IPC tiny.
        if res.is_ok() {
            let _ = handle.emit("fs-change", ());
        }
    })
    .map_err(|e| format!("Failed to create watcher: {}", e))?;
    watcher
        .watch(Path::new(&path), notify::RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch: {}", e))?;
    *guard = Some((watcher, path));
    Ok(())
}

/// Drop the current watch, if any.
#[tauri::command]
pub fn unwatch_directory() {
    if let Ok(mut guard) = WATCHER.lock() {
        *guard = None;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Run blocking filesystem work off the async runtime.
async fn tokio_spawn_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    // Tauri 2 uses tokio; spawn_blocking if available, else run inline.
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(result) => result,
        Err(e) => Err(format!("Background task failed: {}", e)),
    }
}

fn file_entry_from_path(path: &Path) -> Option<FileEntry> {
    let metadata = fs::metadata(path).ok()?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let is_dir = metadata.is_dir();
    let is_hidden = is_hidden_file(&name, Some(&metadata));
    Some(FileEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir,
        size: metadata.len(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
        extension: if !is_dir {
            path.extension().map(|e| e.to_string_lossy().into_owned())
        } else {
            None
        },
        is_hidden,
    })
}

fn file_entry_from_dir_entry(entry: &fs::DirEntry, file_path: &Path) -> Option<FileEntry> {
    let file_name = entry.file_name().to_string_lossy().to_string();
    let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
    let metadata = entry.metadata().ok();
    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let is_hidden = is_hidden_file(&file_name, metadata.as_ref());

    Some(FileEntry {
        name: file_name.clone(),
        path: file_path.to_string_lossy().to_string(),
        is_dir,
        size,
        modified,
        extension: if !is_dir {
            Path::new(&file_name)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        } else {
            None
        },
        is_hidden,
    })
}

fn is_hidden_file(name: &str, metadata: Option<&fs::Metadata>) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        if let Some(m) = metadata {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            if m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return true;
            }
        }
    }
    name.starts_with('.')
}

fn calc_size_recursive(dir: &Path, depth: usize, gen: u64) -> Result<u64, String> {
    // Depth cap guards against junction/reparse cycles; skips links entirely.
    if depth > 64 {
        return Ok(0);
    }
    let mut total: u64 = 0;
    let mut seen: u32 = 0;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        // Abort cheaply when a newer calc request superseded this one.
        seen += 1;
        if seen % 128 == 0
            && SIZE_CALC_GEN.load(std::sync::atomic::Ordering::Relaxed) != gen
        {
            return Err("cancelled".to_string());
        }
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            total += calc_size_recursive(&entry.path(), depth + 1, gen)?;
        } else {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(total)
}

fn drive_space(path: &Path) -> (u64, u64) {
    // Sidebar-only, once per enumeration — no polling.
    let free = fs2::free_space(path).unwrap_or(0);
    let total = fs2::total_space(path).unwrap_or(0);
    (free, total)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Simple base64 encoder (no external dependency needed)
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ─── Known Folders (Windows registry) ────────────────────────────────────────

#[cfg(target_os = "windows")]
fn winreg_get_user_shell_folder(name: &str) -> Result<String, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    if let Ok(key) =
        hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")
    {
        if let Ok(value) = key.get_value::<String, _>(name) {
            let expanded = expand_env_vars(&value);
            if Path::new(&expanded).exists() {
                return Ok(expanded);
            }
        }
    }

    if let Ok(key) =
        hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders")
    {
        if let Ok(value) = key.get_value::<String, _>(name) {
            let expanded = expand_env_vars(&value);
            if Path::new(&expanded).exists() {
                return Ok(expanded);
            }
        }
    }

    Err(format!(
        "Registry key '{}' not found or path does not exist",
        name
    ))
}

#[cfg(target_os = "windows")]
fn expand_env_vars(input: &str) -> String {
    let mut result = input.to_string();
    while let Some(start) = result.find('%') {
        if let Some(end) = result[start + 1..].find('%') {
            let var_name = &result[start + 1..start + 1 + end];
            if let Ok(val) = std::env::var(var_name) {
                result = format!("{}{}{}", &result[..start], val, &result[start + 2 + end..]);
            } else {
                break;
            }
        } else {
            break;
        }
    }
    result
}

// ─── Archive Commands (ZIP, TAR, TGZ, TAR.GZ) ──────────────────────────────

/// Read directory entries from inside an archive (.zip, .tgz, .tar.gz, .tar).
#[tauri::command]
pub async fn read_archive_directory(archive_path: String, internal_path: String) -> Result<Vec<FileEntry>, String> {
    tokio_spawn_blocking(move || {
        let path_lower = archive_path.to_lowercase();
        let prefix = if internal_path.is_empty() || internal_path == "/" {
            String::new()
        } else {
            let mut p = internal_path.replace('\\', "/");
            if !p.ends_with('/') {
                p.push('/');
            }
            if p.starts_with('/') {
                p.remove(0);
            }
            p
        };

        let mut seen_dirs = std::collections::HashSet::new();
        let mut entries: Vec<FileEntry> = Vec::new();

        if path_lower.ends_with(".zip") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;

            for i in 0..archive.len() {
                let item = match archive.by_index(i) {
                    Ok(item) => item,
                    Err(_) => continue,
                };
                let name = item.name().replace('\\', "/");

                if !prefix.is_empty() && !name.starts_with(&prefix) {
                    continue;
                }

                let relative = if prefix.is_empty() {
                    &name
                } else {
                    &name[prefix.len()..]
                };

                if relative.is_empty() {
                    continue;
                }

                let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
                if parts.is_empty() {
                    continue;
                }

                let entry_name = parts[0].to_string();
                let is_direct_child = parts.len() == 1 && !item.is_dir();

                if is_direct_child {
                    let extension = Path::new(&entry_name)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_string());

                    let virtual_path = format!("archive://{}?entry={}{}", archive_path, prefix, entry_name);

                    entries.push(FileEntry {
                        name: entry_name,
                        path: virtual_path,
                        is_dir: false,
                        size: item.size(),
                        modified: None,
                        extension,
                        is_hidden: false,
                    });
                } else {
                    if !seen_dirs.contains(&entry_name) {
                        seen_dirs.insert(entry_name.clone());
                        let dir_internal = format!("{}{}/", prefix, entry_name);
                        let virtual_path = format!("archive://{}?entry={}", archive_path, dir_internal);

                        entries.push(FileEntry {
                            name: entry_name,
                            path: virtual_path,
                            is_dir: true,
                            size: 0,
                            modified: None,
                            extension: None,
                            is_hidden: false,
                        });
                    }
                }
            }
        } else if path_lower.ends_with(".tgz") || path_lower.ends_with(".tar.gz") || path_lower.ends_with(".json.tgz") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open TGZ: {}", e))?;
            let gz = flate2::read::GzDecoder::new(file);
            let mut archive = tar::Archive::new(gz);

            if let Ok(tar_entries) = archive.entries() {
                for entry_result in tar_entries {
                    let entry = match entry_result {
                        Ok(e) => e,
                        Err(_) => continue,
                    };
                    let path_buf = match entry.path() {
                        Ok(p) => p.to_string_lossy().replace('\\', "/"),
                        Err(_) => continue,
                    };
                    let name = path_buf;

                    if !prefix.is_empty() && !name.starts_with(&prefix) {
                        continue;
                    }

                    let relative = if prefix.is_empty() {
                        &name
                    } else {
                        &name[prefix.len()..]
                    };

                    if relative.is_empty() {
                        continue;
                    }

                    let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
                    if parts.is_empty() {
                        continue;
                    }

                    let entry_name = parts[0].to_string();
                    let is_dir = entry.header().entry_type().is_dir() || parts.len() > 1;

                    if !is_dir && parts.len() == 1 {
                        let extension = Path::new(&entry_name)
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_string());

                        let virtual_path = format!("archive://{}?entry={}{}", archive_path, prefix, entry_name);

                        entries.push(FileEntry {
                            name: entry_name,
                            path: virtual_path,
                            is_dir: false,
                            size: entry.header().size().unwrap_or(0),
                            modified: entry.header().mtime().ok(),
                            extension,
                            is_hidden: false,
                        });
                    } else {
                        if !seen_dirs.contains(&entry_name) {
                            seen_dirs.insert(entry_name.clone());
                            let dir_internal = format!("{}{}/", prefix, entry_name);
                            let virtual_path = format!("archive://{}?entry={}", archive_path, dir_internal);

                            entries.push(FileEntry {
                                name: entry_name,
                                path: virtual_path,
                                is_dir: true,
                                size: 0,
                                modified: None,
                                extension: None,
                                is_hidden: false,
                            });
                        }
                    }
                }
            }
        } else if path_lower.ends_with(".tar") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open TAR: {}", e))?;
            let mut archive = tar::Archive::new(file);

            if let Ok(tar_entries) = archive.entries() {
                for entry_result in tar_entries {
                    let entry = match entry_result {
                        Ok(e) => e,
                        Err(_) => continue,
                    };
                    let path_buf = match entry.path() {
                        Ok(p) => p.to_string_lossy().replace('\\', "/"),
                        Err(_) => continue,
                    };
                    let name = path_buf;

                    if !prefix.is_empty() && !name.starts_with(&prefix) {
                        continue;
                    }

                    let relative = if prefix.is_empty() {
                        &name
                    } else {
                        &name[prefix.len()..]
                    };

                    if relative.is_empty() {
                        continue;
                    }

                    let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
                    if parts.is_empty() {
                        continue;
                    }

                    let entry_name = parts[0].to_string();
                    let is_dir = entry.header().entry_type().is_dir() || parts.len() > 1;

                    if !is_dir && parts.len() == 1 {
                        let extension = Path::new(&entry_name)
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_string());

                        let virtual_path = format!("archive://{}?entry={}{}", archive_path, prefix, entry_name);

                        entries.push(FileEntry {
                            name: entry_name,
                            path: virtual_path,
                            is_dir: false,
                            size: entry.header().size().unwrap_or(0),
                            modified: entry.header().mtime().ok(),
                            extension,
                            is_hidden: false,
                        });
                    } else {
                        if !seen_dirs.contains(&entry_name) {
                            seen_dirs.insert(entry_name.clone());
                            let dir_internal = format!("{}{}/", prefix, entry_name);
                            let virtual_path = format!("archive://{}?entry={}", archive_path, dir_internal);

                            entries.push(FileEntry {
                                name: entry_name,
                                path: virtual_path,
                                is_dir: true,
                                size: 0,
                                modified: None,
                                extension: None,
                                is_hidden: false,
                            });
                        }
                    }
                }
            }
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
}

/// Backward-compatible alias for read_archive_directory.
#[tauri::command]
pub async fn read_zip_directory(zip_path: String, internal_path: String) -> Result<Vec<FileEntry>, String> {
    read_archive_directory(zip_path, internal_path).await
}

/// Extract entire archive (.zip, .tgz, .tar.gz, .tar) into destination folder.
#[tauri::command]
pub async fn extract_archive(archive_path: String, destination: String) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let dest = Path::new(&destination);
        if !dest.exists() {
            fs::create_dir_all(dest).map_err(|e| format!("Failed to create destination folder: {}", e))?;
        }

        let path_lower = archive_path.to_lowercase();
        if path_lower.ends_with(".zip") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;
            archive.extract(dest).map_err(|e| format!("Failed to extract ZIP: {}", e))?;
        } else if path_lower.ends_with(".tgz") || path_lower.ends_with(".tar.gz") || path_lower.ends_with(".json.tgz") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open TGZ: {}", e))?;
            let gz = flate2::read::GzDecoder::new(file);
            let mut archive = tar::Archive::new(gz);
            archive.unpack(dest).map_err(|e| format!("Failed to extract TGZ: {}", e))?;
        } else if path_lower.ends_with(".tar") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open TAR: {}", e))?;
            let mut archive = tar::Archive::new(file);
            archive.unpack(dest).map_err(|e| format!("Failed to extract TAR: {}", e))?;
        }
        Ok(())
    })
    .await
}

/// Backward-compatible alias for extract_archive.
#[tauri::command]
pub async fn extract_zip(zip_path: String, destination: String) -> Result<(), String> {
    extract_archive(zip_path, destination).await
}

// ─── Window Management Commands ─────────────────────────────────────────────

#[tauri::command]
pub async fn app_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub async fn app_toggle_maximize(window: tauri::Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub async fn app_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
pub async fn app_is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}




