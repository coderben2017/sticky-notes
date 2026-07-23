import {
  BrowserView,
  BrowserWindow,
  Screen,
  app,
} from "electrobun/bun";
import type {
  DockEdge,
  NoteMessageName,
  NoteMessages,
  NoteRequestName,
  NoteRequestParams,
  NoteRequestResponse,
  NoteSnapshot,
  ResizeEdge,
  ScreenPoint,
  StickyNotesRPC,
  WindowFrame,
} from "../shared/contracts";
import {
  decodeWireValue,
  encodeWireValue,
  type WireValue,
} from "../shared/wire";
import { setAppWindowIcon } from "./app-icon";
import type { NoteRepository } from "./store";

type WindowManagerOptions = {
  repository: NoteRepository;
  onNotesChanged: () => void;
};

type StickyNotesTransport = ReturnType<typeof BrowserView.defineRPC<StickyNotesRPC>>;
type NoteWindow = BrowserWindow<StickyNotesTransport>;

type DockPlacement = {
  edge: DockEdge;
  area: WindowFrame;
  expandedFrame: WindowFrame;
};

type DockState = DockPlacement & {
  collapsedFrame: WindowFrame;
  expanded: boolean;
};

type ResizeState = {
  edge: ResizeEdge;
  startPoint: ScreenPoint;
  startFrame: WindowFrame;
};

const NOTE_WIDTH = 360;
const NOTE_HEIGHT = 420;
const MIN_NOTE_WIDTH = 240;
const MIN_NOTE_HEIGHT = 240;
const MIN_VISIBLE_SIZE = 48;
const DOCK_SNAP_DISTANCE = 16;
const DOCK_REVEAL_SIZE = 8;
const DOCK_COLLAPSE_DELAY = 500;
const DOCK_ANIMATION_DURATION = 180;
const FRAME_ANIMATION_INTERVAL = 16;
const DRAG_SETTLE_DELAY = 40;
const FRAME_SETTLE_DELAY = 250;
const FALLBACK_AREA: WindowFrame = { x: 0, y: 0, width: 1920, height: 1080 };

type NoteRequestHandler<Name extends NoteRequestName> = (
  params: NoteRequestParams<Name>,
) => NoteRequestResponse<Name> | Promise<NoteRequestResponse<Name>>;

type NoteMessageHandler<Name extends NoteMessageName> = (
  params: NoteMessages[Name],
) => void;

const wireRequest = <Name extends NoteRequestName>(
  _name: Name,
  handler: NoteRequestHandler<Name>,
) => async (payload: WireValue<NoteRequestParams<Name>>) => {
  const params = decodeWireValue(payload);
  const response = await handler(params);
  return encodeWireValue(response);
};

const wireMessage = <Name extends NoteMessageName>(
  _name: Name,
  handler: NoteMessageHandler<Name>,
) => (payload: WireValue<NoteMessages[Name]>) => {
  handler(decodeWireValue(payload));
};

const clamp = (value: number, minimum: number, maximum: number) => {
  return Math.min(Math.max(value, minimum), maximum);
};

const isUsableArea = (area: WindowFrame) => area.width > 0 && area.height > 0;

const getDisplayAreas = () => {
  const areas = Screen.getAllDisplays()
    .map(({ workArea }) => workArea)
    .filter(isUsableArea);
  if (areas.length > 0) return areas;

  const primaryArea = Screen.getPrimaryDisplay().workArea;
  return isUsableArea(primaryArea) ? [primaryArea] : [FALLBACK_AREA];
};

const fitFrameToArea = (frame: WindowFrame, area: WindowFrame): WindowFrame => {
  const width = Math.min(frame.width, area.width);
  const height = Math.min(frame.height, area.height);
  return {
    x: clamp(frame.x, area.x, area.x + area.width - width),
    y: clamp(frame.y, area.y, area.y + area.height - height),
    width,
    height,
  };
};

