import type { NoteSnapshot, ResizeEdge, ScreenPoint } from "../shared/contracts";
import { button, byId, clear, emptyState, text } from "./dom";
import { noteApi, noteMessages, onNoteChanged, registerFlushHandler } from "./rpc";

const elements = {
  app: byId<HTMLElement>("app"),
  titlebar: byId<HTMLElement>("titlebar"),
  titleButton: byId<HTMLButtonElement>("title-btn"),
  titleText: byId<HTMLSpanElement>("title-text"),
  titleInput: byId<HTMLInputElement>("title-input"),
  newNoteButton: byId<HTMLButtonElement>("new-note-btn"),
  modeButton: byId<HTMLButtonElement>("mode-btn"),
  pinButton: byId<HTMLButtonElement>("pin-btn"),
  closeButton: byId<HTMLButtonElement>("close-btn"),
  noteView: byId<HTMLElement>("note-view"),
  noteContent: byId<HTMLTextAreaElement>("note-content"),
  saveState: byId<HTMLElement>("save-state"),
  todoView: byId<HTMLElement>("todo-view"),
  todoForm: byId<HTMLFormElement>("todo-form"),
  todoInput: byId<HTMLInputElement>("todo-input"),
  todoList: byId<HTMLUListElement>("todo-list"),
  archiveSection: byId<HTMLElement>("archive-section"),
  archiveList: byId<HTMLUListElement>("archive-list"),
  clearArchiveButton: byId<HTMLButtonElement>("clear-archive-btn"),
  closeDialog: byId<HTMLElement>("close-dialog"),
  hideButton: byId<HTMLButtonElement>("hide-btn"),
  deleteNoteButton: byId<HTMLButtonElement>("delete-note-btn"),
  cancelButton: byId<HTMLButtonElement>("cancel-btn"),
};
const resizeHandles = Array.from(document.querySelectorAll<HTMLElement>("[data-resize-edge]"));

if (resizeHandles.length !== 8) throw new Error("窗口缩放区域不完整");

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

let snapshot: NoteSnapshot;
let isReady = false;
let todoMode = false;
let editingTodoId: string | null = null;
let isEditingTitle = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let contentRevision = 0;
let saveQueue: Promise<void> = Promise.resolve();
let activeResizePointerId: number | null = null;
let pendingResizePoint: ScreenPoint | null = null;
let resizeAnimationFrame: number | undefined;
let isWindowDragging = false;

const setSaveState = (message: string, state: "idle" | "saving" | "error" = "idle") => {
  elements.saveState.textContent = message;
  elements.saveState.dataset.state = state;
};

const run = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    console.error(error);
    setSaveState("操作失败", "error");
    throw error;
  }
};

const updateSnapshot = (next: NoteSnapshot, options: { hydrateContent?: boolean } = {}) => {
  snapshot = next;
  elements.titleText.textContent = next.title;
  elements.pinButton.classList.toggle("is-active", next.pinned);
  elements.pinButton.title = next.pinned ? "取消置顶" : "固定置顶";
  elements.pinButton.setAttribute("aria-label", elements.pinButton.title);
  renderTodoMode(next.todoMode, false);

  if (options.hydrateContent && elements.noteContent.value !== next.content) {
    elements.noteContent.value = next.content;
  }

  renderTodos();
  renderArchive();
};

const renderTodos = () => {
  clear(elements.todoList);
  if (snapshot.todos.length === 0) {
    elements.todoList.append(emptyState("暂无待办，先添加一件要做的事。"));
    return;
  }

  snapshot.todos.forEach((todo) => {
    const row = document.createElement("li");
    row.className = "todo-item";

    if (editingTodoId === todo.id) {
      const input = document.createElement("input");
      input.className = "edit-input";
      input.value = todo.text;
      input.maxLength = 500;

      const finish = async () => {
        const next = await run(() => noteApi.updateTodo({ id: todo.id, text: input.value }));
        editingTodoId = null;
        updateSnapshot(next);
      };

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void finish();
        }
        if (event.key === "Escape") {
          editingTodoId = null;
          renderTodos();
        }
      });

      const actions = document.createElement("div");
      actions.className = "item-actions";
      actions.append(
        button("保存", "text-btn", finish),
        button("取消", "text-btn muted", () => {
          editingTodoId = null;
          renderTodos();
        }),
      );
      row.append(input, actions);
      elements.todoList.append(row);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return;
    }

    const label = document.createElement("label");
    label.className = "todo-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `完成：${todo.text}`);
    checkbox.addEventListener("change", async () => {
      const next = await run(() => noteApi.completeTodo({ id: todo.id }));
      updateSnapshot(next);
    });
    const todoText = text(todo.text, "todo-text");
    todoText.title = "双击编辑";
    todoText.addEventListener("dblclick", () => {
      editingTodoId = todo.id;
      renderTodos();
    });
    label.append(checkbox, todoText);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      button("编辑", "text-btn", () => {
        editingTodoId = todo.id;
        renderTodos();
      }),
      button("删除", "text-btn danger", async () => {
        const next = await run(() => noteApi.deleteTodo({ id: todo.id }));
        updateSnapshot(next);
      }),
    );
    row.append(label, actions);
    elements.todoList.append(row);
  });
};

