use std::{
    collections::{HashMap, HashSet},
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::{
    models::{DockEdge, WindowFrame},
    platform,
    AppState,
};

const NOTE_WIDTH: u32 = 327;
const NOTE_HEIGHT: u32 = 525;
const MIN_NOTE_WIDTH: u32 = 180;
const MIN_NOTE_HEIGHT: u32 = 240;
const MIN_VISIBLE_SIZE: u32 = 48;
const DOCK_SNAP_DISTANCE: i32 = 16;
const DOCK_REVEAL_SIZE: i32 = 8;
const DOCK_CURSOR_TOLERANCE: f64 = 4.0;
const DOCK_COLLAPSE_DELAY: Duration = Duration::from_millis(80);
const DOCK_HOVER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const DOCK_ANIMATION_DURATION: Duration = Duration::from_millis(180);
const FRAME_ANIMATION_INTERVAL: Duration = Duration::from_millis(16);
const DRAG_SETTLE_DELAY: Duration = Duration::from_millis(40);
const FRAME_SETTLE_DELAY: Duration = Duration::from_millis(250);
const QUIT_FLUSH_TIMEOUT: Duration = Duration::from_secs(2);
const WINDOW_LABEL_PREFIX: &str = "note-";

#[derive(Clone, Copy)]
struct DockPlacement {
    edge: DockEdge,
    area: WindowFrame,
    expanded_frame: WindowFrame,
}

#[derive(Clone, Copy)]
struct DockState {
    edge: DockEdge,
    area: WindowFrame,
    expanded_frame: WindowFrame,
    collapsed_frame: WindowFrame,
    expanded: bool,
}

#[derive(Default)]
struct WindowRuntime {
    dock: Option<DockState>,
    dragging: bool,
    resizing: bool,
    hovered: bool,
    hover_tracking: bool,
    suppress_settle: bool,
    animating: bool,
    animation_revision: u64,
    settle_revision: u64,
}

#[derive(Default)]
pub struct WindowRegistry {
    notes: HashMap<String, WindowRuntime>,
    closing: HashSet<String>,
    active_note_id: Option<String>,
    cascade_index: u32,
}

pub fn open_all(app: &AppHandle) -> Result<(), String> {
    let note_ids = {
        let state = app.state::<AppState>();
        let repository = state
            .repository
            .lock()
            .map_err(|_| "便签数据锁已损坏".to_string())?;
        repository
            .list()
            .into_iter()
            .map(|note| note.id)
            .collect::<Vec<_>>()
    };

    for note_id in note_ids {
        open_note(app, &note_id)?;
    }
    Ok(())
}

pub fn open_note(app: &AppHandle, note_id: &str) -> Result<WebviewWindow, String> {
    eprintln!("[sticky-notes-debug] open_note: 进入 {note_id}");
    let label = note_label(note_id);
    if let Some(window) = app.get_webview_window(&label) {
        eprintln!("[sticky-notes-debug] open_note: 使用已有窗口 {note_id}");
        show_existing_note(app, note_id, &window)?;
        return Ok(window);
    }

    let (note, stored_frame, stored_dock) = {
        let state = app.state::<AppState>();
        let repository = state
            .repository
            .lock()
            .map_err(|_| "便签数据锁已损坏".to_string())?;
        (
            repository.get(note_id)?,
            repository.get_frame(note_id)?,
            repository.get_dock(note_id)?,
        )
    };

    eprintln!("[sticky-notes-debug] open_note: 开始构建窗口 {note_id}");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&note.title)
        .inner_size(NOTE_WIDTH as f64, NOTE_HEIGHT as f64)
        .min_inner_size(MIN_NOTE_WIDTH as f64, MIN_NOTE_HEIGHT as f64)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .skip_taskbar(true)
        .always_on_top(note.pinned)
        .visible(false)
        .build()
        .map_err(|error| format!("创建便签窗口失败: {error}"))?;
    eprintln!("[sticky-notes-debug] open_note: 窗口构建完成 {note_id}");

    let areas = platform::work_areas(&window);
    let expanded_frame = if stored_frame
        .is_some_and(|frame| is_usable_frame(frame, &areas))
    {
        stored_frame.unwrap_or(default_frame(&window, &areas, 0))
    } else {
        let cascade_index = next_cascade_index(app)?;
        default_frame(&window, &areas, cascade_index)
    };

    let mut initial_frame = expanded_frame;
    let mut dock_state = None;
    if let Some(edge) = stored_dock {
        if is_usable_frame(expanded_frame, &areas) {
            let area = get_frame_area(expanded_frame, &areas);
            let expanded_frame = align_frame_to_edge(expanded_frame, edge, area);
            set_window_frame(&window, expanded_frame)?;
            let dock = create_dock_state(
                DockPlacement {
                    edge,
                    area,
                    expanded_frame,
                },
                false,
                window_border_size(&window)?,
            );
            initial_frame = dock.collapsed_frame;
            dock_state = Some(dock);
            save_placement(app, note_id, dock.expanded_frame, Some(dock.edge))?;
        }
    }

    {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        registry.notes.insert(
            note_id.to_string(),
            WindowRuntime {
                dock: dock_state,
                suppress_settle: true,
                ..WindowRuntime::default()
            },
        );
        registry.active_note_id = Some(note_id.to_string());
    }

    set_window_frame(&window, initial_frame)?;
    attach_window_events(app, note_id, &window);
    eprintln!("[sticky-notes-debug] open_note: 窗口事件完成 {note_id}");

    {
        let state = app.state::<AppState>();
        if let Ok(mut registry) = state.windows.lock() {
            if let Some(runtime) = registry.notes.get_mut(note_id) {
                runtime.suppress_settle = false;
            }
        };
    }

    window
        .show()
        .map_err(|error| format!("显示便签窗口失败: {error}"))?;
    eprintln!("[sticky-notes-debug] open_note: 窗口显示完成 {note_id}");
    Ok(window)
}

