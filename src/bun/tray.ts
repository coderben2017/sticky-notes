import { Tray } from "electrobun/bun";
import type { NoteRepository } from "./store";
import type { WindowManager } from "./windows";
import { getAppIconPath } from "./app-icon";

type TrayEvent = {
  data: {
    action: string;
  };
};

type TrayControllerOptions = {
  repository: NoteRepository;
  windows: WindowManager;
};

const SHOW_NOTE_PREFIX = "show-note:";
const MAX_NOTE_LABEL_LENGTH = 24;
const ASCII_TEXT = /^[\x20-\x7e]+$/;

type TrayMessages = {
  appName: string;
  newNote: string;
  notes: string;
  noteFallback: string;
  openNote: string;
  showAll: string;
  hideAll: string;
  quitApp: string;
};

const TRAY_MESSAGES: Record<"zh-CN" | "en-US", TrayMessages> = {
  "zh-CN": {
    appName: "桌面便签",
    newNote: "新建便签",
    notes: "便签列表",
    noteFallback: "便签",
    openNote: "打开便签",
    showAll: "显示全部",
    hideAll: "隐藏全部",
    quitApp: "退出应用",
  },
  "en-US": {
    appName: "Sticky Notes",
    newNote: "+  New note",
    notes: "Notes",
    noteFallback: "Note",
    openNote: "Open note",
    showAll: "Show all notes",
    hideAll: "Hide all notes",
    quitApp: "Quit Sticky Notes",
  },
};

const getTrayMessages = () => {
  // Electrobun 1.18.1 的 Windows 托盘菜单使用 ANSI API，只能安全显示 ASCII 文本。
  if (process.platform === "win32") return TRAY_MESSAGES["en-US"];

  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  if (locale.startsWith("zh")) return TRAY_MESSAGES["zh-CN"];
  return TRAY_MESSAGES["en-US"];
};

const noteLabel = (title: string, index: number, fallback: string) => {
  const titleLabel = title.trim().replace(/\s+/g, " ");
  const label = ASCII_TEXT.test(titleLabel) && titleLabel
    ? titleLabel
    : `${fallback} ${index + 1}`;
  if (label.length <= MAX_NOTE_LABEL_LENGTH) return label;
  return `${label.slice(0, MAX_NOTE_LABEL_LENGTH - 3)}...`;
};

export const createTrayController = ({ repository, windows }: TrayControllerOptions) => {
  const messages = getTrayMessages();
  const tray = new Tray({
    title: messages.appName,
    image: getAppIconPath(),
    template: false,
    width: 24,
    height: 24,
  });

  const refresh = () => {
    const noteItems = repository.list().map((note, index) => ({
      type: "normal" as const,
      label: noteLabel(note.title, index, messages.noteFallback),
      action: `${SHOW_NOTE_PREFIX}${note.id}`,
      tooltip: messages.openNote,
      checked: note.pinned,
    }));

    tray.setMenu([
      { type: "normal", label: messages.newNote, action: "new-note" },
      { type: "divider" },
      {
        type: "normal",
        label: `${messages.notes} (${noteItems.length})`,
        submenu: noteItems,
        enabled: noteItems.length > 0,
      },
      { type: "divider" },
      { type: "normal", label: messages.showAll, action: "show-all" },
      { type: "normal", label: messages.hideAll, action: "hide-all" },
      { type: "divider" },
      { type: "normal", label: messages.quitApp, action: "quit" },
    ]);
  };

  tray.on("tray-clicked", (event) => {
    const { action } = (event as TrayEvent).data;

    if (!action || action === "show-all") {
      windows.showAll();
      return;
    }
    if (action === "new-note") {
      windows.create();
      return;
    }
    if (action === "hide-all") {
      windows.hideAll();
      return;
    }
    if (action === "quit") {
      void windows.quit();
      return;
    }
    if (action.startsWith(SHOW_NOTE_PREFIX)) {
      windows.show(action.slice(SHOW_NOTE_PREFIX.length));
    }
  });

  refresh();
  return { refresh };
};
