import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type {
  ArchivedTodoItem,
  DockEdge,
  NoteSnapshot,
  TodoItem,
  WindowFrame,
} from "../shared/contracts";

type StoredNote = NoteSnapshot & {
  frame?: WindowFrame;
  dock?: DockEdge;
};

type RepositoryState = {
  version: 1;
  noteOrder: string[];
  notes: Record<string, StoredNote>;
};

type NoteRepositoryOptions = {
  legacyContentPaths?: readonly string[];
};

const now = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const cleanText = (value: string, maxLength: number) => value.trim().slice(0, maxLength);

const createDefaultNote = (index: number): StoredNote => {
  const timestamp = now();
  return {
    id: createId(),
    title: index === 1 ? "便签" : `便签 #${index}`,
    content: "",
    todos: [],
    archive: [],
    todoMode: false,
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createInitialState = (content = ""): RepositoryState => {
  const note = { ...createDefaultNote(1), content };
  return {
    version: 1,
    noteOrder: [note.id],
    notes: { [note.id]: note },
  };
};

const readLegacyContent = (paths: readonly string[]) => {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
      if (content) return content;
    } catch (error) {
      console.warn(`读取旧版便签失败: ${path}`, error);
    }
  }
  return "";
};

const isWindowFrame = (value: unknown): value is WindowFrame => {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<WindowFrame>;
  return Number.isFinite(frame.x)
    && Number.isFinite(frame.y)
    && Number.isFinite(frame.width)
    && Number.isFinite(frame.height);
};

const isSameWindowFrame = (first: WindowFrame | undefined, second: WindowFrame) => {
  return first?.x === second.x
    && first.y === second.y
    && first.width === second.width
    && first.height === second.height;
};

const isDockEdge = (value: unknown): value is DockEdge => {
  return value === "top"
    || value === "right"
    || value === "bottom"
    || value === "left";
};

const isTodoItem = (value: unknown): value is TodoItem => {
  if (!value || typeof value !== "object") return false;
  const todo = value as Partial<TodoItem>;
  return typeof todo.id === "string"
    && typeof todo.text === "string"
    && typeof todo.createdAt === "string";
};

const isArchivedTodoItem = (value: unknown): value is ArchivedTodoItem => {
  return isTodoItem(value)
    && typeof (value as Partial<ArchivedTodoItem>).completedAt === "string";
};

const isStoredNote = (value: unknown): value is StoredNote => {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<StoredNote>;
  return typeof note.id === "string"
    && typeof note.title === "string"
    && typeof note.content === "string"
    && Array.isArray(note.todos)
    && note.todos.every(isTodoItem)
    && Array.isArray(note.archive)
    && note.archive.every(isArchivedTodoItem)
    && (note.todoMode === undefined || typeof note.todoMode === "boolean")
    && typeof note.pinned === "boolean"
    && typeof note.createdAt === "string"
    && typeof note.updatedAt === "string"
    && (note.frame === undefined || isWindowFrame(note.frame))
    && (note.dock === undefined || isDockEdge(note.dock));
};

const parseState = (raw: string): RepositoryState => {
  const value = JSON.parse(raw) as Partial<RepositoryState>;
  if (value.version !== 1 || !value.notes || !Array.isArray(value.noteOrder)) {
    throw new Error("不支持的便签数据格式");
  }

  const notes = Object.fromEntries(Object.entries(value.notes).flatMap(([id, note]) => {
    if (!isStoredNote(note)) return [];
    return [[id, {
      ...note,
      todoMode: typeof note.todoMode === "boolean" ? note.todoMode : false,
    }]];
  }));
  const noteOrder = value.noteOrder.filter((id) => Boolean(notes[id]));

  if (noteOrder.length === 0) throw new Error("便签数据中没有有效记录");
  return { version: 1, noteOrder, notes };
};

const toSnapshot = ({ frame: _frame, dock: _dock, ...snapshot }: StoredNote): NoteSnapshot => structuredClone(snapshot);