const renderArchive = () => {
  clear(elements.archiveList);
  elements.archiveSection.hidden = snapshot.archive.length === 0;

  snapshot.archive.forEach((todo) => {
    const row = document.createElement("li");
    row.className = "archive-item";
    const content = document.createElement("div");
    content.className = "archive-content";
    content.append(
      text(todo.text, "archive-text"),
      text(new Date(todo.completedAt).toLocaleDateString("zh-CN"), "archive-date"),
    );
    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.append(
      button("恢复", "text-btn", async () => {
        const next = await run(() => noteApi.restoreTodo({ id: todo.id }));
        updateSnapshot(next);
      }),
      button("删除", "text-btn danger", async () => {
        const next = await run(() => noteApi.deleteArchivedTodo({ id: todo.id }));
        updateSnapshot(next);
      }),
    );
    row.append(content, actions);
    elements.archiveList.append(row);
  });
};

const renderTodoMode = (enabled: boolean, focus: boolean) => {
  todoMode = enabled;
  elements.noteView.hidden = enabled;
  elements.todoView.hidden = !enabled;
  elements.modeButton.classList.toggle("is-active", enabled);
  elements.modeButton.title = enabled ? "切换到便签模式" : "切换到待办模式";
  elements.modeButton.setAttribute("aria-label", elements.modeButton.title);

  if (!focus) return;
  if (enabled) {
    elements.todoInput.focus();
  } else {
    elements.noteContent.focus();
  }
};

const setTodoMode = async (enabled: boolean) => {
  if (todoMode === enabled) return;
  const next = await run(() => noteApi.setTodoMode({ enabled }));
  updateSnapshot(next);
  renderTodoMode(next.todoMode, true);
};

const beginTitleEdit = () => {
  if (isEditingTitle) return;
  isEditingTitle = true;
  elements.titleButton.hidden = true;
  elements.titleInput.hidden = false;
  elements.titleInput.value = snapshot.title;
  elements.titleInput.focus();
  elements.titleInput.select();
};

const endTitleEdit = async (save: boolean) => {
  if (!isEditingTitle) return;
  isEditingTitle = false;
  elements.titleInput.hidden = true;
  elements.titleButton.hidden = false;
  if (!save) return;
  const next = await run(() => noteApi.renameNote({ title: elements.titleInput.value }));
  updateSnapshot(next);
};

const setDialogOpen = (open: boolean) => {
  elements.closeDialog.hidden = !open;
  if (open) elements.hideButton.focus();
};

const enqueueContentSave = (content: string, revision: number) => {
  const operation = saveQueue.then(async () => {
    if (content === snapshot.content) {
      if (revision === contentRevision) setSaveState("已保存");
      return;
    }

    const next = await noteApi.saveContent({ content });
    snapshot = next;
    if (revision === contentRevision) {
      setSaveState("已保存");
    }
  });

  const observed = operation.catch((error) => {
    console.error(error);
    if (revision === contentRevision) setSaveState("保存失败", "error");
    throw error;
  });
  saveQueue = observed.catch(() => {});
  return observed;
};

const flushPendingContent = async () => {
  if (!isReady) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  await saveQueue;

  const content = elements.noteContent.value;
  if (content !== snapshot.content) {
    await enqueueContentSave(content, contentRevision);
  }
};

const scheduleContentSave = () => {
  const revision = ++contentRevision;
  clearTimeout(saveTimer);
  setSaveState("保存中…", "saving");
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void enqueueContentSave(elements.noteContent.value, revision).catch(() => {});
  }, 350);
};

const hideWindow = async () => {
  await flushPendingContent();
  setDialogOpen(false);
  await noteApi.hideWindow({});
};

const deleteNote = async () => {
  await flushPendingContent();
  setDialogOpen(false);
  await noteApi.deleteNote({});
};

const flushResizeUpdate = () => {
  if (resizeAnimationFrame !== undefined) {
    cancelAnimationFrame(resizeAnimationFrame);
    resizeAnimationFrame = undefined;
  }
  if (!pendingResizePoint) return;
  noteMessages.resizeWindow(pendingResizePoint);
  pendingResizePoint = null;
};

