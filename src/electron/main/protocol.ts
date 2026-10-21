import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { resolveAppAsset } from "./security";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

interface ProtocolRequestLike {
  method: string;
  url: string;
}

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return [...new Set(hashes)];
}

export function contentSecurityPolicy(html = ""): string {
  const inlineHashes = inlineScriptHashes(html);
  const scriptPolicy = ["'self'", ...inlineHashes].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptPolicy}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

export async function serveAppProtocolRequest(
  request: ProtocolRequestLike,
  exportRoot: string,
): Promise<Response> {
  const securityHeaders = {
    "content-security-policy": contentSecurityPolicy(),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  const isHeadRequest = request.method === "HEAD";
  if (request.method !== "GET" && !isHeadRequest) {
    return new Response("Method not allowed", { status: 405, headers: securityHeaders });
  }

  const asset = await resolveAppAsset(request.url, exportRoot);
  if (!asset) return new Response("Not found", { status: 404, headers: securityHeaders });

  try {
    const body = await readFile(asset);
    const isHtml = extname(asset).toLowerCase() === ".html";
    const headers = {
      ...securityHeaders,
      "content-type": CONTENT_TYPES[extname(asset).toLowerCase()] ?? "application/octet-stream",
      ...(isHtml ? { "content-security-policy": contentSecurityPolicy(body.toString("utf8")) } : {}),
    };
    return new Response(isHeadRequest ? null : body, { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404, headers: securityHeaders });
  }
}
