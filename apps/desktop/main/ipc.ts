import { ipcMain, type BrowserWindow } from "electron";
import {
  args,
  methods,
  type DesktopMethods,
  type Method,
} from "../shared/contracts";
import { publicError, DesktopError } from "./errors";
import { trustedDocument } from "./security";
export function registerIPC(
  window: BrowserWindow,
  service: DesktopMethods,
  devURL?: string,
) {
  let active = 0;
  for (const method of methods) {
    ipcMain.handle(`wecode:${method}`, async (event, ...input: unknown[]) => {
      try {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !trustedDocument(event.senderFrame.url, devURL)
        )
          throw new DesktopError(
            "IPC_FORBIDDEN",
            "This window is not authorized to access desktop services.",
          );
        if (active >= 32)
          throw new DesktopError(
            "IPC_BUSY",
            "Desktop services are busy. Try again shortly.",
          );
        if (Buffer.byteLength(JSON.stringify(input)) > 3_000_000)
          throw new DesktopError(
            "IPC_PAYLOAD_TOO_LARGE",
            "Desktop request exceeds the accepted size.",
          );
        const parsed = args[method].safeParse(input);
        if (!parsed.success)
          throw new DesktopError(
            "INVALID_IPC_ARGUMENTS",
            "Desktop request contains invalid fields.",
          );
        active++;
        try {
          return {
            ok: true,
            value: await (
              service[method] as (...a: unknown[]) => Promise<unknown>
            )(...parsed.data),
          };
        } finally {
          active--;
        }
      } catch (error) {
        return { ok: false, error: publicError(error) };
      }
    });
  }
  return () => {
    for (const method of methods) ipcMain.removeHandler(`wecode:${method}`);
  };
}
