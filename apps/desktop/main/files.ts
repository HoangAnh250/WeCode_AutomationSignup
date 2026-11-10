import { dialog, app, type BrowserWindow } from "electron";
import { writeFile, rename, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DesktopError } from "./errors";
export function nativeSave(window: BrowserWindow) {
  return async (name: string, content: string) => {
    const csv = name.endsWith(".csv");
    const result = await dialog.showSaveDialog(window, {
      title: csv ? "Export accounts" : "Export logs",
      defaultPath: join(app.getPath("downloads"), name),
      filters: [
        { name: csv ? "CSV" : "Log file", extensions: [csv ? "csv" : "log"] },
      ],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (result.canceled || !result.filePath)
      throw new DesktopError("EXPORT_CANCELLED", "Export was cancelled.");
    const temporary = join(
      dirname(result.filePath),
      `.wecode-export-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      await rename(temporary, result.filePath);
    } catch {
      throw new DesktopError(
        "EXPORT_WRITE_FAILED",
        "Could not save the export to the selected location.",
      );
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  };
}
