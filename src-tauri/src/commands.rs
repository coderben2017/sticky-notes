use std::{thread, time::Duration};

use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    models::{CreatedNote, NoteSnapshot},
    tray, windows, AppState,
};

#[tauri::command]
pub fn bootstrap(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    let repository = state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?;
    let note = repository.get(&note_id)?;
    windows::sync_native_window(&window, &note.title, note.pinned)?;
    Ok(note)
}

#[tauri::command]
pub fn save_content(
    window: WebviewWindow,
    state: State<'_, AppState>,
    content: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .save_content(&note_id, content)
}

#[tauri::command]
pub fn rename_note(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    title: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    let note = state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .rename(&note_id, title)?;
    windows::sync_native_window(&window, &note.title, note.pinned)?;
    tray::refresh(&app)?;
    Ok(note)
}

#[tauri::command]
pub fn create_note(app: AppHandle, state: State<'_, AppState>) -> Result<CreatedNote, String> {
    let note = state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .create()?;
    eprintln!("[sticky-notes-debug] create_note: 数据已创建 {}", note.id);
    let note_id = note.id.clone();
    let deferred_app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        eprintln!("[sticky-notes-debug] create_note: 准备调度窗口 {note_id}");
        let task_app = deferred_app.clone();
        if let Err(error) = deferred_app.run_on_main_thread(move || {
            eprintln!("[sticky-notes-debug] create_note: 开始创建窗口 {note_id}");
            if let Err(error) = windows::open_note(&task_app, &note_id) {
                eprintln!("[sticky-notes-debug] create_note: 创建窗口失败 {error}");
            }
            if let Err(error) = tray::refresh(&task_app) {
                eprintln!("[sticky-notes-debug] create_note: 更新托盘失败 {error}");
            }
            eprintln!("[sticky-notes-debug] create_note: 窗口任务结束 {note_id}");
        }) {
            eprintln!("[sticky-notes-debug] create_note: 调度窗口失败 {error}");
        }
    });
    Ok(CreatedNote { id: note.id })
}

#[tauri::command]
pub fn toggle_pin(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    let note = state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .toggle_pin(&note_id)?;
    windows::sync_native_window(&window, &note.title, note.pinned)?;
    tray::refresh(&app)?;
    Ok(note)
}

#[tauri::command]
pub fn set_todo_mode(
    window: WebviewWindow,
    state: State<'_, AppState>,
    enabled: bool,
    copy_content: bool,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .set_todo_mode(&note_id, enabled, copy_content)
}

#[tauri::command]
pub fn hide_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let note_id = windows::note_id_for_window(&window)?;
    windows::hide_note(&app, &note_id, &window)
}

#[tauri::command]
pub fn delete_note(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .remove(&note_id)?;
    tray::refresh(&app)?;
    windows::close_deleted_note(&app, &note_id, &window)
}

#[tauri::command]
pub fn add_todo(
    window: WebviewWindow,
    state: State<'_, AppState>,
    text: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .add_todo(&note_id, text)
}

#[tauri::command]
pub fn update_todo(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .update_todo(&note_id, &id, text)
}

#[tauri::command]
pub fn delete_todo(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .delete_todo(&note_id, &id)
}

#[tauri::command]
pub fn complete_todo(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .complete_todo(&note_id, &id)
}

#[tauri::command]
pub fn restore_todo(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .restore_todo(&note_id, &id)
}

#[tauri::command]
pub fn delete_archived_todo(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .delete_archived_todo(&note_id, &id)
}

#[tauri::command]
pub fn clear_archive(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<NoteSnapshot, String> {
    let note_id = windows::note_id_for_window(&window)?;
    state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .clear_archive(&note_id)
}

#[tauri::command]
pub fn set_window_dragging(
    app: AppHandle,
    window: WebviewWindow,
    dragging: bool,
) -> Result<(), String> {
    let note_id = windows::note_id_for_window(&window)?;
    windows::set_window_dragging(&app, &note_id, &window, dragging)
}

#[tauri::command]
pub fn set_window_resizing(
    app: AppHandle,
    window: WebviewWindow,
    resizing: bool,
) -> Result<(), String> {
    let note_id = windows::note_id_for_window(&window)?;
    windows::set_window_resizing(&app, &note_id, &window, resizing)
}

#[tauri::command]
pub fn set_dock_hovered(
    app: AppHandle,
    window: WebviewWindow,
    hovered: bool,
) -> Result<(), String> {
    let note_id = windows::note_id_for_window(&window)?;
    windows::set_dock_hovered(&app, &note_id, &window, hovered)
}

#[tauri::command]
pub fn confirm_flush(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    windows::confirm_flush(&app, &window)
}