pub fn show_note(app: &AppHandle, note_id: &str) -> Result<(), String> {
    let window = open_note(app, note_id)?;
    show_existing_note(app, note_id, &window)
}

pub fn show_all(app: &AppHandle) -> Result<(), String> {
    let note_ids = {
        let state = app.state::<AppState>();
        let repository = state
            .repository
            .lock()
            .map_err(|_| "便签数据锁已损坏".to_string())?;
        repository
            .list()
            .into_iter()
            .map(|note| note.id)
            .collect::<Vec<_>>()
    };

    for note_id in &note_ids {
        let window = open_note(app, note_id)?;
        expand_dock(app, note_id, &window);
        window
            .show()
            .map_err(|error| format!("显示便签窗口失败: {error}"))?;
    }

    let active_note_id = {
        let state = app.state::<AppState>();
        state
            .windows
            .lock()
            .ok()
            .and_then(|registry| registry.active_note_id.clone())
            .or_else(|| note_ids.first().cloned())
    };
    if let Some(note_id) = active_note_id {
        if let Some(window) = app.get_webview_window(&note_label(&note_id)) {
            let _ = window.set_focus();
        }
    }
    Ok(())
}

pub fn hide_all(app: &AppHandle) -> Result<(), String> {
    let note_ids = registry_note_ids(app)?;
    for note_id in note_ids {
        if let Some(window) = app.get_webview_window(&note_label(&note_id)) {
            persist_window_placement(app, &note_id, &window)?;
            window
                .hide()
                .map_err(|error| format!("隐藏便签窗口失败: {error}"))?;
        }
    }
    Ok(())
}

pub fn hide_note(app: &AppHandle, note_id: &str, window: &WebviewWindow) -> Result<(), String> {
    persist_window_placement(app, note_id, window)?;
    window
        .hide()
        .map_err(|error| format!("隐藏便签窗口失败: {error}"))
}

pub fn close_deleted_note(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        registry.closing.insert(note_id.to_string());
    }
    window
        .close()
        .map_err(|error| format!("关闭已删除便签失败: {error}"))
}

pub fn sync_native_window(window: &WebviewWindow, title: &str, pinned: bool) -> Result<(), String> {
    window
        .set_title(title)
        .map_err(|error| format!("更新窗口标题失败: {error}"))?;
    window
        .set_always_on_top(pinned)
        .map_err(|error| format!("更新窗口置顶状态失败: {error}"))
}

