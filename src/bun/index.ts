import {
  ApplicationMenu,
  Utils,
} from "electrobun/bun";
import { dirname, join } from "node:path";
import { createNoteRepository } from "./store";
import { createTrayController } from "./tray";
import { createWindowManager } from "./windows";

ApplicationMenu.setApplicationMenu([
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "divider" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
]);

const repository = createNoteRepository(
  join(Utils.paths.userData, "notes.json"),
  {
    legacyContentPaths: [
      join(dirname(process.execPath), "note.txt"),
      join(process.cwd(), "note.txt"),
      join(process.cwd(), "build", "bin", "note.txt"),
    ],
  },
);
let refreshTray = () => {};
const windows = createWindowManager({
  repository,
  onNotesChanged: () => refreshTray(),
});
const tray = createTrayController({ repository, windows });
refreshTray = tray.refresh;

windows.openAll();