export const createNoteRepository = (
  filePath: string,
  { legacyContentPaths = [] }: NoteRepositoryOptions = {},
) => {
  mkdirSync(dirname(filePath), { recursive: true });

  let shouldPersist = !existsSync(filePath);
  let state = (() => {
    if (!existsSync(filePath)) {
      return createInitialState(readLegacyContent(legacyContentPaths));
    }

    try {
      return parseState(readFileSync(filePath, "utf8"));
    } catch (error) {
      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        renameSync(filePath, backupPath);
        console.error(`读取便签数据失败，原文件已备份到: ${backupPath}`, error);
      } catch (backupError) {
        console.error("读取便签数据失败，且无法备份原文件", error, backupError);
      }
      shouldPersist = true;
      return createInitialState();
    }
  })();

  const persist = () => {
    const temporaryPath = `${filePath}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
      renameSync(temporaryPath, filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  };

  const requireNote = (id: string) => {
    const note = state.notes[id];
    if (!note) throw new Error(`便签不存在: ${id}`);
    return note;
  };

  const commit = (id: string, transform: (note: StoredNote) => StoredNote) => {
    const current = requireNote(id);
    const next = {
      ...transform(structuredClone(current)),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now(),
    };
    state = {
      ...state,
      notes: { ...state.notes, [id]: next },
    };
    persist();
    return toSnapshot(next);
  };

  const removeTodo = (todos: TodoItem[], id: string) => todos.filter((todo) => todo.id !== id);
  const removeArchivedTodo = (archive: ArchivedTodoItem[], id: string) => archive.filter((todo) => todo.id !== id);

  if (shouldPersist) persist();

  return {
    list: () => state.noteOrder.map((id) => toSnapshot(requireNote(id))),

    get: (id: string) => toSnapshot(requireNote(id)),

    getFrame: (id: string) => structuredClone(requireNote(id).frame),

    getDock: (id: string) => requireNote(id).dock,

    create: () => {
      const note = createDefaultNote(state.noteOrder.length + 1);
      state = {
        ...state,
        noteOrder: [...state.noteOrder, note.id],
        notes: { ...state.notes, [note.id]: note },
      };
      persist();
      return toSnapshot(note);
    },

    remove: (id: string) => {
      requireNote(id);
      const { [id]: _removed, ...remainingNotes } = state.notes;
      const noteOrder = state.noteOrder.filter((noteId) => noteId !== id);
      let replacement: StoredNote | undefined;

      if (noteOrder.length === 0) {
        replacement = createDefaultNote(1);
        noteOrder.push(replacement.id);
        remainingNotes[replacement.id] = replacement;
      }

      state = {
        ...state,
        noteOrder,
        notes: remainingNotes,
      };
      persist();
      return replacement ? toSnapshot(replacement) : null;
    },

    saveContent: (id: string, content: string) => commit(id, (note) => ({ ...note, content })),

    rename: (id: string, title: string) => commit(id, (note) => ({
      ...note,
      title: cleanText(title, 80) || "便签",
    })),

    togglePin: (id: string) => commit(id, (note) => ({ ...note, pinned: !note.pinned })),

    setTodoMode: (id: string, enabled: boolean) => commit(id, (note) => ({
      ...note,
      todoMode: enabled,
    })),

    setPlacement: (id: string, frame: WindowFrame, dock?: DockEdge) => {
      const note = requireNote(id);
      if (isSameWindowFrame(note.frame, frame) && note.dock === dock) return;

      state = {
        ...state,
        notes: {
          ...state.notes,
          [id]: { ...note, frame, dock },
        },
      };
      persist();
    },

    addTodo: (id: string, text: string) => commit(id, (note) => {
      const value = cleanText(text, 500);
      if (!value) return note;
      return {
        ...note,
        todos: [...note.todos, { id: createId(), text: value, createdAt: now() }],
      };
    }),

    updateTodo: (id: string, todoId: string, text: string) => commit(id, (note) => {
      const value = cleanText(text, 500);
      return {
        ...note,
        todos: value
          ? note.todos.map((todo) => todo.id === todoId ? { ...todo, text: value } : todo)
          : removeTodo(note.todos, todoId),
      };
    }),

    deleteTodo: (id: string, todoId: string) => commit(id, (note) => ({
      ...note,
      todos: removeTodo(note.todos, todoId),
    })),

    completeTodo: (id: string, todoId: string) => commit(id, (note) => {
      const todo = note.todos.find((item) => item.id === todoId);
      if (!todo) return note;
      return {
        ...note,
        todos: removeTodo(note.todos, todoId),
        archive: [{ ...todo, completedAt: now() }, ...note.archive],
      };
    }),

    restoreTodo: (id: string, todoId: string) => commit(id, (note) => {
      const todo = note.archive.find((item) => item.id === todoId);
      if (!todo) return note;
      const { completedAt: _completedAt, ...restored } = todo;
      return {
        ...note,
        todos: [...note.todos, restored],
        archive: removeArchivedTodo(note.archive, todoId),
      };
    }),

    deleteArchivedTodo: (id: string, todoId: string) => commit(id, (note) => ({
      ...note,
      archive: removeArchivedTodo(note.archive, todoId),
    })),

    clearArchive: (id: string) => commit(id, (note) => ({ ...note, archive: [] })),
  };
};

export type NoteRepository = ReturnType<typeof createNoteRepository>;
