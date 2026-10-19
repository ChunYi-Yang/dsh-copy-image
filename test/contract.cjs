// Contract test for dsh-copy-image/lib/client.js
// Runs the real bundle against a fake window/__ModuleLoader__/DOM and proves:
//   1. the bundle registers through __ModuleLoader__.load,
//   2. it exports inject/apply in the shape the DSH loader expects,
//   3. it marks conversation images and ignores avatar / tiny-icon chrome,
//   4. clicking a marked image opens the viewer and reaching "copy" really
//      produces a PNG blob and calls navigator.clipboard.write.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? "  -> " + extra : "")); }
}

// ------------------------------------------------------------------ fake DOM
let bodyChildren = [];
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(),
    style: {}, dataset: {}, attributes: {}, children: [],
    parentElement: null, isConnected: true,
    textContent: "", title: "", src: "",
    naturalWidth: 800, naturalHeight: 600,
    className: "", _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; if (k === "class") this.className = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    remove() { this.isConnected = false; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    click() { (this._listeners.click || []).forEach((f) => f({ target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} })); },
    closest(sel) {
      let n = this;
      while (n) {
        const cls = typeof n.className === "string" ? n.className : "";
        if (sel.indexOf("[class*='avatar']") >= 0 && /avatar/i.test(cls)) return n;
        if (sel.indexOf("[class*='sidebar']") >= 0 && /sidebar/i.test(cls)) return n;
        if (sel.indexOf('[class*="dci-"]') >= 0 && /dci-/.test(cls)) return n;
        n = n.parentElement;
      }
      return null;
    },
    contains(o) { let n = o; while (n) { if (n === this) return true; n = n.parentElement; } return false; },
    focus() {}, querySelectorAll() { return []; },
  };
  return e;
}

const registry = { images: [] };
const docListeners = {};
const clickHandlers = [];
const keyHandlers = [];

const fakeDocument = {
  readyState: "complete",
  head: el("head"),
  documentElement: el("html"),
  body: el("body"),
  activeElement: null,
  createElement: (t) => el(t),
  addEventListener(type, fn) {
    if (type === "click") clickHandlers.push(fn);
    if (type === "keydown") keyHandlers.push(fn);
    (docListeners[type] = docListeners[type] || []).push(fn);
  },
  removeEventListener(type, fn) {
    const l = docListeners[type];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  },
  querySelectorAll(sel) { return sel === "img" ? registry.images : []; },
};
fakeDocument.head.appendChild = function (c) { this.children.push(c); return c; };

function chatImage(src, cls) {
  const msg = el("div"); msg.className = cls || "message markdown";
  const img = el("img"); img.src = src; img.alt = "chart";
  msg.appendChild(img);
  registry.images.push(img);
  return img;
}

// -------------------------------------------------------------- fake browser
const clipboardWrites = [];
let pngEncoded = 0;
const fakeNavigator = {
  clipboard: {
    write: async (items) => { clipboardWrites.push(items); },
    writeText: async () => { throw new Error("denied"); },
  },
};
class ClipboardItemShim { constructor(o) { this._o = o; } }

function FakeImage() {
  this.onload = null; this.onerror = null; this.naturalWidth = 800; this.naturalHeight = 600;
}
Object.defineProperty(FakeImage.prototype, "src", {
  set(v) { this._src = v; if (this.onload) setImmediate(() => this.onload()); },
  get() { return this._src; },
});

const sandbox = {
  document: fakeDocument,
  navigator: fakeNavigator,
  ClipboardItem: ClipboardItemShim,
  MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} },
  setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
  clearTimeout: () => {},
  setInterval: () => 0,
  setImmediate: (fn) => setImmediate(fn),
  console, fetch: async () => ({ ok: true, blob: async () => ({}) }),
  URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
  Image: FakeImage,
  Array, Promise, Error, Math, JSON, Object, String, Number, RegExp, Set, Map,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

