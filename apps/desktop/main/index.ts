import { desktopConnection } from "./connection";
import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
} from "electron";
import { join, extname } from "node:path";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { BackendClient } from "./backend";
import { DesktopStore } from "./store";
import { DesktopService } from "./service";
import { registerIPC } from "./ipc";
import { assetPath, csp, productionURL, trustedDocument } from "./security";
import { nativeSave } from "./files";
import type { DesktopEvent } from "../renderer/src/types/domain";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "wecode",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
if (process.env.NODE_ENV === "test" && process.env.WECODE_TEST_USER_DATA_DIR)
  app.setPath("userData", process.env.WECODE_TEST_USER_DATA_DIR);
const gotLock = app.requestSingleInstanceLock();
let window: BrowserWindow | undefined;
let unregister: (() => void) | undefined;
let polling: NodeJS.Timeout | undefined;
let store: DesktopStore | undefined;
let shuttingDown = false;
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch(() => {
      console.error(
        "Desktop startup failed. Check the local configuration and installation.",
      );
      app.exit(1);
    });
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    if (polling) clearInterval(polling);
    unregister?.();
    const deadline = setTimeout(() => app.exit(1), 5000);
    void store
      ?.flush()
      .catch(() => {})
      .finally(() => {
        clearTimeout(deadline);
        app.quit();
      });
    if (!store) {
      clearTimeout(deadline);
      app.quit();
    }
  });
}
async function start() {
  app.setAppUserModelId("com.wecode.desktop");
  nativeTheme.themeSource = "dark";
  let devURL: string | undefined;
  if (!app.isPackaged && process.env.WECODE_DEV_SERVER_URL) {
    if (process.env.WECODE_DEV_SERVER_URL !== "http://127.0.0.1:5173/")
      throw new Error("Invalid development origin.");
    devURL = process.env.WECODE_DEV_SERVER_URL;
  }
  const root = app.getAppPath();
  const renderer = join(root, "apps", "desktop", "renderer", "dist");
  protocol.handle("wecode", async (request) => {
    const path = assetPath(renderer, request.url);
    if (!path) return new Response("Forbidden", { status: 403 });
    try {
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".ico": "image/x-icon",
      };
      const bytes = await readFile(path);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": types[extname(path)] ?? "application/octet-stream",
          "Content-Security-Policy": csp(),
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  store = new DesktopStore(
    join(app.getPath("userData"), "desktop-settings.json"),
  );
  await store.load();
  const bounds = store.window;
  const { screen } = await import("electron");
  const visible =
    bounds &&
    screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return (
        (bounds.x ?? 0) + bounds.width > b.x &&
        (bounds.x ?? 0) < b.x + b.width &&
        (bounds.y ?? 0) + bounds.height > b.y &&
        (bounds.y ?? 0) < b.y + b.height
      );
    });
  window = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 940,
    ...(visible ? { x: bounds?.x, y: bounds?.y } : {}),
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#101218",
    title: "WeCode",
    icon: join(root, "apps", "desktop", "resources", "icon.ico"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(root, "apps", "desktop", "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const owned = window;
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on("will-download", (event) => event.preventDefault());
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        ...(devURL && details.url.startsWith(devURL)
          ? { "Content-Security-Policy": [csp(devURL)] }
          : {}),
      },
    });
  });
  owned.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  owned.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  owned.webContents.on("will-navigate", (event, url) => {
    if (!trustedDocument(url, devURL)) event.preventDefault();
  });
  owned.webContents.on("will-redirect", (event, url) => {
    if (!trustedDocument(url, devURL)) event.preventDefault();
  });
  owned.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    owned.setTitle("WeCode");
  });
  owned.webContents.on("render-process-gone", () =>
    console.error(
      "Desktop renderer stopped unexpectedly. Reopen the application.",
    ),
  );
  let config: Record<string, string> = {};
  if (!app.isPackaged && process.env.NODE_ENV !== "test") {
    try {
      config = parse(
        await readFile(join(root, "processes", "backend", ".env")),
      );
    } catch {}
  }
  const token =
    process.env.WECODE_BACKEND_DISABLED === "1"
      ? undefined
      : (process.env.WECODE_API_TOKEN ?? config.API_TOKEN);
  const api =
    process.env.WECODE_BACKEND_DISABLED === "1"
      ? new BackendClient("http://127.0.0.1:4317/")
      : await desktopConnection(app.getPath("userData"), {
          token,
          url: process.env.WECODE_BACKEND_URL,
        });
  const emit = (event: DesktopEvent) => {
    if (!owned.isDestroyed() && !owned.webContents.isDestroyed())
      owned.webContents.send("wecode:event", event);
  };
  const service = new DesktopService(api, store, nativeSave(owned), emit);
  unregister = registerIPC(owned, service, devURL);
  let pollingActive = false;
  polling = setInterval(() => {
    if (pollingActive || owned.isDestroyed()) return;
    pollingActive = true;
    void service
      .poll()
      .catch(() => {})
      .finally(() => {
        pollingActive = false;
      });
  }, 2000);
  polling.unref();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "Open application data",
            click: () => {
              void shell.openPath(app.getPath("userData"));
            },
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
        ],
      },
    ]),
  );
  owned.once("ready-to-show", () => {
    if (bounds?.maximized) owned.maximize();
    owned.show();
  });
  owned.on("close", () => {
    const b = owned.getNormalBounds();
    void store!
      .saveWindow({ ...b, maximized: owned.isMaximized() })
      .catch(() => {});
  });
  owned.on("closed", () => {
    unregister?.();
    unregister = undefined;
    if (polling) clearInterval(polling);
    window = undefined;
  });
  if (devURL) await owned.loadURL(devURL);
  else await owned.loadURL(productionURL);
}
