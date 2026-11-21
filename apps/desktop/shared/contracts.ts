import { z } from "zod";
import type {
  DesktopClient,
  DesktopEvent,
  Preferences,
} from "../renderer/src/types/domain";
export type DesktopMethods = Omit<DesktopClient, "mode" | "subscribe">;
const id = z.string().uuid();
const revision = z.number().int().positive();
const short = z.string().max(256);
const task = z
  .object({
    name: z.string().trim().min(1).max(120),
    workflow: z.string().max(80),
    total: z.number().int().min(1).max(1000),
    creationId: z.string().uuid().optional(),
    preserveIdentity: z.boolean().optional(),
    showBrowser: z.boolean().optional(),
    proxy: short,
    profile: short,
  })
  .strict();
const proxy = z
  .object({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    protocol: z.enum(["http", "https", "socks5"]),
    username: z.string().max(256).optional(),
    password: z.string().max(512).optional(),
  })
  .strict();
export const preferencesSchema = z
  .object({
    concurrency: z.number().int().min(1).max(16),
    catchallDomain: z
      .string()
      .max(253)
      .refine(
        (s) =>
          !s ||
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(s),
      ),
    usernamePrefix: z
      .string()
      .max(31)
      .regex(/^[a-zA-Z0-9_]*$/),
    usernameLength: z.number().int().min(6).max(32),
    passwordLength: z.number().int().min(12).max(64),
    uppercase: z.boolean(),
    numbers: z.boolean(),
    symbols: z.boolean(),
  })
  .strict()
  .refine((p) => p.usernamePrefix.length < p.usernameLength);
export const defaults: Preferences = {
  concurrency: 2,
  catchallDomain: "",
  usernamePrefix: "",
  usernameLength: 12,
  passwordLength: 20,
  uppercase: true,
  numbers: true,
  symbols: true,
};
export const args = {
  getWorkspace: z.tuple([]),
  createTask: z.tuple([task]),
  updateTask: z.tuple([id, task, revision]),
  deleteTask: z.tuple([id, revision]),
  taskAction: z.tuple([
    id,
    z.enum(["start", "pause", "resume", "retry"]),
    revision,
  ]),
  importProxies: z.tuple([z.array(proxy).min(1).max(5000)]),
  checkProxy: z.tuple([id]),
  createProfile: z.tuple([z.string().trim().min(1).max(120), short]),
  deleteProfile: z.tuple([id]),
  saveEmail: z.tuple([
    z.string().trim().email().max(254),
    z.string().min(8).max(512).optional(),
    z
      .object({
        accountDomain: z
          .string()
          .trim()
          .toLowerCase()
          .max(253)
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
        host: z
          .string()
          .trim()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.-]+$/),
        port: z.number().int().min(1).max(65535),
        mailbox: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .regex(/^[^\x00-\x1f\x7f]+$/),
      })
      .strict()
      .optional(),
  ]),
  getEmailAppPassword: z.tuple([id]),
  getEmailVerifications: z.tuple([]),
  testEmail: z.tuple([]),
  savePreferences: z.tuple([preferencesSchema]),
  getLogs: z.tuple([]),
  exportAccounts: z.tuple([
    z.array(id).max(5000),
    z.object({ includePasswords: z.boolean() }).strict().optional(),
  ]),
  exportLogs: z.tuple([z.array(z.string().max(80)).max(5000)]),
} as const;
export type Method = keyof typeof args;
export const methods = Object.keys(args) as Method[];
export const eventChannel = "wecode:event";
export type Reply<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };
export type EventSink = (event: DesktopEvent) => void;
