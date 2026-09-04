use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
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

/// Comprehensive file/folder properties matching Windows native properties dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProperties {
    pub name: String,
    pub path: String,
    pub parent_dir: String,
    pub is_dir: bool,
    pub size: u64,
    pub created: Option<u64>,
    pub modified: Option<u64>,
    pub accessed: Option<u64>,
    pub is_readonly: bool,
    pub is_hidden: bool,
    pub extension: Option<String>,
    pub type_description: String,
    pub opens_with: Option<String>,
}

/// Recursive folder calculation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDetail {
    pub size: u64,
    pub file_count: u64,
    pub folder_count: u64,
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

        let mut entries: Vec<FileEntry> = Vec::with_capacity(128);

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
            unsafe {
                extern "system" {
                    fn GetLogicalDrives() -> u32;
                }
                let mask = GetLogicalDrives();
                for i in 0..26 {
                    if (mask & (1 << i)) != 0 {
                        let letter = (b'A' + i) as char;
                        let mount = format!("{}:\\", letter);
                        let path = Path::new(&mount);
                        let (free, total) = drive_space(path);
                        drives.push(DriveInfo {
                            label: format!("{}:", letter),
                            mount_point: mount,
                            free,
                            total,
                        });
                    }
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

pub fn parse_archive_virtual_path(path: &str) -> Option<(String, String)> {
    if !path.starts_with("archive://") {
        return None;
    }
    let without_scheme = &path["archive://".len()..];
    let parts: Vec<&str> = without_scheme.splitn(2, "?entry=").collect();
    if parts.is_empty() {
        return None;
    }
    let archive_path = parts[0].to_string();
    let entry_path = if parts.len() > 1 {
        parts[1].to_string()
    } else {
        String::new()
    };
    Some((archive_path, entry_path))
}

pub fn read_archive_entry_bytes(archive_path: &str, internal_entry: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let path_lower = archive_path.to_lowercase();
    let clean_entry = internal_entry.replace('\\', "/").trim_matches('/').to_string();

    if path_lower.ends_with(".zip") {
        let file = fs::File::open(archive_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;

        for i in 0..archive.len() {
            let mut item = match archive.by_index(i) {
                Ok(it) => it,
                Err(_) => continue,
            };
            let name = item.name().replace('\\', "/").trim_matches('/').to_string();
            if name == clean_entry {
                let mut buf = Vec::with_capacity(item.size() as usize);
                item.read_to_end(&mut buf).map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
                return Ok(buf);
            }
        }
        Err(format!("Entry '{}' not found in ZIP", internal_entry))
    } else if path_lower.ends_with(".tgz") || path_lower.ends_with(".tar.gz") || path_lower.ends_with(".json.tgz") {
        let file = fs::File::open(archive_path).map_err(|e| format!("Failed to open TGZ: {}", e))?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        if let Ok(mut tar_entries) = archive.entries() {
            while let Some(Ok(mut entry)) = tar_entries.next() {
                let path_buf = match entry.path() {
                    Ok(p) => p.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let name = path_buf.trim_matches('/').to_string();
                if name == clean_entry {
                    let mut buf = Vec::new();
                    entry.read_to_end(&mut buf).map_err(|e| format!("Failed to read TGZ entry: {}", e))?;
                    return Ok(buf);
                }
            }
        }
        Err(format!("Entry '{}' not found in TGZ", internal_entry))
    } else if path_lower.ends_with(".tar") {
        let file = fs::File::open(archive_path).map_err(|e| format!("Failed to open TAR: {}", e))?;
        let mut archive = tar::Archive::new(file);
        if let Ok(mut tar_entries) = archive.entries() {
            while let Some(Ok(mut entry)) = tar_entries.next() {
                let path_buf = match entry.path() {
                    Ok(p) => p.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let name = path_buf.trim_matches('/').to_string();
                if name == clean_entry {
                    let mut buf = Vec::new();
                    entry.read_to_end(&mut buf).map_err(|e| format!("Failed to read TAR entry: {}", e))?;
                    return Ok(buf);
                }
            }
        }
        Err(format!("Entry '{}' not found in TAR", internal_entry))
    } else {
        Err("Unsupported archive format".into())
    }
}

pub fn extract_single_archive_entry_to_temp(archive_path: &str, internal_entry: &str) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let bytes = read_archive_entry_bytes(archive_path, internal_entry)?;
    
    let mut hasher = DefaultHasher::new();
    archive_path.hash(&mut hasher);
    internal_entry.hash(&mut hasher);
    let hash = hasher.finish();

    let temp_dir = std::env::temp_dir().join("nexus_temp_open").join(format!("{:x}", hash));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let file_name = internal_entry
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or("file")
        .to_string();

    let out_file = temp_dir.join(&file_name);
    fs::write(&out_file, bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;

    Ok(out_file)
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    if path.starts_with("archive://") {
        tokio_spawn_blocking(move || {
            if let Some((archive_path, entry_path)) = parse_archive_virtual_path(&path) {
                let temp_file = extract_single_archive_entry_to_temp(&archive_path, &entry_path)?;
                open::that(&temp_file).map_err(|e| format!("Failed to open temp archive file: {}", e))?;
                Ok(())
            } else {
                Err("Invalid archive path".into())
            }
        })
        .await
    } else {
        open::that(&path).map_err(|e| format!("Failed to open: {}", e))?;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
extern "system" {
    fn ShellExecuteW(
        hwnd: *mut std::ffi::c_void,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> isize;
}

#[cfg(target_os = "windows")]
fn open_as_admin_internal(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let p = Path::new(path);
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let is_dir = p.is_dir();

    if is_dir {
        return open_terminal_as_admin_internal(path);
    }

    const SW_SHOWNORMAL: i32 = 1;
    let op: Vec<u16> = OsStr::new("runas").encode_wide().chain(Some(0)).collect();
    let file_wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
    let dir_wide: Option<Vec<u16>> = p.parent().map(|d| d.as_os_str().encode_wide().chain(Some(0)).collect());
    let dir_ptr = dir_wide.as_ref().map(|d| d.as_ptr()).unwrap_or(std::ptr::null());

    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file_wide.as_ptr(),
            std::ptr::null(),
            dir_ptr,
            SW_SHOWNORMAL,
        )
    };

    if res > 32 {
        return Ok(());
    }

    if res == 5 || res == 1223 {
        return Err("已取消使用者帳戶控制 (UAC) 提示".to_string());
    }

    // For non-executable documents (e.g. .txt, .json, .ini, .log), try opening with Notepad as admin
    if matches!(ext.as_str(), "txt" | "log" | "ini" | "cfg" | "conf" | "json" | "xml" | "yaml" | "yml" | "md" | "toml" | "") {
        let editor_wide: Vec<u16> = OsStr::new("notepad.exe").encode_wide().chain(Some(0)).collect();
        let param_wide: Vec<u16> = OsStr::new(&format!("\"{}\"", path)).encode_wide().chain(Some(0)).collect();
        let res2 = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                editor_wide.as_ptr(),
                param_wide.as_ptr(),
                dir_ptr,
                SW_SHOWNORMAL,
            )
        };
        if res2 > 32 {
            return Ok(());
        }
    }

    Err(format!("無法以系統管理員身分執行 (代碼: {})", res))
}

#[cfg(target_os = "windows")]
fn open_terminal_as_admin_internal(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let dir = if path.is_empty() || path.starts_with("nexus://") {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
    } else {
        path.to_string()
    };

    const SW_SHOWNORMAL: i32 = 1;
    let op: Vec<u16> = OsStr::new("runas").encode_wide().chain(Some(0)).collect();
    let dir_wide: Vec<u16> = OsStr::new(&dir).encode_wide().chain(Some(0)).collect();

    // 1. Try Windows Terminal (wt.exe) with -d directory
    let wt_file: Vec<u16> = OsStr::new("wt.exe").encode_wide().chain(Some(0)).collect();
    let wt_params: Vec<u16> = OsStr::new(&format!("-d \"{}\"", dir)).encode_wide().chain(Some(0)).collect();

    let res_wt = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            wt_file.as_ptr(),
            wt_params.as_ptr(),
            dir_wide.as_ptr(),
            SW_SHOWNORMAL,
        )
    };

    if res_wt > 32 {
        return Ok(());
    }

    if res_wt == 5 || res_wt == 1223 {
        return Err("已取消使用者帳戶控制 (UAC) 提示".to_string());
    }

    // 2. Fallback to PowerShell as Administrator
    let ps_file: Vec<u16> = OsStr::new("powershell.exe").encode_wide().chain(Some(0)).collect();
    let ps_params: Vec<u16> = OsStr::new(&format!("-NoExit -Command \"Set-Location -LiteralPath '{}'\"", dir)).encode_wide().chain(Some(0)).collect();

    let res_ps = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            ps_file.as_ptr(),
            ps_params.as_ptr(),
            dir_wide.as_ptr(),
            SW_SHOWNORMAL,
        )
    };

    if res_ps > 32 {
        return Ok(());
    }

    // 3. Fallback to cmd.exe as Administrator
    let cmd_file: Vec<u16> = OsStr::new("cmd.exe").encode_wide().chain(Some(0)).collect();
    let cmd_params: Vec<u16> = OsStr::new(&format!("/k cd /d \"{}\"", dir)).encode_wide().chain(Some(0)).collect();

    let res_cmd = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            cmd_file.as_ptr(),
            cmd_params.as_ptr(),
            dir_wide.as_ptr(),
            SW_SHOWNORMAL,
        )
    };

    if res_cmd > 32 {
        return Ok(());
    }

    Err(format!("無法以系統管理員身分開啟終端機 (代碼: {})", res_cmd))
}

