use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::{windows, AppState};

const TRAY_ID: &str = "sticky-notes-tray";
const SHOW_NOTE_PREFIX: &str = "show-note:";
const MAX_NOTE_LABEL_LENGTH: usize = 32;

struct TrayMessages {
    app_name: &'static str,
    new_note: &'static str,
    notes: &'static str,
    empty: &'static str,
    show_all: &'static str,
    hide_all: &'static str,
    quit_app: &'static str,
}

const ZH_CN: TrayMessages = TrayMessages {
    app_name: "桌面便签",
    new_note: "新建便签",
    notes: "便签列表",
    empty: "暂无便签",
    show_all: "显示全部",
    hide_all: "隐藏全部",
    quit_app: "退出应用",
};

const EN_US: TrayMessages = TrayMessages {
    app_name: "Sticky Notes",
    new_note: "New note",
    notes: "Notes",
    empty: "No notes",
    show_all: "Show all notes",
    hide_all: "Hide all notes",
    quit_app: "Quit Sticky Notes",
};

pub fn create(app: &AppHandle) -> Result<(), String> {
    let messages = messages();
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(messages.app_name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Err(error) = handle_menu_event(app, event.id.as_ref()) {
                eprintln!("处理托盘菜单失败: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = windows::show_all(tray.app_handle()) {
                    eprintln!("显示便签失败: {error}");
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .build(app)
        .map_err(|error| format!("创建系统托盘失败: {error}"))?;
    Ok(())
}

pub fn refresh(app: &AppHandle) -> Result<(), String> {
    let menu = build_menu(app)?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "找不到系统托盘".to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| format!("更新托盘菜单失败: {error}"))
}

fn build_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let messages = messages();
    let notes = app
        .state::<AppState>()
        .repository
        .lock()
        .map_err(|_| "便签数据锁已损坏".to_string())?
        .list();

    let menu = Menu::new(app).map_err(|error| format!("创建托盘菜单失败: {error}"))?;
    let new_note = MenuItem::with_id(app, "new-note", messages.new_note, true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单项失败: {error}"))?;
    menu.append(&new_note)
        .map_err(|error| format!("添加托盘菜单项失败: {error}"))?;
    append_separator(app, &menu)?;

    let heading = MenuItem::with_id(
        app,
        "notes-heading",
        format!("{} ({})", messages.notes, notes.len()),
        false,
        None::<&str>,
    )
    .map_err(|error| format!("创建托盘菜单项失败: {error}"))?;
    menu.append(&heading)
        .map_err(|error| format!("添加托盘菜单项失败: {error}"))?;

    if notes.is_empty() {
        let empty = MenuItem::with_id(app, "notes-empty", messages.empty, false, None::<&str>)
            .map_err(|error| format!("创建托盘菜单项失败: {error}"))?;
        menu.append(&empty)
            .map_err(|error| format!("添加托盘菜单项失败: {error}"))?;
    } else {
        for note in notes {
            let item = MenuItem::with_id(
                app,
                format!("{SHOW_NOTE_PREFIX}{}", note.id),
                note_label(&note.title),
                true,
                None::<&str>,
            )
            .map_err(|error| format!("创建托盘便签项失败: {error}"))?;
            menu.append(&item)
                .map_err(|error| format!("添加托盘便签项失败: {error}"))?;
        }
    }

    append_separator(app, &menu)?;
    let show_all = MenuItem::with_id(app, "show-all", messages.show_all, true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单项失败: {error}"))?;
    let hide_all = MenuItem::with_id(app, "hide-all", messages.hide_all, true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单项失败: {error}"))?;
    menu.append(&show_all)
        .and_then(|_| menu.append(&hide_all))
        .map_err(|error| format!("添加托盘菜单项失败: {error}"))?;

    append_separator(app, &menu)?;
    let quit = MenuItem::with_id(app, "quit", messages.quit_app, true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单项失败: {error}"))?;
    menu.append(&quit)
        .map_err(|error| format!("添加托盘菜单项失败: {error}"))?;
    Ok(menu)
}

fn append_separator(app: &AppHandle, menu: &Menu<tauri::Wry>) -> Result<(), String> {
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| format!("创建托盘分隔线失败: {error}"))?;
    menu.append(&separator)
        .map_err(|error| format!("添加托盘分隔线失败: {error}"))
}

fn handle_menu_event(app: &AppHandle, action: &str) -> Result<(), String> {
    if action == "new-note" {
        let note = app
            .state::<AppState>()
            .repository
            .lock()
            .map_err(|_| "便签数据锁已损坏".to_string())?
            .create()?;
        windows::open_note(app, &note.id)?;
        return refresh(app);
    }
    if action == "show-all" {
        return windows::show_all(app);
    }
    if action == "hide-all" {
        return windows::hide_all(app);
    }
    if action == "quit" {
        return windows::begin_quit(app);
    }
    if let Some(note_id) = action.strip_prefix(SHOW_NOTE_PREFIX) {
        return windows::show_note(app, note_id);
    }
    Ok(())
}

fn messages() -> &'static TrayMessages {
    let locale = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    if locale.starts_with("zh") {
        &ZH_CN
    } else {
        &EN_US
    }
}

fn note_label(title: &str) -> String {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = if title.is_empty() {
        messages().notes.to_string()
    } else {
        title
    };
    if title.chars().count() <= MAX_NOTE_LABEL_LENGTH {
        return title;
    }
    let shortened = title
        .chars()
        .take(MAX_NOTE_LABEL_LENGTH.saturating_sub(3))
        .collect::<String>();
    format!("{shortened}...")
}
