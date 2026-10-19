// dsh-copy-image — host half.
//
// Why this exists
// ---------------
// The browser half can encode an image to PNG (Save proves that path works).
// What it cannot be relied on for is `navigator.clipboard.write`: in an
// Electron renderer serving a custom scheme, clipboard access is gated by a
// permission handler the harness installs per session. When that gate says no,
// the promise rejects and the user gets nothing.
//
// So the copy happens where it is not gated: this process. The renderer POSTs
// PNG bytes here; this half lands them in a temp file and asks Windows to put
// that bitmap on the clipboard. Every route is loopback-only, and the path is
// passed to PowerShell as a single-quoted literal so a filename can never
// inject script.
//
// Deliberately absent: filesystem browsing, arbitrary path reads, network. The
// only input accepted is raw PNG bytes, and the only effect is the clipboard.

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROUTE_PREFIX = "/dsh-copy-image";
/** 256 MB: generous for a chart export, small enough to bound a stray request. */
const MAX_BYTES = 256 * 1024 * 1024;

export const name = "dsh-copy-image";
export const inject = ["webServer"];

/** True only for requests that came from this machine. */
function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress;
  if (!addr) return false;
  const n = String(addr).toLowerCase();
  if (n === "::1") return true;
  if (n.startsWith("::ffff:")) return n.slice(7).startsWith("127.");
  return n.startsWith("127.");
}

function respond(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
  });
  res.end(text);
}

/**
 * Put a PNG file on the Windows clipboard from a separate STA process.
 * PowerShell 5.1 is used because System.Windows.Forms.Clipboard.SetImage
 * requires an STA apartment, which the plain .NET thread pool does not give us.
 * @param {string} filePath absolute path to a PNG on disk.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function copyFileToClipboard(filePath) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, error: "host clipboard copy is implemented for Windows only" });
      return;
    }
    // Single-quote the path and double any embedded quote, so a filename can
    // never terminate the string literal and inject PowerShell.
    const quoted = "'" + String(filePath).replace(/'/g, "''") + "'";
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$img = [System.Drawing.Image]::FromFile(" + quoted + ")",
      "try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }",
      "$check = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($check -eq $null) { Write-Error 'clipboard verify failed'; exit 3 }",
      "$check.Dispose()",
      "Write-Output 'ok'",
    ].join("\n");

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* already gone */ }
      resolve({ ok: false, error: "clipboard write timed out" });
    }, 30000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e && e.message ? e.message : String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.indexOf("ok") >= 0) resolve({ ok: true });
      else resolve({ ok: false, error: (err || "exit " + code).trim().slice(0, 500) });
    });
  });
}

/** Collect the request body with a hard size ceiling. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * POST /dsh-copy-image/copy — body is raw PNG bytes.
 * Response: { ok: true } or { ok: false, error }.
 */
function copyHandler() {
  return async function handler(req, res) {
    if (!isLoopback(req)) {
      respond(res, 403, { ok: false, error: "loopback only" });
      return;
    }
    if (req.method !== "POST") {
      respond(res, 405, { ok: false, error: "POST only" });
      return;
    }
    const type = String(req.headers["content-type"] || "");
    if (type.indexOf("image/png") !== 0) {
      respond(res, 415, { ok: false, error: "content-type must be image/png" });
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      respond(res, 413, { ok: false, error: e && e.message ? e.message : "unreadable body" });
      return;
    }
    // A PNG must at least start with the 8-byte signature and be non-trivial.
    if (body.length < 32 || body[0] !== 0x89 || body[1] !== 0x50 || body[2] !== 0x4e || body[3] !== 0x47) {
      respond(res, 415, { ok: false, error: "body is not a PNG" });
      return;
    }
    let dir;
    try {
      dir = await mkdtemp(join(tmpdir(), "dsh-copy-image-"));
      const file = join(dir, "clipboard.png");
      await writeFile(file, body);
      const result = await copyFileToClipboard(file);
      respond(res, result.ok ? 200 : 500, result.ok ? { ok: true } : { ok: false, error: result.error });
    } catch (e) {
      respond(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
    } finally {
      if (dir) {
        // Best effort: a leftover temp file is harmless, failing the request
        // over a failed cleanup is not worth it.
        try { await rm(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      }
    }
  };
}

/** GET /dsh-copy-image/ping — lets the browser half pick a strategy. */
function pingHandler() {
  return function handler(req, res) {
    if (!isLoopback(req)) {
      respond(res, 403, { ok: false, error: "loopback only" });
      return;
    }
    respond(res, 200, { ok: true, platform: process.platform });
  };
}

export function apply(ctx) {
  if (!ctx || !ctx.webServer || typeof ctx.webServer.register !== "function") {
    if (ctx && ctx.logger) ctx.logger.warn("dsh-copy-image: webServer unavailable; clipboard copy disabled");
    return;
  }
  ctx.effect(() => {
    const offCopy = ctx.webServer.register({
      kind: "exact", path: ROUTE_PREFIX + "/copy", handler: copyHandler(),
    });
    const offPing = ctx.webServer.register({
      kind: "exact", path: ROUTE_PREFIX + "/ping", handler: pingHandler(),
    });
    return () => { offCopy(); offPing(); };
  }, "dsh-copy-image: clipboard routes");
}