const getVisibleSize = (frame: WindowFrame, area: WindowFrame) => ({
  width: Math.max(0, Math.min(frame.x + frame.width, area.x + area.width) - Math.max(frame.x, area.x)),
  height: Math.max(0, Math.min(frame.y + frame.height, area.y + area.height) - Math.max(frame.y, area.y)),
});

const getIntersectionArea = (frame: WindowFrame, area: WindowFrame) => {
  const visible = getVisibleSize(frame, area);
  return visible.width * visible.height;
};

const getCenterDistance = (frame: WindowFrame, area: WindowFrame) => {
  const frameX = frame.x + frame.width / 2;
  const frameY = frame.y + frame.height / 2;
  const areaX = area.x + area.width / 2;
  const areaY = area.y + area.height / 2;
  return (frameX - areaX) ** 2 + (frameY - areaY) ** 2;
};

const getFrameArea = (frame: WindowFrame, areas: WindowFrame[]) => {
  let selected = areas[0]!;
  let selectedIntersection = getIntersectionArea(frame, selected);
  let selectedDistance = getCenterDistance(frame, selected);

  areas.slice(1).forEach((area) => {
    const intersection = getIntersectionArea(frame, area);
    const distance = getCenterDistance(frame, area);
    if (intersection > selectedIntersection
      || (intersection === selectedIntersection && distance < selectedDistance)) {
      selected = area;
      selectedIntersection = intersection;
      selectedDistance = distance;
    }
  });
  return selected;
};

const isUsableFrame = (
  frame: WindowFrame | undefined,
  areas: WindowFrame[],
): frame is WindowFrame => {
  if (!frame
    || !Number.isFinite(frame.x)
    || !Number.isFinite(frame.y)
    || !Number.isFinite(frame.width)
    || !Number.isFinite(frame.height)
    || frame.width < MIN_NOTE_WIDTH
    || frame.height < MIN_NOTE_HEIGHT) {
    return false;
  }

  return areas.some((area) => {
    const visible = getVisibleSize(frame, area);
    return visible.width >= MIN_VISIBLE_SIZE && visible.height >= MIN_VISIBLE_SIZE;
  });
};

const alignFrameToEdge = (
  frame: WindowFrame,
  edge: DockEdge,
  area: WindowFrame,
): WindowFrame => {
  const next = fitFrameToArea(frame, area);
  if (edge === "top") next.y = area.y;
  if (edge === "right") next.x = area.x + area.width - next.width;
  if (edge === "bottom") next.y = area.y + area.height - next.height;
  if (edge === "left") next.x = area.x;
  return next;
};

const getCollapsedFrame = (
  frame: WindowFrame,
  edge: DockEdge,
  area: WindowFrame,
): WindowFrame => {
  const next = { ...frame };
  if (edge === "top") next.y = area.y - frame.height + DOCK_REVEAL_SIZE;
  if (edge === "right") next.x = area.x + area.width - DOCK_REVEAL_SIZE;
  if (edge === "bottom") next.y = area.y + area.height - DOCK_REVEAL_SIZE;
  if (edge === "left") next.x = area.x - frame.width + DOCK_REVEAL_SIZE;
  return next;
};

const getDockPlacement = (
  frame: WindowFrame,
  areas: WindowFrame[],
): DockPlacement | undefined => {
  const area = getFrameArea(frame, areas);
  const candidates: Array<{ edge: DockEdge; distance: number }> = [
    { edge: "top", distance: Math.abs(frame.y - area.y) },
    { edge: "right", distance: Math.abs(frame.x + frame.width - area.x - area.width) },
    { edge: "bottom", distance: Math.abs(frame.y + frame.height - area.y - area.height) },
    { edge: "left", distance: Math.abs(frame.x - area.x) },
  ];
  let closest = candidates[0]!;
  candidates.slice(1).forEach((candidate) => {
    if (candidate.distance < closest.distance) closest = candidate;
  });
  if (closest.distance > DOCK_SNAP_DISTANCE) return undefined;

  return {
    edge: closest.edge,
    area,
    expandedFrame: alignFrameToEdge(frame, closest.edge, area),
  };
};