pub fn set_window_dragging(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
    dragging: bool,
) -> Result<(), String> {
    let expanded_frame = {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return Ok(());
        };
        runtime.dragging = dragging;
        if dragging {
            cancel_animation(runtime);
            runtime.hovered = false;
            runtime.hover_tracking = false;
            runtime.dock.as_mut().map(|dock| {
                dock.expanded = true;
                dock.expanded_frame
            })
        } else {
            None
        }
    };

    if let Some(frame) = expanded_frame {
        set_window_frame(window, frame)?;
    }
    if !dragging {
        schedule_settle(app, note_id, DRAG_SETTLE_DELAY);
    }
    Ok(())
}

pub fn set_window_resizing(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
    resizing: bool,
) -> Result<(), String> {
    let expanded_frame = {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return Ok(());
        };
        runtime.resizing = resizing;
        if resizing {
            cancel_animation(runtime);
            runtime.hovered = false;
            runtime.hover_tracking = false;
            runtime.dock.take().map(|dock| dock.expanded_frame)
        } else {
            None
        }
    };

    if let Some(frame) = expanded_frame {
        set_window_frame(window, frame)?;
        save_placement(app, note_id, frame, None)?;
    }
    if !resizing {
        schedule_settle(app, note_id, FRAME_SETTLE_DELAY);
    }
    Ok(())
}

pub fn set_dock_hovered(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
    hovered: bool,
) -> Result<(), String> {
    if !hovered {
        return Ok(());
    }

    let Ok(cursor_position) = app.cursor_position() else {
        return Ok(());
    };

    let should_track = {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return Ok(());
        };
        let cursor_is_over_trigger = runtime
            .dock
            .is_some_and(|dock| cursor_is_inside_frame(cursor_position, dock.collapsed_frame));
        if !cursor_is_over_trigger || runtime.hover_tracking {
            false
        } else {
            runtime.hovered = true;
            runtime.hover_tracking = true;
            true
        }
    };

    if !should_track {
        return Ok(());
    }
    expand_dock(app, note_id, window);
    track_dock_hover(app, note_id);
    Ok(())
}

pub fn begin_quit(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.quitting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let labels = registry_note_ids(app)?
        .into_iter()
        .filter_map(|note_id| {
            let label = note_label(&note_id);
            app.get_webview_window(&label).map(|_| label)
        })
        .collect::<HashSet<_>>();
    {
        let mut pending = state
            .quit_pending
            .lock()
            .map_err(|_| "退出状态锁已损坏".to_string())?;
        *pending = labels.clone();
    }

    if labels.is_empty() {
        finish_quit(app);
        return Ok(());
    }

    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit("flush-pending-changes", ());
        }
    }

    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(QUIT_FLUSH_TIMEOUT);
        finish_quit(&app);
    });
    Ok(())
}

pub fn confirm_flush(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let state = app.state::<AppState>();
    let should_exit = {
        let mut pending = state
            .quit_pending
            .lock()
            .map_err(|_| "退出状态锁已损坏".to_string())?;
        pending.remove(window.label());
        pending.is_empty()
    };
    if should_exit && state.quitting.load(Ordering::SeqCst) {
        finish_quit(app);
    }
    Ok(())
}

pub fn note_id_for_window(window: &WebviewWindow) -> Result<String, String> {
    window
        .label()
        .strip_prefix(WINDOW_LABEL_PREFIX)
        .map(str::to_string)
        .ok_or_else(|| "当前窗口不是便签窗口".to_string())
}

fn show_existing_note(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
) -> Result<(), String> {
    expand_dock(app, note_id, window);
    window
        .show()
        .map_err(|error| format!("显示便签窗口失败: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("激活便签窗口失败: {error}"))?;
    if let Ok(mut registry) = app.state::<AppState>().windows.lock() {
        registry.active_note_id = Some(note_id.to_string());
    }
    Ok(())
}

fn attach_window_events(app: &AppHandle, note_id: &str, window: &WebviewWindow) {
    let app = app.clone();
    let note_id = note_id.to_string();
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if let Ok(mut registry) = app.state::<AppState>().windows.lock() {
                registry.active_note_id = Some(note_id.clone());
            }
            schedule_settle(&app, &note_id, FRAME_SETTLE_DELAY);
        }
        WindowEvent::Focused(true) => {
            if let Ok(mut registry) = app.state::<AppState>().windows.lock() {
                registry.active_note_id = Some(note_id.clone());
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            let allow_close = app.state::<AppState>().quitting.load(Ordering::SeqCst)
                || app
                    .state::<AppState>()
                    .windows
                    .lock()
                    .map(|registry| registry.closing.contains(&note_id))
                    .unwrap_or(false);
            if allow_close {
                return;
            }

            api.prevent_close();
            let _ = persist_window_placement(&app, &note_id, &event_window);
            let _ = event_window.hide();
        }
        WindowEvent::Destroyed => {
            if let Ok(mut registry) = app.state::<AppState>().windows.lock() {
                registry.notes.remove(&note_id);
                registry.closing.remove(&note_id);
                if registry.active_note_id.as_deref() == Some(&note_id) {
                    registry.active_note_id = registry.notes.keys().next().cloned();
                }
            }
        }
        _ => {}
    });
}

