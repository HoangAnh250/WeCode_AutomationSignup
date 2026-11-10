import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defaults, preferencesSchema } from "../shared/contracts";
import type { Preferences } from "../renderer/src/types/domain";
const schema = z.object({
  preferences: preferencesSchema,
  emailConfigId: z.string().uuid().optional(),
  window: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().min(980).max(8192),
      height: z.number().min(700).max(8192),
      maximized: z.boolean(),
    })
    .optional(),
});
export class DesktopStore {
  private value: z.infer<typeof schema> = { preferences: defaults };
  private pending = Promise.resolve();
  constructor(private readonly file: string) {}
  async load() {
    try {
      this.value = schema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn(
          "Desktop preferences could not be loaded; using defaults.",
        );
    }
  }
  get emailConfigId() {
    return this.value.emailConfigId;
  }
  selectEmailConfig(id: string) {
    this.value.emailConfigId = z.string().uuid().parse(id);
    return this.save();
  }
  get preferences() {
    return structuredClone(this.value.preferences);
  }
  get window() {
    return this.value.window;
  }
  savePreferences(value: Preferences) {
    this.value.preferences = preferencesSchema.parse(value);
    return this.save();
  }
  saveWindow(value: NonNullable<z.infer<typeof schema>["window"]>) {
    this.value.window = value;
    return this.save();
  }
  private save() {
    const snapshot = JSON.stringify(this.value, null, 2);
    const work = this.pending
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, this.file);
      });
    this.pending = work;
    return work;
  }
  flush() {
    return this.pending;
  }
}
