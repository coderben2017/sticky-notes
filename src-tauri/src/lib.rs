mod commands;
mod models;
mod platform;
mod repository;
mod tray;
mod windows;

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use repository::NoteRepository;
use tauri::{Manager, RunEvent};
use windows::WindowRegistry;

pub struct AppState {
    pub repository: Mutex<NoteRepository>,
    pub windows: Mutex<WindowRegistry>,
    pub quit_pending: Mutex<HashSet<String>>,
    pub quitting: AtomicBool,
    pub exiting: AtomicBool,
}

impl AppState {
    fn new(repository: NoteRepository) -> Self {
        Self {
            repository: Mutex::new(repository),
            windows: Mutex::new(WindowRegistry::default()),
            quit_pending: Mutex::new(HashSet::new()),
            quitting: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::save_content,
            commands::rename_note,
            commands::create_note,
            commands::toggle_pin,
            commands::set_todo_mode,
            commands::hide_window,
            commands::delete_note,
            commands::add_todo,
            commands::update_todo,
            commands::delete_todo,
            commands::complete_todo,
            commands::restore_todo,
            commands::delete_archived_todo,
            commands::clear_archive,
            commands::set_window_dragging,
            commands::set_window_resizing,
            commands::set_dock_hovered,
            commands::confirm_flush,
        ])
        .setup(|app| {
            let channel = if cfg!(debug_assertions) { "dev" } else { "stable" };
            let data_path = app
                .path()
                .app_local_data_dir()?
                .join(channel)
                .join("notes.json");
            let repository = NoteRepository::load(data_path, &legacy_content_paths())
                .map_err(std::io::Error::other)?;
            app.manage(AppState::new(repository));

            tray::create(app.handle()).map_err(std::io::Error::other)?;
            windows::open_all(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 Sticky Notes 失败");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let exiting = app
                .try_state::<AppState>()
                .map(|state| state.exiting.load(Ordering::SeqCst))
                .unwrap_or(true);
            if !exiting {
                api.prevent_exit();
            }
        }
    });
}

fn legacy_content_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            paths.push(directory.join("note.txt"));
        }
    }
    if let Ok(directory) = std::env::current_dir() {
        paths.push(directory.join("note.txt"));
        paths.push(directory.join("build").join("bin").join("note.txt"));
    }
    paths
}
