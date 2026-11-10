import { DesktopError } from "./errors";
export class BackendClient {
  readonly configured: boolean;
  private readonly base: string;
  constructor(
    base: string,
    private readonly token?: string,
  ) {
    const url = new URL(base);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Backend URL must be a loopback HTTP origin.");
    this.base = url.origin;
    this.configured = Boolean(token);
  }
  async request<T = unknown>(
    path: string,
    method = "GET",
    body?: unknown,
    raw = false,
  ): Promise<T> {
    if (!this.configured)
      throw new DesktopError(
        "BACKEND_NOT_CONFIGURED",
        "Local connection is not configured. Close this window and open Start WeCode.cmd from the project folder.",
      );
    if (
      !path.startsWith("/api/v1/") ||
      path.startsWith("//") ||
      path.includes("..")
    )
      throw new DesktopError(
        "INVALID_BACKEND_PATH",
        "Invalid service request.",
      );
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new DesktopError(
        "BACKEND_UNAVAILABLE",
        "Local backend is unavailable. Start PostgreSQL, Redis and the backend service.",
      );
    }
    if (!response.ok) {
      let code = "BACKEND_REQUEST_FAILED";
      try {
        const data = (await response.json()) as { error?: { code?: string } };
        if (data.error?.code && /^[A-Z_]{1,80}$/.test(data.error.code))
          code = data.error.code;
      } catch {}
      throw new DesktopError(
        code,
        `Backend rejected the operation (${code}). Refresh the workspace and check its configuration.`,
      );
    }
    if (response.status === 204) return undefined as T;
    const reader = response.body?.getReader();
    if (!reader) return undefined as T;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.byteLength;
        if (length > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new DesktopError(
            "BACKEND_RESPONSE_TOO_LARGE",
            "Backend response exceeds the desktop limit. Export a smaller selection.",
          );
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return (raw ? text : JSON.parse(text)) as T;
  }
  async all<T = Record<string, any>>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const data = await this.request<{ items: T[]; total: number }>(
        `${path}?page=${page}&limit=100`,
      );
      rows.push(...data.items);
      if (rows.length >= data.total) return rows;
    }
    throw new DesktopError(
      "WORKSPACE_TOO_LARGE",
      "This desktop view supports up to 5000 records per module. Use backend filtering for a larger workspace.",
    );
  }
}
