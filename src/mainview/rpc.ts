import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  NoteApi,
  NoteMessageApi,
  NoteMessageName,
  NoteMessages,
  NoteRequestName,
  NoteRequestParams,
  NoteRequestResponse,
} from "../shared/contracts";

type FlushHandler = () => Promise<void>;

const REQUEST_COMMANDS: Record<NoteRequestName, string> = {
  bootstrap: "bootstrap",
  saveContent: "save_content",
  renameNote: "rename_note",
  createNote: "create_note",
  togglePin: "toggle_pin",
  setTodoMode: "set_todo_mode",
  hideWindow: "hide_window",
  deleteNote: "delete_note",
  addTodo: "add_todo",
  updateTodo: "update_todo",
  deleteTodo: "delete_todo",
  completeTodo: "complete_todo",
  restoreTodo: "restore_todo",
  deleteArchivedTodo: "delete_archived_todo",
  clearArchive: "clear_archive",
};

const MESSAGE_COMMANDS: Record<NoteMessageName, string> = {
  setWindowDragging: "set_window_dragging",
  setWindowResizing: "set_window_resizing",
  setDockHovered: "set_dock_hovered",
};

let flushPendingChanges: FlushHandler = async () => {};
let flushListenerRegistered = false;

const defineRequest = <Name extends NoteRequestName>(name: Name) => (
  params: NoteRequestParams<Name>,
): Promise<NoteRequestResponse<Name>> => {
  return invoke<NoteRequestResponse<Name>>(REQUEST_COMMANDS[name], params);
};

const defineMessage = <Name extends NoteMessageName>(name: Name) => (
  params: NoteMessages[Name],
) => invoke<void>(MESSAGE_COMMANDS[name], params);

export const noteApi = {
  bootstrap: defineRequest("bootstrap"),
  saveContent: defineRequest("saveContent"),
  renameNote: defineRequest("renameNote"),
  createNote: defineRequest("createNote"),
  togglePin: defineRequest("togglePin"),
  setTodoMode: defineRequest("setTodoMode"),
  hideWindow: defineRequest("hideWindow"),
  deleteNote: defineRequest("deleteNote"),
  addTodo: defineRequest("addTodo"),
  updateTodo: defineRequest("updateTodo"),
  deleteTodo: defineRequest("deleteTodo"),
  completeTodo: defineRequest("completeTodo"),
  restoreTodo: defineRequest("restoreTodo"),
  deleteArchivedTodo: defineRequest("deleteArchivedTodo"),
  clearArchive: defineRequest("clearArchive"),
} satisfies NoteApi;

export const noteMessages = {
  setWindowDragging: defineMessage("setWindowDragging"),
  setWindowResizing: defineMessage("setWindowResizing"),
  setDockHovered: defineMessage("setDockHovered"),
} satisfies NoteMessageApi;

export const registerFlushHandler = (handler: FlushHandler) => {
  flushPendingChanges = handler;
  if (flushListenerRegistered) return;

  flushListenerRegistered = true;
  void listen("flush-pending-changes", async () => {
    try {
      await flushPendingChanges();
    } finally {
      await invoke("confirm_flush");
    }
  });
};