fn next_cascade_index(app: &AppHandle) -> Result<u32, String> {
    let state = app.state::<AppState>();
    let mut registry = state
        .windows
        .lock()
        .map_err(|_| "窗口状态锁已损坏".to_string())?;
    let current = registry.cascade_index;
    registry.cascade_index = registry.cascade_index.wrapping_add(1);
    Ok(current)
}

fn default_frame(window: &WebviewWindow, areas: &[WindowFrame], cascade_index: u32) -> WindowFrame {
    let primary = platform::primary_work_area(window);
    let area = areas
        .iter()
        .find(|area| Some(**area) != primary)
        .copied()
        .or(primary)
        .or_else(|| areas.first().copied())
        .unwrap_or(WindowFrame {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        });
    let scale_factor = platform::scale_factor_for_frame(window, area);
    let right_margin = (50.0 * scale_factor).round() as i32;
    let offset = ((cascade_index % 8) as f64 * 24.0 * scale_factor).round() as i32;
    let width = (NOTE_WIDTH as f64 * scale_factor).round() as u32;
    let height = (NOTE_HEIGHT as f64 * scale_factor).round() as u32;
    fit_frame_to_area(
        WindowFrame {
            x: area.x + area.width as i32 - width as i32 - right_margin - offset,
            y: area.y + area.height.saturating_sub(height) as i32 / 2 + offset,
            width,
            height,
        },
        area,
    )
}

fn settle_window(app: &AppHandle, note_id: &str, revision: u64) -> Result<(), String> {
    let window = match app.get_webview_window(&note_label(note_id)) {
        Some(window) => window,
        None => return Ok(()),
    };
    let dock = {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return Ok(());
        };
        if runtime.settle_revision != revision
            || runtime.dragging
            || runtime.resizing
            || runtime.suppress_settle
            || runtime.animating
        {
            return Ok(());
        }
        runtime.dock
    };

    let mut frame = window_frame(&window)?;
    if let Some(dock) = dock {
        if frames_match(frame, dock.expanded_frame) || frames_match(frame, dock.collapsed_frame) {
            return save_placement(app, note_id, dock.expanded_frame, Some(dock.edge));
        }
        clear_dock(app, note_id)?;
    }

    let areas = platform::work_areas(&window);
    let snapped_frame = snap_frame_to_outer_edges(frame, &areas);
    if !frames_match(frame, snapped_frame) {
        frame = snapped_frame;
        set_window_frame(&window, frame)?;
    }

    let Some(placement) = get_dock_placement(frame, &areas) else {
        return save_placement(app, note_id, frame, None);
    };
    let dock = create_dock_state(placement, true, window_border_size(&window)?);
    {
        let state = app.state::<AppState>();
        let mut registry = state
            .windows
            .lock()
            .map_err(|_| "窗口状态锁已损坏".to_string())?;
        if let Some(runtime) = registry.notes.get_mut(note_id) {
            runtime.dock = Some(dock);
        }
    }
    save_placement(app, note_id, dock.expanded_frame, Some(dock.edge))?;
    set_dock_frame(app, note_id, &window, false);
    Ok(())
}

fn schedule_settle(app: &AppHandle, note_id: &str, delay: Duration) {
    let revision = {
        let state = app.state::<AppState>();
        let Ok(mut registry) = state.windows.lock() else {
            return;
        };
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return;
        };
        runtime.settle_revision = runtime.settle_revision.wrapping_add(1);
        runtime.settle_revision
    };
    let app = app.clone();
    let note_id = note_id.to_string();
    thread::spawn(move || {
        thread::sleep(delay);
        let _ = settle_window(&app, &note_id, revision);
    });
}