const scheduleResizeUpdate = (point: ScreenPoint) => {
  pendingResizePoint = point;
  if (resizeAnimationFrame !== undefined) return;
  resizeAnimationFrame = requestAnimationFrame(flushResizeUpdate);
};

const finishResize = (event: PointerEvent) => {
  if (activeResizePointerId !== event.pointerId) return;
  activeResizePointerId = null;
  flushResizeUpdate();
  noteMessages.endResize({});
};

const bindResizeEvents = () => {
  resizeHandles.forEach((handle) => {
    const edge = handle.dataset.resizeEdge as ResizeEdge;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || activeResizePointerId !== null) return;
      event.preventDefault();
      event.stopPropagation();
      activeResizePointerId = event.pointerId;
      handle.setPointerCapture(event.pointerId);
      noteMessages.startResize({ edge, screenX: event.screenX, screenY: event.screenY });
    });

    handle.addEventListener("pointermove", (event) => {
      if (activeResizePointerId !== event.pointerId) return;
      scheduleResizeUpdate({ screenX: event.screenX, screenY: event.screenY });
    });

    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
    handle.addEventListener("lostpointercapture", finishResize);
  });
};

const setWindowDragging = (dragging: boolean) => {
  if (isWindowDragging === dragging) return;
  isWindowDragging = dragging;
  noteMessages.setWindowDragging({ dragging });
};

const bindEvents = () => {
  bindResizeEvents();

  elements.titlebar.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (event.button !== 0
      || !(target instanceof Element)
      || target.closest(".electrobun-webkit-app-region-no-drag")) {
      return;
    }
    setWindowDragging(true);
  });

  window.addEventListener("pointerup", () => setWindowDragging(false));
  window.addEventListener("pointercancel", () => setWindowDragging(false));
  document.documentElement.addEventListener("mouseenter", () => {
    noteMessages.setDockHovered({ hovered: true });
  });
  document.documentElement.addEventListener("mouseleave", () => {
    noteMessages.setDockHovered({ hovered: false });
  });

  elements.titleButton.addEventListener("dblclick", beginTitleEdit);
  elements.titleInput.addEventListener("blur", () => void endTitleEdit(true));
  elements.titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.titleInput.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void endTitleEdit(false);
    }
  });

  elements.noteContent.addEventListener("input", scheduleContentSave);
  elements.newNoteButton.addEventListener("click", () => void run(() => noteApi.createNote({})));
  elements.modeButton.addEventListener("click", () => void setTodoMode(!todoMode));
  elements.pinButton.addEventListener("click", async () => {
    const next = await run(() => noteApi.togglePin({}));
    updateSnapshot(next);
  });
  elements.closeButton.addEventListener("click", () => setDialogOpen(true));

  elements.todoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = elements.todoInput.value.trim();
    if (!value) return;
    const next = await run(() => noteApi.addTodo({ text: value }));
    elements.todoInput.value = "";
    updateSnapshot(next);
    elements.todoInput.focus();
  });

  elements.clearArchiveButton.addEventListener("click", async () => {
    const next = await run(() => noteApi.clearArchive({}));
    updateSnapshot(next);
  });

  elements.hideButton.addEventListener("click", () => void run(hideWindow));
  elements.deleteNoteButton.addEventListener("click", () => void run(deleteNote));
  elements.cancelButton.addEventListener("click", () => setDialogOpen(false));
  elements.closeDialog.addEventListener("click", (event) => {
    if (event.target === elements.closeDialog) setDialogOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.closeDialog.hidden) {
        setDialogOpen(false);
      } else if (todoMode) {
        void setTodoMode(false);
      } else {
        void run(hideWindow);
      }
    }
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void run(() => noteApi.createNote({}));
    }
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      void setTodoMode(!todoMode);
    }
  });
};

const bootstrap = async () => {
  registerFlushHandler(flushPendingContent);
  onNoteChanged((next) => {
    if (isReady) updateSnapshot(next);
  });

  try {
    const initial = await run(() => noteApi.bootstrap({}));
    updateSnapshot(initial, { hydrateContent: true });
    isReady = true;
    bindEvents();
    renderTodoMode(initial.todoMode, true);
  } catch {
    elements.noteContent.disabled = true;
    elements.noteContent.placeholder = "无法连接主进程，请重新启动应用。";
    setSaveState("初始化失败", "error");
  } finally {
    elements.app.setAttribute("aria-busy", "false");
  }
};

void bootstrap();
