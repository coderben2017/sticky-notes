import type { RPCSchema } from "electrobun";
import type { WireValue } from "./wire";

export type WindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DockEdge = "top" | "right" | "bottom" | "left";

export type ResizeEdge = DockEdge | "top-left" | "top-right" | "bottom-right" | "bottom-left";

export type ScreenPoint = {
  screenX: number;
  screenY: number;
};

export type TodoItem = {
  id: string;
  text: string;
  createdAt: string;
};

export type ArchivedTodoItem = TodoItem & {
  completedAt: string;
};

export type NoteSnapshot = {
  id: string;
  title: string;
  content: string;
  todos: TodoItem[];
  archive: ArchivedTodoItem[];
  todoMode: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmptyParams = Record<string, never>;

export type NoteRequests = {
  bootstrap: {
    params: EmptyParams;
    response: NoteSnapshot;
  };
  saveContent: {
    params: { content: string };
    response: NoteSnapshot;
  };
  renameNote: {
    params: { title: string };
    response: NoteSnapshot;
  };
  createNote: {
    params: EmptyParams;
    response: { id: string };
  };
  togglePin: {
    params: EmptyParams;
    response: NoteSnapshot;
  };
  setTodoMode: {
    params: { enabled: boolean };
    response: NoteSnapshot;
  };
  hideWindow: {
    params: EmptyParams;
    response: null;
  };
  deleteNote: {
    params: EmptyParams;
    response: null;
  };
  addTodo: {
    params: { text: string };
    response: NoteSnapshot;
  };
  updateTodo: {
    params: { id: string; text: string };
    response: NoteSnapshot;
  };
  deleteTodo: {
    params: { id: string };
    response: NoteSnapshot;
  };
  completeTodo: {
    params: { id: string };
    response: NoteSnapshot;
  };
  restoreTodo: {
    params: { id: string };
    response: NoteSnapshot;
  };
  deleteArchivedTodo: {
    params: { id: string };
    response: NoteSnapshot;
  };
  clearArchive: {
    params: EmptyParams;
    response: NoteSnapshot;
  };
};

export type NoteRequestName = keyof NoteRequests;
export type NoteRequestParams<Name extends NoteRequestName> = NoteRequests[Name]["params"];
export type NoteRequestResponse<Name extends NoteRequestName> = NoteRequests[Name]["response"];

export type NoteApi = {
  [Name in NoteRequestName]: (
    params: NoteRequestParams<Name>,
  ) => Promise<NoteRequestResponse<Name>>;
};

export type NoteMessages = {
  startResize: ScreenPoint & { edge: ResizeEdge };
  resizeWindow: ScreenPoint;
  endResize: EmptyParams;
  setWindowDragging: { dragging: boolean };
  setDockHovered: { hovered: boolean };
};

export type NoteMessageName = keyof NoteMessages;

export type NoteMessageApi = {
  [Name in NoteMessageName]: (params: NoteMessages[Name]) => void;
};

type WireRequests<Requests> = {
  [Name in keyof Requests]: Requests[Name] extends {
    params: infer Params;
    response: infer Response;
  }
    ? {
        params: WireValue<Params>;
        response: WireValue<Response>;
      }
    : never;
};

type WireMessages<Messages> = {
  [Name in keyof Messages]: WireValue<Messages[Name]>;
};

type WebviewRequests = {
  flushPendingChanges: {
    params: EmptyParams;
    response: null;
  };
};

export type StickyNotesRPC = {
  bun: RPCSchema<{
    requests: WireRequests<NoteRequests>;
    messages: WireMessages<NoteMessages>;
  }>;
  webview: RPCSchema<{
    requests: WireRequests<WebviewRequests>;
    messages: {
      noteChanged: WireValue<NoteSnapshot>;
    };
  }>;
};