fn track_dock_hover(app: &AppHandle, note_id: &str) {
    let app = app.clone();
    let note_id = note_id.to_string();
    thread::spawn(move || {
        let mut outside_since = None;
        loop {
            thread::sleep(DOCK_HOVER_POLL_INTERVAL);
            let (expanded_frame, paused) = {
                let state = app.state::<AppState>();
                let Ok(mut registry) = state.windows.lock() else {
                    return;
                };
                let Some(runtime) = registry.notes.get_mut(&note_id) else {
                    return;
                };
                if !runtime.hover_tracking {
                    return;
                }
                let Some(dock) = runtime.dock else {
                    runtime.hovered = false;
                    runtime.hover_tracking = false;
                    return;
                };
                (dock.expanded_frame, runtime.dragging || runtime.resizing)
            };

            if paused {
                outside_since = None;
                continue;
            }

            let Ok(position) = app.cursor_position() else {
                continue;
            };
            if cursor_is_inside_frame(position, expanded_frame) {
                outside_since = None;
                continue;
            }

            let started_at = outside_since.get_or_insert_with(Instant::now);
            if started_at.elapsed() < DOCK_COLLAPSE_DELAY {
                continue;
            }
            if app
                .cursor_position()
                .is_ok_and(|position| cursor_is_inside_frame(position, expanded_frame))
            {
                outside_since = None;
                continue;
            }

            let should_collapse = {
                let state = app.state::<AppState>();
                let Ok(mut registry) = state.windows.lock() else {
                    return;
                };
                let Some(runtime) = registry.notes.get_mut(&note_id) else {
                    return;
                };
                if runtime.hover_tracking && !runtime.dragging && !runtime.resizing {
                    runtime.hovered = false;
                    runtime.hover_tracking = false;
                    runtime.dock.is_some()
                } else {
                    false
                }
            };
            if should_collapse {
                if let Some(window) = app.get_webview_window(&note_label(&note_id)) {
                    set_dock_frame(&app, &note_id, &window, false);
                }
            }
            return;
        }
    });
}

fn expand_dock(app: &AppHandle, note_id: &str, window: &WebviewWindow) {
    set_dock_frame(app, note_id, window, true);
}

fn set_dock_frame(app: &AppHandle, note_id: &str, window: &WebviewWindow, expanded: bool) {
    let target = {
        let state = app.state::<AppState>();
        let Ok(mut registry) = state.windows.lock() else {
            return;
        };
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return;
        };
        if !expanded {
            runtime.hovered = false;
            runtime.hover_tracking = false;
        }
        let Some(dock) = runtime.dock.as_mut() else {
            return;
        };
        if dock.expanded == expanded {
            return;
        }
        dock.expanded = expanded;
        if expanded {
            dock.expanded_frame
        } else {
            dock.collapsed_frame
        }
    };
    animate_window_frame(app, note_id, window, target);
}

fn animate_window_frame(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
    target: WindowFrame,
) {
    let Ok(start) = window_frame(window) else {
        return;
    };
    if frames_match(start, target) {
        let _ = set_window_frame(window, target);
        return;
    }

    let revision = {
        let state = app.state::<AppState>();
        let Ok(mut registry) = state.windows.lock() else {
            return;
        };
        let Some(runtime) = registry.notes.get_mut(note_id) else {
            return;
        };
        runtime.animation_revision = runtime.animation_revision.wrapping_add(1);
        runtime.animating = true;
        runtime.animation_revision
    };

    let app = app.clone();
    let note_id = note_id.to_string();
    let window = window.clone();
    thread::spawn(move || {
        let started_at = Instant::now();
        loop {
            let is_current = {
                let state = app.state::<AppState>();
                state
                    .windows
                    .lock()
                    .ok()
                    .and_then(|registry| {
                        registry
                            .notes
                            .get(&note_id)
                            .map(|runtime| runtime.animation_revision == revision)
                    })
                    .unwrap_or(false)
            };
            if !is_current {
                return;
            }

            let progress =
                (started_at.elapsed().as_secs_f64() / DOCK_ANIMATION_DURATION.as_secs_f64())
                    .min(1.0);
            let eased = 1.0 - (1.0 - progress).powi(3);
            let frame = interpolate_frame(start, target, eased);
            let _ = set_window_frame(&window, frame);

            if progress >= 1.0 {
                if let Ok(mut registry) = app.state::<AppState>().windows.lock() {
                    if let Some(runtime) = registry.notes.get_mut(&note_id) {
                        if runtime.animation_revision == revision {
                            runtime.animating = false;
                        }
                    }
                }
                return;
            }
            thread::sleep(FRAME_ANIMATION_INTERVAL);
        }
    });
}

