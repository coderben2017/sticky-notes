import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { join } from "node:path";

const iconPath = join(process.cwd(), "..", "Resources", "app.ico");
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x10;
const WM_SETICON = 0x80;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const ICON_SMALL_2 = 2;
const GCLP_HICON = -14;
const GCLP_HICON_SMALL = -34;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXSMICON = 49;
const SM_CYSMICON = 50;
const DEFAULT_DPI = 96;
const windowIcons = new Map<string, Pointer>();
const user32 = process.platform === "win32"
  ? dlopen("user32.dll", {
      LoadImageW: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32],
        returns: FFIType.ptr,
      },
      SendMessageW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
        returns: FFIType.i64,
      },
      SetClassLongPtrW: {
        args: [FFIType.ptr, FFIType.i32, FFIType.i64],
        returns: FFIType.i64,
      },
      GetDpiForWindow: {
        args: [FFIType.ptr],
        returns: FFIType.u32,
      },
      GetSystemMetricsForDpi: {
        args: [FFIType.i32, FFIType.u32],
        returns: FFIType.i32,
      },
    })
  : undefined;

const loadIcon = (width: number, height: number) => {
  if (!user32) return null;
  const cacheKey = `${width}x${height}`;
  const cached = windowIcons.get(cacheKey);
  if (cached) return cached;

  const pathBuffer = Buffer.from(`${iconPath}\0`, "utf16le");
  const icon = user32.symbols.LoadImageW(
    null,
    pathBuffer,
    IMAGE_ICON,
    width,
    height,
    LR_LOADFROMFILE,
  );
  if (icon) windowIcons.set(cacheKey, icon);
  return icon;
};

export const getAppIconPath = () => iconPath;

export const setAppWindowIcon = (window: { ptr: Pointer }) => {
  if (!user32) return;
  const dpi = user32.symbols.GetDpiForWindow(window.ptr) || DEFAULT_DPI;
  const largeIcon = loadIcon(
    user32.symbols.GetSystemMetricsForDpi(SM_CXICON, dpi),
    user32.symbols.GetSystemMetricsForDpi(SM_CYICON, dpi),
  );
  const smallIcon = loadIcon(
    user32.symbols.GetSystemMetricsForDpi(SM_CXSMICON, dpi),
    user32.symbols.GetSystemMetricsForDpi(SM_CYSMICON, dpi),
  );
  if (!largeIcon || !smallIcon) return;

  user32.symbols.SendMessageW(window.ptr, WM_SETICON, ICON_BIG, largeIcon);
  user32.symbols.SendMessageW(window.ptr, WM_SETICON, ICON_SMALL, smallIcon);
  user32.symbols.SendMessageW(window.ptr, WM_SETICON, ICON_SMALL_2, smallIcon);
  user32.symbols.SetClassLongPtrW(window.ptr, GCLP_HICON, largeIcon);
  user32.symbols.SetClassLongPtrW(window.ptr, GCLP_HICON_SMALL, smallIcon);
};
