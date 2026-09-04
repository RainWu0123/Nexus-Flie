mod commands;

use commands::filesystem;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(target) = filesystem::parse_target_from_args(&argv) {
                    let _ = window.emit("single-instance-launch", target);
                }
            }
        }))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            filesystem::read_directory,
            filesystem::get_home_dir,
            filesystem::get_drives,
            filesystem::get_known_folders,
            filesystem::open_file,
            filesystem::get_open_with_apps,
            filesystem::open_file_with,
            filesystem::show_open_with_dialog,
            filesystem::pick_executable_file,
            filesystem::get_file_properties,
            filesystem::calc_folder_detail,
            filesystem::set_file_attributes,
            filesystem::delete_path,
            filesystem::restore_from_trash,
            filesystem::rename_path,
            filesystem::move_path,
            filesystem::copy_path,
            filesystem::create_folder,
            filesystem::create_file,
            filesystem::read_file_base64,
            filesystem::stat_paths,
            filesystem::log_error,
            filesystem::calc_folder_size,
            filesystem::open_terminal,
            filesystem::open_terminal_as_admin,
            filesystem::open_file_as_admin,
            filesystem::reveal_in_explorer,
            filesystem::empty_recycle_bin,
            filesystem::read_text_preview,
            filesystem::watch_directory,
            filesystem::unwatch_directory,
            filesystem::read_zip_directory,
            filesystem::extract_zip,
            filesystem::read_archive_directory,
            filesystem::extract_archive,
            filesystem::extract_archive_entries,
            filesystem::set_clipboard_files,
            filesystem::start_native_drag,
            filesystem::app_minimize,
            filesystem::app_toggle_maximize,
            filesystem::app_close,
            filesystem::app_is_maximized,
            filesystem::execute_address_command,
            filesystem::get_launch_args,
            filesystem::get_thumbnail_base64,
            filesystem::trim_memory,
            filesystem::check_is_default_file_manager,
            filesystem::set_as_default_file_manager,
            filesystem::restore_default_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