fn cancel_animation(runtime: &mut WindowRuntime) {
    runtime.animation_revision = runtime.animation_revision.wrapping_add(1);
    runtime.animating = false;
}

fn clear_dock(app: &AppHandle, note_id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut registry = state
        .windows
        .lock()
        .map_err(|_| "窗口状态锁已损坏".to_string())?;
    if let Some(runtime) = registry.notes.get_mut(note_id) {
        runtime.dock = None;
        runtime.hovered = false;
        runtime.hover_tracking = false;
    }
    Ok(())
}

fn persist_window_placement(
    app: &AppHandle,
    note_id: &str,
    window: &WebviewWindow,
) -> Result<(), String> {
    let frame = window_frame(window)?;
    let dock = {
        let state = app.state::<AppState>();
        state
            .windows
            .lock()
            .ok()
            .and_then(|registry| registry.notes.get(note_id).and_then(|runtime| runtime.dock))
    };
    if let Some(dock) = dock {
        if frames_match(frame, dock.expanded_frame)
            || frames_match(frame, dock.collapsed_frame)
        {
            return save_placement(app, note_id, dock.expanded_frame, Some(dock.edge));
        }
    }
    clear_dock(app, note_id)?;
    save_placement(app, note_id, frame, None)
}

fn persist_all(app: &AppHandle) {
    let Ok(note_ids) = registry_note_ids(app) else {
        return;
    };
    for note_id in note_ids {
        if let Some(window) = app.get_webview_window(&note_label(&note_id)) {
            let _ = persist_window_placement(app, &note_id, &window);
        }
    }
}

fn finish_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.exiting.swap(true, Ordering::SeqCst) {
        return;
    }
    persist_all(app);
    app.exit(0);
}

fn save_placement(
    app: &AppHandle,
    note_id: &str,
    frame: WindowFrame,
    dock: Option<DockEdge>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut repository = state
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?;
    repository.set_placement(note_id, frame, dock)
}

fn registry_note_ids(app: &AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let registry = state
        .windows
        .lock()
        .map_err(|_| "窗口状态锁已损坏".to_string())?;
    Ok(registry.notes.keys().cloned().collect())
}

fn note_label(note_id: &str) -> String {
    format!("{WINDOW_LABEL_PREFIX}{note_id}")
}