#[cfg(not(target_os = "windows"))]
fn open_as_admin_internal(path: &str) -> Result<(), String> {
    std::process::Command::new("pkexec")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to run as admin: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn open_terminal_as_admin_internal(path: &str) -> Result<(), String> {
    std::process::Command::new("pkexec")
        .args(["x-terminal-emulator", "--working-directory", path])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open terminal as admin: {}", e))
}

#[tauri::command]
pub async fn open_file_as_admin(path: String) -> Result<(), String> {
    if path.starts_with("archive://") {
        tokio_spawn_blocking(move || {
            if let Some((archive_path, entry_path)) = parse_archive_virtual_path(&path) {
                let temp_file = extract_single_archive_entry_to_temp(&archive_path, &entry_path)?;
                open_as_admin_internal(&temp_file.to_string_lossy())
            } else {
                Err("Invalid archive path".into())
            }
        })
        .await
    } else {
        tokio_spawn_blocking(move || {
            open_as_admin_internal(&path)
        })
        .await
    }
}

#[tauri::command]
pub async fn open_terminal_as_admin(path: String) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        open_terminal_as_admin_internal(&path)
    })
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithApp {
    pub name: String,
    pub path: String,
}

fn resolve_app_path(exe_name_or_path: &str) -> Option<(String, String)> {
    let p = Path::new(exe_name_or_path);
    if p.is_file() {
        let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("App").to_string();
        return Some((name, p.to_string_lossy().to_string()));
    }
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let exe = if exe_name_or_path.to_lowercase().ends_with(".exe") {
            exe_name_or_path.to_string()
        } else {
            format!("{}.exe", exe_name_or_path)
        };

        let subkey = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{}", exe);
        for hkey in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            if let Ok(hk) = RegKey::predef(hkey).open_subkey(&subkey) {
                if let Ok(val) = hk.get_value::<String, _>("") {
                    let clean = val.trim_matches('"').to_string();
                    if Path::new(&clean).is_file() {
                        let stem = Path::new(&clean).file_stem().and_then(|s| s.to_str()).unwrap_or(&exe).to_string();
                        return Some((stem, clean));
                    }
                }
            }
        }
    }
    None
}

