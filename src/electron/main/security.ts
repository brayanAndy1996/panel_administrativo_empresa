import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export interface FrameLike {
  url: string;
}

export interface WebContentsLike {
  mainFrame: FrameLike;
}

export interface IpcEventLike {
  sender: WebContentsLike;
  senderFrame: FrameLike | null;
}

export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const authority = /^app:\/\/([^/?#]*)/i.exec(rawUrl)?.[1];
    if (!authority || authority.toLowerCase() !== "panel") return false;
    const url = new URL(rawUrl);
    return (
      url.protocol === "app:" &&
      url.hostname === "panel" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function isAuthorizedIpcEvent(event: IpcEventLike, expectedContents: WebContentsLike | null): boolean {
  if (!expectedContents) return false;
  try {
    return (
      event.sender === expectedContents &&
      event.senderFrame === expectedContents.mainFrame &&
      event.senderFrame !== null &&
      isTrustedAppUrl(event.senderFrame.url)
    );
  } catch {
    return false;
  }
}

export function createSecureWebPreferences(preload: string) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  } as const;
}

function decodePathSegment(rawSegment: string): string | null {
  let segment = rawSegment;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const decoded = decodeURIComponent(segment);
      if (decoded === segment) break;
      segment = decoded;
    }
  } catch {
    return null;
  }

  const hasControlCharacter = Array.from(segment).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

  if (
    segment === "." ||
    segment === ".." ||
    /[\\/:]/.test(segment) ||
    hasControlCharacter ||
    /%[0-9a-f]{2}/i.test(segment)
  ) {
    return null;
  }
  return segment;
}

export async function resolveAppAsset(requestUrl: string, exportRoot: string): Promise<string | null> {
  if (!isTrustedAppUrl(requestUrl)) return null;
  const prefix = /^app:\/\/panel(?=\/|[?#]|$)/i.exec(requestUrl)?.[0];
  if (!prefix) return null;
  const remainder = requestUrl.slice(prefix.length);
  const pathEnd = remainder.search(/[?#]/);
  const route = pathEnd < 0 ? remainder : remainder.slice(0, pathEnd);
  const rawPath = route || "/";
  if (!rawPath.startsWith("/") || rawPath.includes("\\") || rawPath.startsWith("//")) return null;
  const rawSegments = rawPath.split("/").slice(1);
  const trailingSlash = rawSegments.at(-1) === "";
  if (trailingSlash) rawSegments.pop();

  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    const decoded = decodePathSegment(rawSegment);
    if (decoded === null) return null;
    segments.push(decoded);
  }

  const rootCandidate = resolve(exportRoot);
  const requestedPath = resolve(rootCandidate, ...segments);
  const relativePath = relative(rootCandidate, requestedPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null;

  let candidate = requestedPath;
  if (trailingSlash || extname(candidate) === "") candidate = resolve(candidate, "index.html");
  const resolvedRelative = relative(rootCandidate, candidate);
  if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`) || isAbsolute(resolvedRelative)) {
    return null;
  }

  try {
    const safeRoot = await realpath(rootCandidate);
    const safeCandidate = await realpath(candidate);
    const finalRelative = relative(safeRoot, safeCandidate);
    if (finalRelative === ".." || finalRelative.startsWith(`..${sep}`) || isAbsolute(finalRelative)) return null;
    if (!(await stat(safeCandidate)).isFile()) return null;
    return safeCandidate;
  } catch {
    return null;
  }
}