const createDockState = (placement: DockPlacement, expanded: boolean): DockState => ({
  ...placement,
  collapsedFrame: getCollapsedFrame(placement.expandedFrame, placement.edge, placement.area),
  expanded,
});

const framesMatch = (first: WindowFrame, second: WindowFrame) => {
  return Math.abs(first.x - second.x) <= 2
    && Math.abs(first.y - second.y) <= 2
    && Math.abs(first.width - second.width) <= 2
    && Math.abs(first.height - second.height) <= 2;
};

const getRangeOverlap = (
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) => {
  return Math.max(0, Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart));
};

const snapFrameToOuterEdges = (frame: WindowFrame, areas: WindowFrame[]) => {
  const area = getFrameArea(frame, areas);
  const next = { ...frame };
  const hasLeftDisplay = areas.some((item) => item !== area
    && item.x < area.x
    && getRangeOverlap(frame.y, frame.y + frame.height, item.y, item.y + item.height) > 0);
  const hasRightDisplay = areas.some((item) => item !== area
    && item.x + item.width > area.x + area.width
    && getRangeOverlap(frame.y, frame.y + frame.height, item.y, item.y + item.height) > 0);
  const hasTopDisplay = areas.some((item) => item !== area
    && item.y < area.y
    && getRangeOverlap(frame.x, frame.x + frame.width, item.x, item.x + item.width) > 0);
  const hasBottomDisplay = areas.some((item) => item !== area
    && item.y + item.height > area.y + area.height
    && getRangeOverlap(frame.x, frame.x + frame.width, item.x, item.x + item.width) > 0);

  if (!hasLeftDisplay && frame.x <= area.x + DOCK_SNAP_DISTANCE) {
    next.x = area.x;
  } else if (!hasRightDisplay
    && frame.x + frame.width >= area.x + area.width - DOCK_SNAP_DISTANCE) {
    next.x = area.x + area.width - frame.width;
  }

  if (!hasTopDisplay && frame.y <= area.y + DOCK_SNAP_DISTANCE) {
    next.y = area.y;
  } else if (!hasBottomDisplay
    && frame.y + frame.height >= area.y + area.height - DOCK_SNAP_DISTANCE) {
    next.y = area.y + area.height - frame.height;
  }
  return next;
};

const resizeFrame = (
  startFrame: WindowFrame,
  edge: ResizeEdge,
  deltaX: number,
  deltaY: number,
): WindowFrame => {
  const next = { ...startFrame };
  const resizeTop = edge === "top" || edge.startsWith("top-");
  const resizeRight = edge === "right" || edge.endsWith("-right");
  const resizeBottom = edge === "bottom" || edge.startsWith("bottom-");
  const resizeLeft = edge === "left" || edge.endsWith("-left");

  if (resizeRight) next.width = Math.max(MIN_NOTE_WIDTH, startFrame.width + deltaX);
  if (resizeBottom) next.height = Math.max(MIN_NOTE_HEIGHT, startFrame.height + deltaY);
  if (resizeLeft) {
    next.width = Math.max(MIN_NOTE_WIDTH, startFrame.width - deltaX);
    next.x = startFrame.x + startFrame.width - next.width;
  }
  if (resizeTop) {
    next.height = Math.max(MIN_NOTE_HEIGHT, startFrame.height - deltaY);
    next.y = startFrame.y + startFrame.height - next.height;
  }
  return next;
};

const createFrameResolver = () => {
  let cascadeIndex = 0;

  return (): WindowFrame => {
    const displays = Screen.getAllDisplays();
    const display = displays.find((item) => !item.isPrimary)
      ?? displays.find((item) => item.isPrimary);
    const area = display && isUsableArea(display.workArea)
      ? display.workArea
      : getDisplayAreas()[0]!;
    const offset = (cascadeIndex++ % 8) * 24;

    return fitFrameToArea({
      x: Math.round(area.x + 32 + offset),
      y: Math.round(area.y + 32 + offset),
      width: NOTE_WIDTH,
      height: NOTE_HEIGHT,
    }, area);
  };
};