/// Enumerate candidate applications for opening the given file (internal synchronous helper).
pub fn get_open_with_apps_internal(path: &str) -> Vec<OpenWithApp> {
    let ext = if path.starts_with("archive://") {
        let (_, entry_path) = parse_archive_virtual_path(path).unwrap_or_default();
        Path::new(&entry_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase()
    } else {
        Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase()
    };

    let mut apps: Vec<OpenWithApp> = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    let mut add_app = |name: &str, app_path: &str| {
        let clean_path = app_path.trim_matches('"').to_string();
        if !clean_path.is_empty() && !seen_paths.contains(&clean_path.to_lowercase()) {
            seen_paths.insert(clean_path.to_lowercase());
            apps.push(OpenWithApp {
                name: name.to_string(),
                path: clean_path,
            });
        }
    };

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        // 1. Check registry OpenWithList for this extension
        if !ext.is_empty() {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let ext_key_path = format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{}\OpenWithList", ext);
            if let Ok(ext_key) = hkcu.open_subkey(&ext_key_path) {
                for (_name, val) in ext_key.enum_values().flatten() {
                    let val_str = val.to_string();
                    if val_str.to_lowercase().ends_with(".exe") {
                        if let Some((app_name, full_path)) = resolve_app_path(&val_str) {
                            add_app(&app_name, &full_path);
                        }
                    }
                }
            }
        }

        // 2. Curated standard apps by category if present
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".to_string());

        let is_text = matches!(ext.as_str(), "txt" | "md" | "log" | "json" | "xml" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "js" | "ts" | "jsx" | "tsx" | "py" | "rs" | "go" | "c" | "cpp" | "h" | "html" | "css" | "sh" | "bat" | "ps1" | "sql" | "env");
        let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "ico" | "svg");
        let is_media = matches!(ext.as_str(), "mp4" | "mkv" | "avi" | "mov" | "mp3" | "wav" | "flac" | "ogg" | "webm");
        let is_web_doc = matches!(ext.as_str(), "html" | "htm" | "pdf" | "svg" | "url");

        // Notepad
        let notepad_path = format!(r"{}\System32\notepad.exe", windir);
        if Path::new(&notepad_path).is_file() && (is_text || ext.is_empty()) {
            add_app("記事本 (Notepad)", &notepad_path);
        }

        // VS Code
        let vscode_user = format!(r"{}\Programs\Microsoft VS Code\Code.exe", local_app_data);
        let vscode_system = format!(r"{}\Microsoft VS Code\Code.exe", program_files);
        if Path::new(&vscode_user).is_file() {
            add_app("Visual Studio Code", &vscode_user);
        } else if Path::new(&vscode_system).is_file() {
            add_app("Visual Studio Code", &vscode_system);
        }

        // Notepad++
        let npp = format!(r"{}\Notepad++\notepad++.exe", program_files);
        let npp_x86 = format!(r"{}\Notepad++\notepad++.exe", program_files_x86);
        if Path::new(&npp).is_file() {
            add_app("Notepad++", &npp);
        } else if Path::new(&npp_x86).is_file() {
            add_app("Notepad++", &npp_x86);
        }

        // Paint (mspaint)
        let paint_path = format!(r"{}\System32\mspaint.exe", windir);
        if Path::new(&paint_path).is_file() && (is_image || ext.is_empty()) {
            add_app("小畫家 (Paint)", &paint_path);
        }

        // Edge
        let edge_path = format!(r"{}\Microsoft\Edge\Application\msedge.exe", program_files_x86);
        if Path::new(&edge_path).is_file() && (is_web_doc || is_text) {
            add_app("Microsoft Edge", &edge_path);
        }

        // Chrome
        let chrome_path = format!(r"{}\Google\Chrome\Application\chrome.exe", program_files);
        if Path::new(&chrome_path).is_file() && (is_web_doc || is_text) {
            add_app("Google Chrome", &chrome_path);
        }

        // VLC
        let vlc_path = format!(r"{}\VideoLAN\VLC\vlc.exe", program_files);
        if Path::new(&vlc_path).is_file() && is_media {
            add_app("VLC Media Player", &vlc_path);
        }

        // Windows Media Player
        let wmp_path = format!(r"{}\Windows Media Player\wmplayer.exe", program_files_x86);
        if Path::new(&wmp_path).is_file() && is_media {
            add_app("Windows Media Player", &wmp_path);
        }
    }

    apps
}

