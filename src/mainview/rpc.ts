import { Electroview } from "electrobun/view";
import type {
  EmptyParams,
  NoteApi,
  NoteMessageApi,
  NoteMessageName,
  NoteMessages,
  NoteRequestName,
  NoteRequestParams,
  NoteRequestResponse,
  NoteSnapshot,
  StickyNotesRPC,
} from "../shared/contracts";
import {
  decodeWireValue,
  encodeWireValue,
  type WireValue,
} from "../shared/wire";

type SnapshotListener = (snapshot: NoteSnapshot) => void;
type FlushHandler = () => Promise<void>;

const listeners = new Set<SnapshotListener>();
let flushPendingChanges: FlushHandler = async () => {};

const rpc = Electroview.defineRPC<StickyNotesRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      flushPendingChanges: async (payload) => {
        decodeWireValue<EmptyParams>(payload);
        await flushPendingChanges();
        return encodeWireValue(null);
      },
    },
    messages: {
      noteChanged: (payload) => {
        const snapshot = decodeWireValue<NoteSnapshot>(payload);
        listeners.forEach((listener) => listener(snapshot));
      },
    },
  },
});

const electroview = new Electroview({ rpc });
type RawRequest = (payload: WireValue<unknown>) => Promise<WireValue<unknown>>;
const rawRequests = electroview.rpc!.request as unknown as Record<NoteRequestName, RawRequest>;
type RawMessage = (payload: WireValue<unknown>) => void;
const rawMessages = electroview.rpc!.send as unknown as Record<NoteMessageName, RawMessage>;

const defineRequest = <Name extends NoteRequestName>(name: Name) => async (
  params: NoteRequestParams<Name>,
): Promise<NoteRequestResponse<Name>> => {
  const response = await rawRequests[name](encodeWireValue(params));
  return decodeWireValue(response as WireValue<NoteRequestResponse<Name>>);
};

const defineMessage = <Name extends NoteMessageName>(name: Name) => (
  params: NoteMessages[Name],
) => {
  rawMessages[name](encodeWireValue(params));
};

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
  startResize: defineMessage("startResize"),
  resizeWindow: defineMessage("resizeWindow"),
  endResize: defineMessage("endResize"),
  setWindowDragging: defineMessage("setWindowDragging"),
  setDockHovered: defineMessage("setDockHovered"),
} satisfies NoteMessageApi;

export const registerFlushHandler = (handler: FlushHandler) => {
  flushPendingChanges = handler;
};

export const onNoteChanged = (listener: SnapshotListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