export const createWindowManager = ({ repository, onNotesChanged }: WindowManagerOptions) => {
  const windows = new Map<string, NoteWindow>();
  const dockStates = new Map<string, DockState>();
  const resizeStates = new Map<string, ResizeState>();
  const draggingNotes = new Set<string>();
  const frameTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const frameAnimationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const resolveDefaultFrame = createFrameResolver();
  let activeNoteId = repository.list()[0]?.id ?? "";

  const clearFrameTimer = (noteId: string) => {
    clearTimeout(frameTimers.get(noteId));
    frameTimers.delete(noteId);
  };

  const clearCollapseTimer = (noteId: string) => {
    clearTimeout(collapseTimers.get(noteId));
    collapseTimers.delete(noteId);
  };

  const cancelFrameAnimation = (noteId: string) => {
    clearTimeout(frameAnimationTimers.get(noteId));
    frameAnimationTimers.delete(noteId);
  };

  const animateWindowFrame = (
    noteId: string,
    window: NoteWindow,
    target: WindowFrame,
  ) => {
    cancelFrameAnimation(noteId);
    clearFrameTimer(noteId);
    const start = window.getFrame();
    if (framesMatch(start, target)) {
      window.setFrame(target.x, target.y, target.width, target.height);
      return;
    }

    const startedAt = Date.now();
    const step = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / DOCK_ANIMATION_DURATION);
      const eased = 1 - (1 - progress) ** 3;
      const frame = {
        x: Math.round(start.x + (target.x - start.x) * eased),
        y: Math.round(start.y + (target.y - start.y) * eased),
        width: Math.round(start.width + (target.width - start.width) * eased),
        height: Math.round(start.height + (target.height - start.height) * eased),
      };
      window.setFrame(frame.x, frame.y, frame.width, frame.height);

      if (progress < 1) {
        frameAnimationTimers.set(noteId, setTimeout(step, FRAME_ANIMATION_INTERVAL));
        return;
      }
      frameAnimationTimers.delete(noteId);
    };
    step();
  };

  const persistPlacement = (noteId: string, window: NoteWindow) => {
    try {
      const frame = window.getFrame();
      const dock = dockStates.get(noteId);
      if (dock && frameAnimationTimers.has(noteId)) {
        cancelFrameAnimation(noteId);
        repository.setPlacement(noteId, dock.expandedFrame, dock.edge);
        return;
      }
      if (dock
        && (framesMatch(frame, dock.expandedFrame) || framesMatch(frame, dock.collapsedFrame))) {
        repository.setPlacement(noteId, dock.expandedFrame, dock.edge);
        return;
      }

      dockStates.delete(noteId);
      repository.setPlacement(noteId, frame);
    } catch (error) {
      console.warn(`保存便签窗口位置失败: ${noteId}`, error);
    }
  };

  const flushFrames = () => {
    windows.forEach((window, noteId) => persistPlacement(noteId, window));
  };

  const setDockFrame = (noteId: string, window: NoteWindow, expanded: boolean) => {
    const dock = dockStates.get(noteId);
    if (!dock || dock.expanded === expanded) return;
    dock.expanded = expanded;
    const frame = expanded ? dock.expandedFrame : dock.collapsedFrame;
    animateWindowFrame(noteId, window, frame);
  };

  const expandDock = (noteId: string, window: NoteWindow) => {
    clearCollapseTimer(noteId);
    setDockFrame(noteId, window, true);
  };

  const settleWindowPlacement = (noteId: string, window: NoteWindow) => {
    clearFrameTimer(noteId);
    if (draggingNotes.has(noteId) || resizeStates.has(noteId)) return;

    let frame = window.getFrame();
    const dock = dockStates.get(noteId);
    if (dock
      && (framesMatch(frame, dock.expandedFrame) || framesMatch(frame, dock.collapsedFrame))) {
      repository.setPlacement(noteId, dock.expandedFrame, dock.edge);
      return;
    }

    if (dock) {
      clearCollapseTimer(noteId);
      dockStates.delete(noteId);
    }

    const displayAreas = getDisplayAreas();
    const snappedFrame = snapFrameToOuterEdges(frame, displayAreas);
    if (!framesMatch(frame, snappedFrame)) {
      frame = snappedFrame;
      window.setFrame(frame.x, frame.y, frame.width, frame.height);
    }

    const placement = getDockPlacement(frame, displayAreas);
    if (!placement) {
      repository.setPlacement(noteId, frame);
      return;
    }

    const nextDock = createDockState(placement, true);
    dockStates.set(noteId, nextDock);
    repository.setPlacement(noteId, nextDock.expandedFrame, nextDock.edge);
    setDockFrame(noteId, window, false);
  };

  const scheduleFrameSettle = (
    noteId: string,
    window: NoteWindow,
    delay = FRAME_SETTLE_DELAY,
  ) => {
    clearFrameTimer(noteId);
    frameTimers.set(noteId, setTimeout(() => {
      settleWindowPlacement(noteId, window);
    }, delay));
  };

  const scheduleDockCollapse = (noteId: string, window: NoteWindow) => {
    clearCollapseTimer(noteId);
    collapseTimers.set(noteId, setTimeout(() => {
      collapseTimers.delete(noteId);
      if (draggingNotes.has(noteId) || resizeStates.has(noteId)) {
        scheduleDockCollapse(noteId, window);
        return;
      }

      const dock = dockStates.get(noteId);
      if (!dock) return;
      const frame = window.getFrame();
      if (!framesMatch(frame, dock.expandedFrame) && !framesMatch(frame, dock.collapsedFrame)) {
        settleWindowPlacement(noteId, window);
        return;
      }
      setDockFrame(noteId, window, false);
    }, DOCK_COLLAPSE_DELAY));
  };

  const startResize = (noteId: string, window: NoteWindow, edge: ResizeEdge, point: ScreenPoint) => {
    if (!Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return;
    clearCollapseTimer(noteId);
    cancelFrameAnimation(noteId);

    const dock = dockStates.get(noteId);
    if (dock) {
      dockStates.delete(noteId);
      window.setFrame(
        dock.expandedFrame.x,
        dock.expandedFrame.y,
        dock.expandedFrame.width,
        dock.expandedFrame.height,
      );
      repository.setPlacement(noteId, dock.expandedFrame);
    }

    resizeStates.set(noteId, {
      edge,
      startPoint: point,
      startFrame: window.getFrame(),
    });
  };

  const updateResize = (noteId: string, window: NoteWindow, point: ScreenPoint) => {
    const state = resizeStates.get(noteId);
    if (!state || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return;
    const frame = resizeFrame(
      state.startFrame,
      state.edge,
      point.screenX - state.startPoint.screenX,
      point.screenY - state.startPoint.screenY,
    );
    window.setFrame(frame.x, frame.y, frame.width, frame.height);
  };

  const endResize = (noteId: string, window: NoteWindow) => {
    if (!resizeStates.delete(noteId)) return;
    scheduleFrameSettle(noteId, window);
  };

  const setWindowDragging = (noteId: string, window: NoteWindow, dragging: boolean) => {
    if (dragging) {
      draggingNotes.add(noteId);
      clearCollapseTimer(noteId);
      cancelFrameAnimation(noteId);
      const dock = dockStates.get(noteId);
      if (dock) {
        dock.expanded = true;
        window.setFrame(
          dock.expandedFrame.x,
          dock.expandedFrame.y,
          dock.expandedFrame.width,
          dock.expandedFrame.height,
        );
      }
      return;
    }
    if (!draggingNotes.delete(noteId)) return;
    scheduleFrameSettle(noteId, window, DRAG_SETTLE_DELAY);
  };

  const setDockHovered = (noteId: string, window: NoteWindow, hovered: boolean) => {
    if (!dockStates.has(noteId)) return;
    if (hovered) {
      expandDock(noteId, window);
      return;
    }
    scheduleDockCollapse(noteId, window);
  };

  const handleWindowMove = (noteId: string, window: NoteWindow) => {
    activeNoteId = noteId;
    scheduleFrameSettle(noteId, window);
  };

  const flushPendingChanges = async (sourceNoteId?: string) => {
    const payload = encodeWireValue({});
    const requests = Array.from(windows.entries())
      .filter(([noteId]) => noteId !== sourceNoteId)
      .map(([, window]) => window.webview.rpc?.request.flushPendingChanges(payload));
    const results = await Promise.allSettled(requests);
    const failedCount = results.filter(({ status }) => status === "rejected").length;
    if (failedCount > 0) {
      console.warn(`退出前有 ${failedCount} 个便签窗口未能确认保存状态`);
    }
  };

  const quit = async (sourceNoteId?: string) => {
    await flushPendingChanges(sourceNoteId);
    flushFrames();
    app.quit();
  };

  const publish = (note: NoteSnapshot) => {
    const window = windows.get(note.id);
    window?.webview.rpc?.send.noteChanged(encodeWireValue(note));
  };

  const syncNativeWindow = (window: NoteWindow, note: NoteSnapshot) => {
    window.setTitle(note.title);
    window.setAlwaysOnTop(note.pinned);
  };

  const mutate = (
    noteId: string,
    operation: () => NoteSnapshot,
    options: { refreshTray?: boolean } = {},
  ) => {
    const note = operation();
    const window = windows.get(noteId);
    if (window) syncNativeWindow(window, note);
    publish(note);
    if (options.refreshTray) onNotesChanged();
    return note;
  };

  const open = (noteId: string) => {
    const existing = windows.get(noteId);
    if (existing) {
      existing.show();
      existing.activate();
      activeNoteId = noteId;
      return existing;
    }

    const note = repository.get(noteId);
    const storedFrame = repository.getFrame(noteId);
    const storedDock = repository.getDock(noteId);
    const displayAreas = getDisplayAreas();
    const expandedFrame = isUsableFrame(storedFrame, displayAreas)
      ? storedFrame
      : resolveDefaultFrame();
    let frame = expandedFrame;

    if (storedDock && isUsableFrame(storedFrame, displayAreas)) {
      const area = getFrameArea(expandedFrame, displayAreas);
      const dock = createDockState({
        edge: storedDock,
        area,
        expandedFrame: alignFrameToEdge(expandedFrame, storedDock, area),
      }, false);
      dockStates.set(noteId, dock);
      repository.setPlacement(noteId, dock.expandedFrame, dock.edge);
      frame = dock.collapsedFrame;
    }

    let window!: NoteWindow;
    const rpc = BrowserView.defineRPC<StickyNotesRPC>({
      maxRequestTime: 5000,
      handlers: {
        requests: {
          bootstrap: wireRequest("bootstrap", () => {
            const snapshot = repository.get(noteId);
            syncNativeWindow(window, snapshot);
            return snapshot;
          }),
          saveContent: wireRequest("saveContent", ({ content }) => mutate(
            noteId,
            () => repository.saveContent(noteId, content),
          )),
          renameNote: wireRequest("renameNote", ({ title }) => mutate(
            noteId,
            () => repository.rename(noteId, title),
            { refreshTray: true },
          )),
          createNote: wireRequest("createNote", () => {
            const created = repository.create();
            open(created.id);
            onNotesChanged();
            return { id: created.id };
          }),
          togglePin: wireRequest("togglePin", () => mutate(
            noteId,
            () => repository.togglePin(noteId),
            { refreshTray: true },
          )),
          setTodoMode: wireRequest("setTodoMode", ({ enabled }) => mutate(
            noteId,
            () => repository.setTodoMode(noteId, enabled),
          )),
          hideWindow: wireRequest("hideWindow", () => {
            persistPlacement(noteId, window);
            window.hide();
            return null;
          }),
          deleteNote: wireRequest("deleteNote", () => {
            clearFrameTimer(noteId);
            clearCollapseTimer(noteId);
            cancelFrameAnimation(noteId);
            resizeStates.delete(noteId);
            draggingNotes.delete(noteId);
            dockStates.delete(noteId);
            const replacement = repository.remove(noteId);
            onNotesChanged();

            setTimeout(() => {
              if (replacement) open(replacement.id);
              window.close();
            }, 100);
            return null;
          }),
          addTodo: wireRequest("addTodo", ({ text }) => mutate(
            noteId,
            () => repository.addTodo(noteId, text),
          )),
          updateTodo: wireRequest("updateTodo", ({ id, text }) => mutate(
            noteId,
            () => repository.updateTodo(noteId, id, text),
          )),
          deleteTodo: wireRequest("deleteTodo", ({ id }) => mutate(
            noteId,
            () => repository.deleteTodo(noteId, id),
          )),
          completeTodo: wireRequest("completeTodo", ({ id }) => mutate(
            noteId,
            () => repository.completeTodo(noteId, id),
          )),
          restoreTodo: wireRequest("restoreTodo", ({ id }) => mutate(
            noteId,
            () => repository.restoreTodo(noteId, id),
          )),
          deleteArchivedTodo: wireRequest("deleteArchivedTodo", ({ id }) => mutate(
            noteId,
            () => repository.deleteArchivedTodo(noteId, id),
          )),
          clearArchive: wireRequest("clearArchive", () => mutate(
            noteId,
            () => repository.clearArchive(noteId),
          )),
        },
        messages: {
          startResize: wireMessage("startResize", ({ edge, screenX, screenY }) => {
            startResize(noteId, window, edge, { screenX, screenY });
          }),
          resizeWindow: wireMessage("resizeWindow", (point) => {
            updateResize(noteId, window, point);
          }),
          endResize: wireMessage("endResize", () => {
            endResize(noteId, window);
          }),
          setWindowDragging: wireMessage("setWindowDragging", ({ dragging }) => {
            setWindowDragging(noteId, window, dragging);
          }),
          setDockHovered: wireMessage("setDockHovered", ({ hovered }) => {
            setDockHovered(noteId, window, hovered);
          }),
        },
      },
    });

    window = new BrowserWindow({
      title: note.title,
      frame,
      url: "views://mainview/index.html",
      titleBarStyle: "hidden",
      transparent: false,
      renderer: "native",
      rpc,
    });
    setAppWindowIcon(window);

    windows.set(noteId, window);
    activeNoteId = noteId;
    syncNativeWindow(window, note);

    window.on("move", () => handleWindowMove(noteId, window));
    window.on("resize", () => scheduleFrameSettle(noteId, window));
    window.on("focus", () => {
      activeNoteId = noteId;
    });
    window.on("close", () => {
      clearFrameTimer(noteId);
      clearCollapseTimer(noteId);
      cancelFrameAnimation(noteId);
      resizeStates.delete(noteId);
      draggingNotes.delete(noteId);
      dockStates.delete(noteId);
      windows.delete(noteId);
    });

    return window;
  };

  const create = () => {
    const note = repository.create();
    open(note.id);
    onNotesChanged();
    return note;
  };

  const show = (noteId: string) => {
    const window = open(noteId);
    expandDock(noteId, window);
    window.show();
    window.activate();
    return window;
  };

  const showAll = () => {
    const notes = repository.list();
    notes.forEach((note) => {
      const window = windows.get(note.id) ?? open(note.id);
      expandDock(note.id, window);
      window.showInactive();
    });
    const active = windows.get(activeNoteId) ?? windows.get(notes[0]?.id ?? "");
    active?.show();
    active?.activate();
  };

  const hideAll = () => {
    windows.forEach((window, noteId) => {
      persistPlacement(noteId, window);
      window.hide();
    });
  };

  const openAll = () => {
    repository.list().forEach((note) => open(note.id));
  };

  return {
    create,
    show,
    showAll,
    hideAll,
    openAll,
    quit,
  };
};

export type WindowManager = ReturnType<typeof createWindowManager>;
