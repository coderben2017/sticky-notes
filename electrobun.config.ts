import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Sticky Notes",
    identifier: "com.coderben2017.sticky-notes",
    version: "0.1.0",
    description: "轻量、常驻桌面的多窗口便签与待办工具",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      minify: true,
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
        minify: true,
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/styles.css": "views/mainview/styles.css",
    },
    buildFolder: "dist",
    artifactFolder: "artifacts",
    targets: "current",
    useAsar: true,
    locales: ["zh-CN", "en-US"],
    win: {
      defaultRenderer: "native",
      bundleCEF: false,
      icon: "build/windows/icon.ico",
    },
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  release: {
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
