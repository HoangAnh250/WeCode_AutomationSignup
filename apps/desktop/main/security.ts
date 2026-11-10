import { resolve, relative, isAbsolute } from "node:path";
export const productionURL = "wecode://desktop/index.html";
export function trustedDocument(value: string, devURL?: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.port && !devURL)) return false;
    return devURL
      ? url.origin === new URL(devURL).origin && url.pathname === "/"
      : url.protocol === "wecode:" &&
          url.hostname === "desktop" &&
          url.pathname === "/index.html" &&
          !url.username &&
          !url.password;
  } catch {
    return false;
  }
}
export function assetPath(root: string, requestURL: string) {
  const url = new URL(requestURL);
  if (url.protocol !== "wecode:" || url.hostname !== "desktop") return;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return;
  }
  if (path.includes("\\") || path.includes("\0")) return;
  const candidate = resolve(root, "." + path);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return;
  return candidate;
}
export function csp(devURL?: string) {
  return devURL
    ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:5173; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`
    : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`;
}
