use tauri::WebviewWindow;

use crate::models::WindowFrame;

const FALLBACK_AREA: WindowFrame = WindowFrame {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
};

pub fn work_areas(window: &WebviewWindow) -> Vec<WindowFrame> {
    let mut areas = window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            platform_work_area(WindowFrame {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        })
        .filter(|area| area.width > 0 && area.height > 0)
        .collect::<Vec<_>>();
    areas.dedup();

    if areas.is_empty() {
        areas.push(FALLBACK_AREA);
    }
    areas
}

pub fn primary_work_area(window: &WebviewWindow) -> Option<WindowFrame> {
    window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            platform_work_area(WindowFrame {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        })
}

pub fn scale_factor_for_frame(window: &WebviewWindow, frame: WindowFrame) -> f64 {
    let center_x = frame.x as i64 + i64::from(frame.width) / 2;
    let center_y = frame.y as i64 + i64::from(frame.height) / 2;
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let right = position.x as i64 + i64::from(size.width);
            let bottom = position.y as i64 + i64::from(size.height);
            center_x >= position.x as i64
                && center_x < right
                && center_y >= position.y as i64
                && center_y < bottom
        })
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0)
}

#[cfg(windows)]
fn platform_work_area(frame: WindowFrame) -> WindowFrame {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
    };

    let rect = RECT {
        left: frame.x,
        top: frame.y,
        right: frame.x.saturating_add(frame.width as i32),
        bottom: frame.y.saturating_add(frame.height as i32),
    };
    let monitor = unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return frame;
    }

    let mut info: MONITORINFO = unsafe { zeroed() };
    info.cbSize = size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return frame;
    }

    WindowFrame {
        x: info.rcWork.left,
        y: info.rcWork.top,
        width: (info.rcWork.right - info.rcWork.left).max(0) as u32,
        height: (info.rcWork.bottom - info.rcWork.top).max(0) as u32,
    }
}

#[cfg(not(windows))]
fn platform_work_area(frame: WindowFrame) -> WindowFrame {
    frame
}