/// Enumerate candidate applications for opening the given file.
#[tauri::command]
pub async fn get_open_with_apps(path: String) -> Result<Vec<OpenWithApp>, String> {
    tokio_spawn_blocking(move || Ok(get_open_with_apps_internal(&path))).await
}

/// Comprehensive file/folder properties matching Windows native properties dialog.
#[tauri::command]
pub async fn get_file_properties(path: String) -> Result<FileProperties, String> {
    tokio_spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
        let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
        let is_dir = metadata.is_dir();
        let name = p.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let parent_dir = p.parent()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let size = if is_dir { 0 } else { metadata.len() };
        let created = metadata.created().ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let modified = metadata.modified().ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let accessed = metadata.accessed().ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);

        let is_readonly = metadata.permissions().readonly();
        let is_hidden = is_hidden_file(&name, Some(&metadata));

        let extension = if !is_dir {
            p.extension().map(|e| e.to_string_lossy().to_string())
        } else {
            None
        };

        let type_description = if is_dir {
            "檔案資料夾".to_string()
        } else if let Some(ref ext) = extension {
            let ext_upper = ext.to_uppercase();
            match ext.to_lowercase().as_str() {
                "txt" => "文字文件 (.txt)".to_string(),
                "png" => "PNG 影像 (.png)".to_string(),
                "jpg" | "jpeg" => "JPEG 影像 (.jpg)".to_string(),
                "gif" => "GIF 影像 (.gif)".to_string(),
                "webp" => "WebP 影像 (.webp)".to_string(),
                "pdf" => "PDF 文件 (.pdf)".to_string(),
                "zip" => "壓縮 (zipped) 資料夾 (.zip)".to_string(),
                "rar" => "WinRAR 壓縮檔 (.rar)".to_string(),
                "7z" => "7-Zip 壓縮檔 (.7z)".to_string(),
                "tar" | "gz" | "tgz" => "TAR 封存檔".to_string(),
                "exe" => "應用程式 (.exe)".to_string(),
                "mp4" => "MP4 視訊 (.mp4)".to_string(),
                "mkv" => "MKV 視訊 (.mkv)".to_string(),
                "mp3" => "MP3 音訊 (.mp3)".to_string(),
                "flac" => "FLAC 音訊 (.flac)".to_string(),
                "wav" => "WAV 音訊 (.wav)".to_string(),
                "json" => "JSON 檔案 (.json)".to_string(),
                "js" => "JavaScript 檔案 (.js)".to_string(),
                "ts" => "TypeScript 檔案 (.ts)".to_string(),
                "html" | "htm" => "HTML 文件 (.html)".to_string(),
                "css" => "CSS 階層式樣式表 (.css)".to_string(),
                "md" => "Markdown 文件 (.md)".to_string(),
                _ => format!("{} 檔案 (.{})", ext_upper, ext),
            }
        } else {
            "檔案".to_string()
        };

        let opens_with = if !is_dir {
            let apps = get_open_with_apps_internal(&path);
            apps.into_iter().next().map(|a| a.name)
        } else {
            None
        };

        Ok(FileProperties {
            name,
            path,
            parent_dir,
            is_dir,
            size,
            created,
            modified,
            accessed,
            is_readonly,
            is_hidden,
            extension,
            type_description,
            opens_with,
        })
    }).await
}

/// Recursive folder calculation (size, file count, folder count).
#[tauri::command]
pub async fn calc_folder_detail(path: String) -> Result<FolderDetail, String> {
    tokio_spawn_blocking(move || {
        let (size, file_count, folder_count) = calc_folder_detail_recursive(Path::new(&path), 0);
        Ok(FolderDetail {
            size,
            file_count,
            folder_count,
        })
    }).await
}

/// Update file attributes (readonly and/or hidden).
#[tauri::command]
pub async fn set_file_attributes(path: String, readonly: Option<bool>, hidden: Option<bool>) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let p = Path::new(&path);
        if let Some(ro) = readonly {
            if let Ok(metadata) = fs::metadata(p) {
                let mut perms = metadata.permissions();
                perms.set_readonly(ro);
                let _ = fs::set_permissions(p, perms);
            }
        }
        #[cfg(target_os = "windows")]
        if let Some(h) = hidden {
            use std::os::windows::ffi::OsStrExt;
            let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            unsafe {
                extern "system" {
                    fn GetFileAttributesW(lpFileName: *const u16) -> u32;
                    fn SetFileAttributesW(lpFileName: *const u16, dwFileAttributes: u32) -> i32;
                }
                const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
                const INVALID_FILE_ATTRIBUTES: u32 = 0xFFFFFFFF;
                let attrs = GetFileAttributesW(wide.as_ptr());
                if attrs != INVALID_FILE_ATTRIBUTES {
                    let new_attrs = if h {
                        attrs | FILE_ATTRIBUTE_HIDDEN
                    } else {
                        attrs & !FILE_ATTRIBUTE_HIDDEN
                    };
                    SetFileAttributesW(wide.as_ptr(), new_attrs);
                }
            }
        }
        Ok(())
    }).await
}