// --------------------------------------------------------------- build images
const good = chatImage("dsh-app://app/api/file/img1.png", "message markdown");
const good2 = chatImage("dsh-app://app/api/file/img2.png", "message markdown");
const avatar = chatImage("dsh-app://app/avatar.png", "userAvatar");
const sidebarIcon = chatImage("dsh-app://app/glyph.png", "sidebarItem");
const tiny = chatImage("dsh-app://app/icon.png", "message");
tiny.naturalWidth = 16; tiny.naturalHeight = 16;

// ------------------------------------------------------------------ run plugin
console.log("=== load bundle ===");
const loaderCalls = [];
sandbox.__ModuleLoader__ = { load(o) { loaderCalls.push(o); } };
vm.runInContext(src, sandbox, { filename: "client.js" });

ok("bundle called __ModuleLoader__.load exactly once", loaderCalls.length === 1);
const entry = loaderCalls[0];
ok("module id is dsh-copy-image", entry.id === "dsh-copy-image");
ok("factory is a function", typeof entry.factory === "function");

const mod = entry.factory((name) => {
  if (name === "react") return { createElement: () => null };
  throw new Error("unexpected require: " + name);
});
ok("exports.inject is an array", Array.isArray(mod.inject));
ok("exports.inject contains slots", mod.inject.indexOf("slots") >= 0);
ok("exports.apply is a function", typeof mod.apply === "function");

console.log("=== apply + detection ===");
mod.apply({ slots: { inject() {}, register() {} } });

ok("conversation image marked", good.dataset.dciOwner === "dsh-copy-image");
ok("second conversation image marked", good2.dataset.dciOwner === "dsh-copy-image");
ok("avatar NOT marked", avatar.dataset.dciOwner === undefined);
ok("sidebar glyph NOT marked", sidebarIcon.dataset.dciOwner === undefined);
ok("tiny icon NOT marked", tiny.dataset.dciOwner === undefined);
ok("capture-phase click handler registered", clickHandlers.length >= 1);

console.log("=== viewer opens on click ===");
const click = clickHandlers[0];
let prevented = false;
click({
  target: good,
  preventDefault() { prevented = true; },
  stopPropagation() {},
  stopImmediatePropagation() {},
});
ok("default was prevented (DSH own lightbox suppressed)", prevented);
const backdrop = fakeDocument.body.children.find((c) => /dci-backdrop/.test(c.className));
ok("viewer overlay appended to body", !!backdrop);
ok("viewer is marked open", backdrop && backdrop.getAttribute("data-open") === "1");
ok("viewer has role=dialog", backdrop && backdrop.getAttribute("role") === "dialog");

console.log("=== copy path ===");
// The viewer builds its toolbar; find the copy button (has data-primary).
function walk(node, out) {
  out = out || [];
  (node.children || []).forEach((c) => { out.push(c); walk(c, out); });
  return out;
}
const nodes = walk(backdrop);
const copyBtn = nodes.find((n) => n.getAttribute && n.getAttribute("data-primary") === "1");
ok("copy button exists", !!copyBtn);

// Canvas is not available in this sandbox; stub it so toPngBlob resolves and
// the test can assert the clipboard route instead of the canvas route.
sandbox.fetch = async () => ({ ok: true, blob: async () => ({ size: 10 }) });
const origCreate = fakeDocument.createElement;
fakeDocument.createElement = function (tag) {
  const node = origCreate.call(fakeDocument, tag);
  if (tag === "canvas") {
    node.getContext = () => ({ fillStyle: "", fillRect() {}, drawImage() {} });
    node.toBlob = (cb) => { pngEncoded++; cb({ size: 1234, type: "image/png" }); };
  }
  return node;
};
copyBtn && copyBtn.click();
setTimeout(() => {
  ok("canvas encoded a PNG", pngEncoded === 1);
  ok("navigator.clipboard.write called once", clipboardWrites.length === 1);
  const item = clipboardWrites[0] && clipboardWrites[0][0];
  ok("clipboard got a ClipboardItem with image/png",
      !!item && !!item._o && !!item._o["image/png"]);
  console.log("");
  console.log("RESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
}, 50);