fn window_frame(window: &WebviewWindow) -> Result<WindowFrame, String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("读取窗口位置失败: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("读取窗口尺寸失败: {error}"))?;
    Ok(WindowFrame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn set_window_frame(window: &WebviewWindow, frame: WindowFrame) -> Result<(), String> {
    window
        .set_position(Position::Physical(PhysicalPosition::new(frame.x, frame.y)))
        .map_err(|error| format!("设置窗口位置失败: {error}"))?;

    let border_size = window_border_size(window)?;
    let target_inner_size = PhysicalSize::new(
        frame.width.saturating_sub(border_size.width).max(1),
        frame.height.saturating_sub(border_size.height).max(1),
    );

    window
        .set_size(Size::Physical(target_inner_size))
        .map_err(|error| format!("设置窗口尺寸失败: {error}"))
}

fn window_border_size(window: &WebviewWindow) -> Result<PhysicalSize<u32>, String> {
    let outer_size = window
        .outer_size()
        .map_err(|error| format!("读取窗口外框尺寸失败: {error}"))?;
    let inner_size = window
        .inner_size()
        .map_err(|error| format!("读取窗口内容尺寸失败: {error}"))?;
    Ok(PhysicalSize::new(
        outer_size.width.saturating_sub(inner_size.width),
        outer_size.height.saturating_sub(inner_size.height),
    ))
}

fn cursor_is_inside_frame(position: PhysicalPosition<f64>, frame: WindowFrame) -> bool {
    let left = f64::from(frame.x) - DOCK_CURSOR_TOLERANCE;
    let top = f64::from(frame.y) - DOCK_CURSOR_TOLERANCE;
    let right = f64::from(frame.x) + f64::from(frame.width) + DOCK_CURSOR_TOLERANCE;
    let bottom = f64::from(frame.y) + f64::from(frame.height) + DOCK_CURSOR_TOLERANCE;

    position.x >= left && position.x <= right && position.y >= top && position.y <= bottom
}

fn is_usable_frame(frame: WindowFrame, areas: &[WindowFrame]) -> bool {
    if frame.width < MIN_NOTE_WIDTH || frame.height < MIN_NOTE_HEIGHT {
        return false;
    }
    areas.iter().any(|area| {
        let (width, height) = visible_size(frame, *area);
        width >= MIN_VISIBLE_SIZE && height >= MIN_VISIBLE_SIZE
    })
}

fn fit_frame_to_area(frame: WindowFrame, area: WindowFrame) -> WindowFrame {
    let width = frame.width.min(area.width);
    let height = frame.height.min(area.height);
    let max_x = area.x + area.width.saturating_sub(width) as i32;
    let max_y = area.y + area.height.saturating_sub(height) as i32;
    WindowFrame {
        x: frame.x.clamp(area.x, max_x),
        y: frame.y.clamp(area.y, max_y),
        width,
        height,
    }
}

fn visible_size(frame: WindowFrame, area: WindowFrame) -> (u32, u32) {
    let right = (frame.x + frame.width as i32).min(area.x + area.width as i32);
    let bottom = (frame.y + frame.height as i32).min(area.y + area.height as i32);
    let left = frame.x.max(area.x);
    let top = frame.y.max(area.y);
    ((right - left).max(0) as u32, (bottom - top).max(0) as u32)
}

fn get_frame_area(frame: WindowFrame, areas: &[WindowFrame]) -> WindowFrame {
    let mut selected = areas[0];
    let mut selected_intersection = intersection_area(frame, selected);
    let mut selected_distance = center_distance(frame, selected);
    for area in areas.iter().skip(1) {
        let intersection = intersection_area(frame, *area);
        let distance = center_distance(frame, *area);
        if intersection > selected_intersection
            || (intersection == selected_intersection && distance < selected_distance)
        {
            selected = *area;
            selected_intersection = intersection;
            selected_distance = distance;
        }
    }
    selected
}

fn intersection_area(frame: WindowFrame, area: WindowFrame) -> u64 {
    let (width, height) = visible_size(frame, area);
    width as u64 * height as u64
}

fn center_distance(frame: WindowFrame, area: WindowFrame) -> f64 {
    let frame_x = frame.x as f64 + frame.width as f64 / 2.0;
    let frame_y = frame.y as f64 + frame.height as f64 / 2.0;
    let area_x = area.x as f64 + area.width as f64 / 2.0;
    let area_y = area.y as f64 + area.height as f64 / 2.0;
    (frame_x - area_x).powi(2) + (frame_y - area_y).powi(2)
}

fn align_frame_to_edge(frame: WindowFrame, edge: DockEdge, area: WindowFrame) -> WindowFrame {
    let mut next = fit_frame_to_area(frame, area);
    match edge {
        DockEdge::Top => next.y = area.y,
        DockEdge::Right => next.x = area.x + area.width as i32 - next.width as i32,
        DockEdge::Bottom => next.y = area.y + area.height as i32 - next.height as i32,
        DockEdge::Left => next.x = area.x,
    }
    next
}

fn collapsed_frame(
    frame: WindowFrame,
    edge: DockEdge,
    area: WindowFrame,
    border_size: PhysicalSize<u32>,
) -> WindowFrame {
    let mut next = frame;
    let horizontal_reveal = DOCK_REVEAL_SIZE + border_size.width as i32 / 2;
    let vertical_reveal = DOCK_REVEAL_SIZE + border_size.height as i32 / 2;
    match edge {
        DockEdge::Top => next.y = area.y - frame.height as i32 + vertical_reveal,
        DockEdge::Right => next.x = area.x + area.width as i32 - horizontal_reveal,
        DockEdge::Bottom => next.y = area.y + area.height as i32 - vertical_reveal,
        DockEdge::Left => next.x = area.x - frame.width as i32 + horizontal_reveal,
    }
    next
}

fn get_dock_placement(frame: WindowFrame, areas: &[WindowFrame]) -> Option<DockPlacement> {
    let area = get_frame_area(frame, areas);
    let candidates = [
        (DockEdge::Top, (frame.y - area.y).abs()),
        (
            DockEdge::Right,
            (frame.x + frame.width as i32 - area.x - area.width as i32).abs(),
        ),
        (
            DockEdge::Bottom,
            (frame.y + frame.height as i32 - area.y - area.height as i32).abs(),
        ),
        (DockEdge::Left, (frame.x - area.x).abs()),
    ];
    let (edge, distance) = candidates
        .into_iter()
        .min_by_key(|(_, distance)| *distance)?;
    if distance > DOCK_SNAP_DISTANCE {
        return None;
    }
    Some(DockPlacement {
        edge,
        area,
        expanded_frame: align_frame_to_edge(frame, edge, area),
    })
}

fn create_dock_state(
    placement: DockPlacement,
    expanded: bool,
    border_size: PhysicalSize<u32>,
) -> DockState {
    DockState {
        edge: placement.edge,
        area: placement.area,
        expanded_frame: placement.expanded_frame,
        collapsed_frame: collapsed_frame(
            placement.expanded_frame,
            placement.edge,
            placement.area,
            border_size,
        ),
        expanded,
    }
}

fn frames_match(first: WindowFrame, second: WindowFrame) -> bool {
    (first.x - second.x).abs() <= 2
        && (first.y - second.y).abs() <= 2
        && first.width.abs_diff(second.width) <= 2
        && first.height.abs_diff(second.height) <= 2
}

fn range_overlap(first_start: i32, first_end: i32, second_start: i32, second_end: i32) -> i32 {
    first_end.min(second_end) - first_start.max(second_start)
}

fn snap_frame_to_outer_edges(frame: WindowFrame, areas: &[WindowFrame]) -> WindowFrame {
    let area = get_frame_area(frame, areas);
    let mut next = frame;
    let has_left_display = areas.iter().any(|item| {
        *item != area
            && item.x < area.x
            && range_overlap(
                frame.y,
                frame.y + frame.height as i32,
                item.y,
                item.y + item.height as i32,
            ) > 0
    });
    let has_right_display = areas.iter().any(|item| {
        *item != area
            && item.x + item.width as i32 > area.x + area.width as i32
            && range_overlap(
                frame.y,
                frame.y + frame.height as i32,
                item.y,
                item.y + item.height as i32,
            ) > 0
    });
    let has_top_display = areas.iter().any(|item| {
        *item != area
            && item.y < area.y
            && range_overlap(
                frame.x,
                frame.x + frame.width as i32,
                item.x,
                item.x + item.width as i32,
            ) > 0
    });
    let has_bottom_display = areas.iter().any(|item| {
        *item != area
            && item.y + item.height as i32 > area.y + area.height as i32
            && range_overlap(
                frame.x,
                frame.x + frame.width as i32,
                item.x,
                item.x + item.width as i32,
            ) > 0
    });

    if !has_left_display && frame.x <= area.x + DOCK_SNAP_DISTANCE {
        next.x = area.x;
    } else if !has_right_display
        && frame.x + frame.width as i32
            >= area.x + area.width as i32 - DOCK_SNAP_DISTANCE
    {
        next.x = area.x + area.width as i32 - frame.width as i32;
    }

    if !has_top_display && frame.y <= area.y + DOCK_SNAP_DISTANCE {
        next.y = area.y;
    } else if !has_bottom_display
        && frame.y + frame.height as i32
            >= area.y + area.height as i32 - DOCK_SNAP_DISTANCE
    {
        next.y = area.y + area.height as i32 - frame.height as i32;
    }
    next
}

fn interpolate_frame(start: WindowFrame, target: WindowFrame, progress: f64) -> WindowFrame {
    WindowFrame {
        x: interpolate_i32(start.x, target.x, progress),
        y: interpolate_i32(start.y, target.y, progress),
        width: interpolate_u32(start.width, target.width, progress),
        height: interpolate_u32(start.height, target.height, progress),
    }
}

fn interpolate_i32(start: i32, target: i32, progress: f64) -> i32 {
    (start as f64 + (target - start) as f64 * progress).round() as i32
}

fn interpolate_u32(start: u32, target: u32, progress: f64) -> u32 {
    (start as f64 + (target as f64 - start as f64) * progress).round() as u32
}