/// Open the specified file with a selected application executable.
#[tauri::command]
pub async fn open_file_with(path: String, app_path: String) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let target_path = if path.starts_with("archive://") {
            let (archive_path, entry_path) = parse_archive_virtual_path(&path)
                .ok_or_else(|| "Invalid archive path".to_string())?;
            let temp_file = extract_single_archive_entry_to_temp(&archive_path, &entry_path)?;
            temp_file.to_string_lossy().to_string()
        } else {
            path
        };

        std::process::Command::new(&app_path)
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("Failed to open with '{}': {}", app_path, e))?;

        Ok(())
    })
    .await
}

/// Display Windows native Open With dialog for the specified file.
#[tauri::command]
pub async fn show_open_with_dialog(path: String) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let target_path = if path.starts_with("archive://") {
            let (archive_path, entry_path) = parse_archive_virtual_path(&path)
                .ok_or_else(|| "Invalid archive path".to_string())?;
            let temp_file = extract_single_archive_entry_to_temp(&archive_path, &entry_path)?;
            temp_file.to_string_lossy().to_string()
        } else {
            path
        };

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("rundll32.exe")
                .args(["shell32.dll,OpenAs_RunDLL", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to run OpenAs_RunDLL: {}", e))?;
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            open::that(&target_path).map_err(|e| format!("Failed to open: {}", e))?;
            Ok(())
        }
    })
    .await
}

/// Native Windows file picker dialog to let user select an executable program (.exe).
#[tauri::command]
pub async fn pick_executable_file() -> Result<Option<String>, String> {
    tokio_spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            unsafe {
                extern "system" {
                    fn GetOpenFileNameW(lpofn: *mut OPENFILENAMEW) -> i32;
                }

                #[repr(C)]
                struct OPENFILENAMEW {
                    l_struct_size: u32,
                    hwnd_owner: isize,
                    h_instance: isize,
                    lpstr_filter: *const u16,
                    lpstr_custom_filter: *mut u16,
                    n_max_cust_filter: u32,
                    n_filter_index: u32,
                    lpstr_file: *mut u16,
                    n_max_file: u32,
                    lpstr_file_title: *mut u16,
                    n_max_file_title: u32,
                    lpstr_initial_dir: *const u16,
                    lpstr_title: *const u16,
                    flags: u32,
                    n_file_offset: u16,
                    n_file_extension: u16,
                    lpstr_def_ext: *const u16,
                    l_cust_data: isize,
                    lpfn_hook: isize,
                    lp_template_name: *const u16,
                    pv_reserved: isize,
                    dw_reserved: u32,
                    flags_ex: u32,
                }

                let mut file_buf = vec![0u16; 1024];
                let filter: Vec<u16> = "Programs (*.exe;*.cmd;*.bat)\0*.exe;*.cmd;*.bat\0All Files (*.*)\0*.*\0\0"
                    .encode_utf16()
                    .collect();
                let title: Vec<u16> = "選擇要開啟此檔案的應用程式\0".encode_utf16().collect();

                let mut ofn: OPENFILENAMEW = std::mem::zeroed();
                ofn.l_struct_size = std::mem::size_of::<OPENFILENAMEW>() as u32;
                ofn.lpstr_filter = filter.as_ptr();
                ofn.lpstr_file = file_buf.as_mut_ptr();
                ofn.n_max_file = file_buf.len() as u32;
                ofn.lpstr_title = title.as_ptr();
                ofn.flags = 0x00000800 | 0x00001000 | 0x00000004;

                if GetOpenFileNameW(&mut ofn) != 0 {
                    let len = file_buf.iter().position(|&c| c == 0).unwrap_or(file_buf.len());
                    let path = String::from_utf16_lossy(&file_buf[..len]);
                    return Ok(Some(path));
                }
                Ok(None)
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(None)
        }
    })
    .await
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

/// Restore paths from the system recycle bin.
/// If `paths` is provided, matches against `original_path()`.
/// If `paths` is empty, restores the most recently deleted item.
#[tauri::command]
pub async fn restore_from_trash(paths: Vec<String>) -> Result<usize, String> {
    tokio_spawn_blocking(move || {
        let items = trash::os_limited::list().map_err(|e| format!("Failed to list recycle bin: {}", e))?;
        
        let to_restore: Vec<_> = if paths.is_empty() {
            // Pick the item with the latest time_deleted
            if let Some(latest) = items.into_iter().max_by_key(|it| it.time_deleted) {
                vec![latest]
            } else {
                return Err("Recycle bin is empty".into());
            }
        } else {
            let path_set: std::collections::HashSet<std::path::PathBuf> = paths
                .iter()
                .map(|p| std::path::PathBuf::from(p))
                .collect();
            items
                .into_iter()
                .filter(|item| path_set.contains(&item.original_path()))
                .collect()
        };

        let count = to_restore.len();
        if count == 0 {
            return Err("No matching items found in recycle bin".into());
        }

        trash::os_limited::restore_all(to_restore).map_err(|e| format!("Failed to restore from recycle bin: {}", e))?;
        Ok(count)
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
        let buffer = if path.starts_with("archive://") {
            let (archive_path, entry_path) = parse_archive_virtual_path(&path)
                .ok_or_else(|| "Invalid archive path".to_string())?;
            read_archive_entry_bytes(&archive_path, &entry_path)?
        } else {
            let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
            let metadata = file
                .metadata()
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            if metadata.len() > 20 * 1024 * 1024 {
                return Err("File too large for preview (>20MB)".into());
            }
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            buf
        };
        Ok(base64_encode(&buffer))
    })
    .await
}

