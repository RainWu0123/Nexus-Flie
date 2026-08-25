mod commands;

use commands::filesystem;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            filesystem::read_directory,
            filesystem::get_home_dir,
            filesystem::get_drives,
            filesystem::get_known_folders,
            filesystem::open_file,
            filesystem::delete_path,
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
            filesystem::reveal_in_explorer,
            filesystem::empty_recycle_bin,
            filesystem::read_text_preview,
            filesystem::watch_directory,
            filesystem::unwatch_directory,
            filesystem::read_zip_directory,
            filesystem::extract_zip,
            filesystem::read_archive_directory,
            filesystem::extract_archive,
            filesystem::app_minimize,
            filesystem::app_toggle_maximize,
            filesystem::app_close,
            filesystem::app_is_maximized,
            filesystem::execute_address_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