/// Generate a downsampled, lightweight thumbnail (max 128x128 or requested size) as JPEG base64.
/// Reduces memory and bandwidth by 99.9% compared to full-resolution image reading.
#[tauri::command]
pub async fn get_thumbnail_base64(path: String, max_size: Option<u32>) -> Result<String, String> {
    tokio_spawn_blocking(move || {
        let size = max_size.unwrap_or(128).clamp(32, 800);
        
        let img = if path.starts_with("archive://") {
            let (archive_path, entry_path) = parse_archive_virtual_path(&path)
                .ok_or_else(|| "Invalid archive path".to_string())?;
            let bytes = read_archive_entry_bytes(&archive_path, &entry_path)?;
            image::load_from_memory(&bytes).map_err(|e| format!("Failed to decode image from archive: {}", e))?
        } else {
            let path_obj = Path::new(&path);
            if !path_obj.exists() {
                return Err("File does not exist".into());
            }
            image::open(path_obj).map_err(|e| format!("Failed to open image: {}", e))?
        };

        let thumb = img.thumbnail(size, size);
        let mut buffer = std::io::Cursor::new(Vec::with_capacity(8192));
        
        thumb
            .write_to(&mut buffer, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

        Ok(base64_encode(buffer.get_ref()))
    })
    .await
}

/// Request Windows OS to trim process working set memory.
#[tauri::command]
pub fn trim_memory() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            extern "system" {
                fn GetCurrentProcess() -> isize;
                fn SetProcessWorkingSetSize(
                    hProcess: isize,
                    dwMinimumWorkingSetSize: usize,
                    dwMaximumWorkingSetSize: usize,
                ) -> i32;
            }
            SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
        }
    }
    Ok(())
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
        let mut buf = if path.starts_with("archive://") {
            let (archive_path, entry_path) = parse_archive_virtual_path(&path)
                .ok_or_else(|| "Invalid archive path".to_string())?;
            read_archive_entry_bytes(&archive_path, &entry_path)?
        } else {
            let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
            let mut b = vec![0u8; CAP];
            let n = file
                .read(&mut b)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            b.truncate(n);
            b
        };
        if buf.len() > CAP {
            buf.truncate(CAP);
        }
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

fn calc_folder_detail_recursive(dir: &Path, depth: usize) -> (u64, u64, u64) {
    if depth > 64 {
        return (0, 0, 0);
    }
    let mut total: u64 = 0;
    let mut files: u64 = 0;
    let mut folders: u64 = 0;
    if let Ok(read_dir) = fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                folders += 1;
                let (sub_size, sub_files, sub_folders) = calc_folder_detail_recursive(&entry.path(), depth + 1);
                total = total.saturating_add(sub_size);
                files = files.saturating_add(sub_files);
                folders = folders.saturating_add(sub_folders);
            } else {
                files += 1;
                if let Ok(m) = entry.metadata() {
                    total = total.saturating_add(m.len());
                }
            }
        }
    }
    (total, files, folders)
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

/// Extract specific entry paths from an archive into a destination directory.
#[tauri::command]
pub async fn extract_archive_entries(
    archive_path: String,
    entries: Vec<String>,
    destination: String,
) -> Result<Vec<String>, String> {
    tokio_spawn_blocking(move || {
        let dest = Path::new(&destination);
        if !dest.exists() {
            fs::create_dir_all(dest).map_err(|e| format!("Failed to create destination folder: {}", e))?;
        }

        let path_lower = archive_path.to_lowercase();
        let mut extracted_paths = Vec::new();

        if path_lower.ends_with(".zip") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;

            for target_entry in &entries {
                let clean_entry = target_entry.replace('\\', "/").trim_matches('/').to_string();
                let is_dir_target = target_entry.ends_with('/') || target_entry.ends_with('\\');

                for i in 0..archive.len() {
                    let mut item = match archive.by_index(i) {
                        Ok(item) => item,
                        Err(_) => continue,
                    };
                    let name = item.name().replace('\\', "/");
                    let clean_name = name.trim_matches('/').to_string();

                    let should_extract = if is_dir_target {
                        clean_name == clean_entry || clean_name.starts_with(&format!("{}/", clean_entry))
                    } else {
                        clean_name == clean_entry
                    };

                    if should_extract {
                        let rel_name = if clean_name.starts_with(&clean_entry) && clean_name != clean_entry {
                            clean_name[clean_entry.len()..].trim_matches('/').to_string()
                        } else {
                            clean_entry.split('/').last().unwrap_or(&clean_entry).to_string()
                        };

                        let folder_base = clean_entry.split('/').last().unwrap_or(&clean_entry);
                        let out_path = if is_dir_target {
                            if clean_name == clean_entry {
                                dest.join(folder_base)
                            } else {
                                dest.join(folder_base).join(&rel_name)
                            }
                        } else {
                            dest.join(folder_base)
                        };

                        if item.is_dir() {
                            fs::create_dir_all(&out_path).ok();
                        } else {
                            if let Some(p) = out_path.parent() {
                                fs::create_dir_all(p).ok();
                            }
                            let mut outfile = fs::File::create(&out_path)
                                .map_err(|e| format!("Failed to create output file: {}", e))?;
                            std::io::copy(&mut item, &mut outfile)
                                .map_err(|e| format!("Failed to write extracted file: {}", e))?;
                            extracted_paths.push(out_path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        } else if path_lower.ends_with(".tgz") || path_lower.ends_with(".tar.gz") || path_lower.ends_with(".json.tgz") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open TGZ: {}", e))?;
            let gz = flate2::read::GzDecoder::new(file);
            let mut archive = tar::Archive::new(gz);
            if let Ok(mut tar_entries) = archive.entries() {
                while let Some(Ok(mut entry)) = tar_entries.next() {
                    let path_buf = match entry.path() {
                        Ok(p) => p.to_string_lossy().replace('\\', "/"),
                        Err(_) => continue,
                    };
                    let clean_name = path_buf.trim_matches('/').to_string();
                    for target_entry in &entries {
                        let clean_entry = target_entry.replace('\\', "/").trim_matches('/').to_string();
                        if clean_name == clean_entry || clean_name.starts_with(&format!("{}/", clean_entry)) {
                            let file_name = clean_name.split('/').last().unwrap_or(&clean_name);
                            let out_path = dest.join(file_name);
                            entry.unpack(&out_path).ok();
                            extracted_paths.push(out_path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        } else if path_lower.ends_with(".tar") {
            let file = fs::File::open(&archive_path).map_err(|e| format!("Failed to open TAR: {}", e))?;
            let mut archive = tar::Archive::new(file);
            if let Ok(mut tar_entries) = archive.entries() {
                while let Some(Ok(mut entry)) = tar_entries.next() {
                    let path_buf = match entry.path() {
                        Ok(p) => p.to_string_lossy().replace('\\', "/"),
                        Err(_) => continue,
                    };
                    let clean_name = path_buf.trim_matches('/').to_string();
                    for target_entry in &entries {
                        let clean_entry = target_entry.replace('\\', "/").trim_matches('/').to_string();
                        if clean_name == clean_entry || clean_name.starts_with(&format!("{}/", clean_entry)) {
                            let file_name = clean_name.split('/').last().unwrap_or(&clean_name);
                            let out_path = dest.join(file_name);
                            entry.unpack(&out_path).ok();
                            extracted_paths.push(out_path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        Ok(extracted_paths)
    })
    .await
}

/// Set files on the Windows OS clipboard in CF_HDROP format so user can paste to Desktop/Explorer.
#[tauri::command]
pub async fn set_clipboard_files(paths: Vec<String>, is_cut: bool) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let mut physical_paths = Vec::new();
        for p in paths {
            if p.starts_with("archive://") {
                if let Some((arch, entry)) = parse_archive_virtual_path(&p) {
                    if let Ok(extracted) = extract_single_archive_entry_to_temp(&arch, &entry) {
                        physical_paths.push(extracted.to_string_lossy().to_string());
                    }
                }
            } else {
                physical_paths.push(p);
            }
        }

        if physical_paths.is_empty() {
            return Ok(());
        }

        #[cfg(target_os = "windows")]
        {
            unsafe {
                extern "system" {
                    fn OpenClipboard(hWndNewOwner: isize) -> i32;
                    fn CloseClipboard() -> i32;
                    fn EmptyClipboard() -> i32;
                    fn SetClipboardData(uFormat: u32, hMem: isize) -> isize;
                    fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> isize;
                    fn GlobalLock(hMem: isize) -> *mut u8;
                    fn GlobalUnlock(hMem: isize) -> i32;
                    fn RegisterClipboardFormatW(lpszFormat: *const u16) -> u32;
                }

                const CF_HDROP: u32 = 15;
                const GMEM_MOVEABLE: u32 = 0x0002;
                const GMEM_ZEROINIT: u32 = 0x0040;

                #[repr(C)]
                struct DROPFILES {
                    p_files: u32,
                    pt_x: i32,
                    pt_y: i32,
                    f_nc: i32,
                    f_wide: i32,
                }

                let mut wide_chars: Vec<u16> = Vec::new();
                for path_str in &physical_paths {
                    wide_chars.extend(path_str.encode_utf16());
                    wide_chars.push(0);
                }
                wide_chars.push(0); // Double null termination

                let dropfiles_size = std::mem::size_of::<DROPFILES>();
                let total_bytes = dropfiles_size + (wide_chars.len() * 2);

                let h_global = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes);
                if h_global == 0 {
                    return Err("Failed to allocate global memory for clipboard".into());
                }

                let ptr = GlobalLock(h_global);
                if ptr.is_null() {
                    return Err("Failed to lock global memory".into());
                }

                let dropfiles = ptr as *mut DROPFILES;
                (*dropfiles).p_files = dropfiles_size as u32;
                (*dropfiles).f_wide = 1;

                let data_ptr = ptr.add(dropfiles_size) as *mut u16;
                std::ptr::copy_nonoverlapping(wide_chars.as_ptr(), data_ptr, wide_chars.len());

                GlobalUnlock(h_global);

                if OpenClipboard(0) == 0 {
                    return Err("Failed to open clipboard".into());
                }
                EmptyClipboard();
                SetClipboardData(CF_HDROP, h_global);

                // Set Preferred DropEffect (1 = Copy, 2 = Move)
                let effect_name: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
                let cf_effect = RegisterClipboardFormatW(effect_name.as_ptr());
                if cf_effect != 0 {
                    let h_effect = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 4);
                    if h_effect != 0 {
                        let e_ptr = GlobalLock(h_effect) as *mut u32;
                        if !e_ptr.is_null() {
                            *e_ptr = if is_cut { 2 } else { 1 };
                            GlobalUnlock(h_effect);
                            SetClipboardData(cf_effect, h_effect);
                        }
                    }
                }

                CloseClipboard();
            }
        }

        Ok(())
    })
    .await
}

/// Initiate native OS Drag & Drop to external applications or Windows Desktop.
#[tauri::command]
pub async fn start_native_drag(paths: Vec<String>, window: tauri::Window) -> Result<(), String> {
    tokio_spawn_blocking(move || {
        let mut physical_paths: Vec<PathBuf> = Vec::new();
        for p in paths {
            if p.starts_with("archive://") {
                if let Some((arch, entry)) = parse_archive_virtual_path(&p) {
                    if let Ok(extracted) = extract_single_archive_entry_to_temp(&arch, &entry) {
                        physical_paths.push(extracted);
                    }
                }
            } else {
                let pb = PathBuf::from(&p);
                if pb.exists() {
                    physical_paths.push(pb);
                }
            }
        }

        if physical_paths.is_empty() {
            return Ok(());
        }

        let item = drag::DragItem::Files(physical_paths);
        let _ = drag::start_drag(&window, item, drag::Image::Raw(vec![]), |_result, _pos| {}, drag::Options::default());
        Ok(())
    })
    .await
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

// ─── Default File Manager & Launch Args ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    pub folder_path: String,
    pub select_file: Option<String>,
}

pub fn parse_target_from_args(args: &[String]) -> Option<LaunchArgs> {
    for arg in args.iter().skip(1) {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            continue;
        }

        // 1. Explorer /select,"C:\path\to\file.ext" syntax
        if let Some(rest) = trimmed.strip_prefix("/select,") {
            let clean_path = rest.trim_matches('"').trim();
            let p = Path::new(clean_path);
            if p.is_file() {
                if let Some(parent) = p.parent() {
                    return Some(LaunchArgs {
                        folder_path: parent.to_string_lossy().to_string(),
                        select_file: Some(clean_path.to_string()),
                    });
                }
            } else if p.is_dir() {
                return Some(LaunchArgs {
                    folder_path: clean_path.to_string(),
                    select_file: None,
                });
            }
        }

        // 2. Standard path argument e.g. "C:\Users\Downloads" or "D:\"
        let clean_path = trimmed.trim_matches('"').trim();
        let p = Path::new(clean_path);
        if p.exists() {
            if p.is_dir() {
                return Some(LaunchArgs {
                    folder_path: clean_path.to_string(),
                    select_file: None,
                });
            } else if p.is_file() {
                if let Some(parent) = p.parent() {
                    return Some(LaunchArgs {
                        folder_path: parent.to_string_lossy().to_string(),
                        select_file: Some(clean_path.to_string()),
                    });
                }
            }
        }
    }
    None
}

/// Retrieve initial launch path if passed via CLI arguments
#[tauri::command]
pub fn get_launch_args() -> Option<LaunchArgs> {
    let args: Vec<String> = std::env::args().collect();
    parse_target_from_args(&args)
}

/// Check if Nexus Files is registered as the default folder handler in HKCU
#[tauri::command]
pub fn check_is_default_file_manager() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(cmd_key) = hkcu.open_subkey(r"Software\Classes\Directory\shell\open\command") {
            if let Ok(val) = cmd_key.get_value::<String, _>("") {
                if let Ok(exe) = std::env::current_exe() {
                    let exe_name = exe.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    if val.to_lowercase().contains(&exe_name) {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// Register Nexus Files as default file manager in HKCU (per-user, no admin prompt needed)
#[tauri::command]
pub fn set_as_default_file_manager() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Cannot determine current executable path: {}", e))?;
        let exe_path = current_exe.to_string_lossy();
        let cmd_value = format!("\"{}\" \"%1\"", exe_path);

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // 1. Directory
        let (dir_key, _) = hkcu.create_subkey(r"Software\Classes\Directory\shell\open\command")
            .map_err(|e| format!("Failed to create Directory registry key: {}", e))?;
        dir_key.set_value("", &cmd_value)
            .map_err(|e| format!("Failed to set Directory command: {}", e))?;

        // 2. Drive
        let (drive_key, _) = hkcu.create_subkey(r"Software\Classes\Drive\shell\open\command")
            .map_err(|e| format!("Failed to create Drive registry key: {}", e))?;
        drive_key.set_value("", &cmd_value)
            .map_err(|e| format!("Failed to set Drive command: {}", e))?;

        // 3. Folder
        let (folder_key, _) = hkcu.create_subkey(r"Software\Classes\Folder\shell\open\command")
            .map_err(|e| format!("Failed to create Folder registry key: {}", e))?;
        folder_key.set_value("", &cmd_value)
            .map_err(|e| format!("Failed to set Folder command: {}", e))?;

        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Setting as default file manager is only supported on Windows".into())
    }
}

/// Restore native Windows Explorer as default file manager
#[tauri::command]
pub fn restore_default_file_manager() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let _ = hkcu.delete_subkey_all(r"Software\Classes\Directory\shell\open\command");
        let _ = hkcu.delete_subkey_all(r"Software\Classes\Directory\shell\open");
        let _ = hkcu.delete_subkey_all(r"Software\Classes\Drive\shell\open\command");
        let _ = hkcu.delete_subkey_all(r"Software\Classes\Drive\shell\open");
        let _ = hkcu.delete_subkey_all(r"Software\Classes\Folder\shell\open\command");
        let _ = hkcu.delete_subkey_all(r"Software\Classes\Folder\shell\open");

        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Default file manager setting is only supported on Windows".into())
    }
}




