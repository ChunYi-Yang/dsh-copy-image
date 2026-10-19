/**
 * dsh-copy-image - browser half.
 *
 * What it does
 * ------------
 * DSH's built-in image lightbox renders exactly three things: a mask, the
 * <img>, and a close button. It has no way to get the picture out, so the only
 * route to another app is save-then-drag. This plugin adds a second viewer,
 * opened by clicking a conversation image, whose toolbar can
 *
 *   - copy the image to the OS clipboard as a PNG (the whole point),
 *   - save it to disk,
 *   - and zoom / pan / page through the images of the same message.
 *
 * How the copy works
 * ------------------
 * `navigator.clipboard.write` with a `ClipboardItem` needs a PNG blob, and a
 * blob needs the pixels, and reading pixels needs the image to have been
 * decoded in a non-tainted way. The desktop shell serves the UI from the
 * `dsh-app://app` custom scheme registered with `secure: true` and
 * `corsEnabled: true`, so an `<img crossOrigin="anonymous">` load is both
 * allowed and does not taint the canvas. When that still fails (an http(s)
 * image on a host that sends no CORS header) we fall back to fetching the
 * bytes ourselves, and finally to copying the URL as text so the user is never
 * left with a dead button.
 *
 * Why it never touches DSH's DOM
 * ------------------------------
 * DSH renders the transcript with a React virtual list. Reparenting its nodes
 * makes React throw `removeChild` later, so this module only ever *listens* on
 * the document and draws its overlay into a body portal of its own.
 *
 * @module dsh-copy-image/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-copy-image',
  factory: function (require) {
    'use strict';

    var module = { exports: {} };
    var exports = module.exports;

    /** Marks images this module instance has already wired up. */
    var OWNER = 'dsh-copy-image';
    /** Minimum edge length worth offering copy for; filters icons and avatars. */
    var MIN_EDGE = 32;

    var CSS = [
      '.dci-backdrop{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;',
      'max-width:none!important;max-height:none!important;margin:0!important;z-index:10000!important;',
      'background:rgba(9,12,16,.9);display:flex;align-items:center;justify-content:center;',
      'opacity:0;transition:opacity .16s ease;}',
      '.dci-backdrop[data-open="1"]{opacity:1;}',
      '.dci-stage{position:relative;display:flex;align-items:center;justify-content:center;',
      'width:100%;height:100%;overflow:hidden;}',
      '.dci-mask{position:absolute;inset:0;}',
      '.dci-canvas{max-width:calc(100vw - 48px);max-height:calc(100vh - 96px);',
      'object-fit:contain;cursor:grab;touch-action:none;user-select:none;}',
      '.dci-canvas[data-zoomed="1"]{cursor:grab;}',
      '.dci-canvas[data-dragging="1"]{cursor:grabbing;}',
      '.dci-bar{position:absolute;top:16px;right:16px;display:flex;align-items:center;gap:8px;',
      'padding:6px;border-radius:12px;background:rgba(20,24,30,.86);',
      'box-shadow:0 6px 24px rgba(0,0,0,.42);backdrop-filter:blur(10px);}',
      '.dci-btn{appearance:none;border:0;background:transparent;color:#eef2f6;',
      'font:inherit;font-size:13px;line-height:1;padding:8px 11px;border-radius:8px;',
      'cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}',
      '.dci-btn:hover{background:rgba(255,255,255,.12);}',
      '.dci-btn:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px;}',
      '.dci-btn[disabled]{opacity:.45;cursor:default;}',
      '.dci-btn[data-primary="1"]{background:rgba(94,164,255,.2);}',
      '.dci-sep{width:1px;height:18px;background:rgba(255,255,255,.18);}',
      '.dci-nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;',
      'border-radius:50%;background:rgba(20,24,30,.8);color:#eef2f6;border:0;cursor:pointer;',
      'font-size:18px;line-height:40px;text-align:center;padding:0;}',
      '.dci-nav:hover{background:rgba(40,48,60,.92);}',
      '.dci-nav[data-side="prev"]{left:16px;}',
      '.dci-nav[data-side="next"]{right:16px;}',
      '.dci-caption{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);',
      'max-width:70vw;padding:6px 12px;border-radius:8px;background:rgba(20,24,30,.8);',
      'color:#e7edf4;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dci-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:10001;',
      'padding:9px 16px;border-radius:10px;background:rgba(24,30,38,.95);color:#f2f6fa;',
      'font-size:13px;box-shadow:0 8px 26px rgba(0,0,0,.4);opacity:0;transition:opacity .18s ease;}',
      '.dci-toast[data-visible="1"]{opacity:1;}'
    ].join('');

    var styleInjected = false;
    function injectStyle() {
      if (styleInjected) return;
      try {
        var el = document.createElement('style');
        el.setAttribute('data-dsh-copy-image', '');
        el.textContent = CSS;
        (document.head || document.documentElement).appendChild(el);
        styleInjected = true;
      } catch (e) { /* styling is cosmetic; never break the app over it */ }
    }

    // ------------------------------------------------------------------ toast
    var toastEl = null;
    var toastTimer = 0;
    function toast(message) {
      try {
        injectStyle();
        if (!toastEl || !toastEl.isConnected) {
          toastEl = document.createElement('div');
          toastEl.className = 'dci-toast';
          toastEl.setAttribute('role', 'status');
          toastEl.setAttribute('aria-live', 'polite');
          document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        toastEl.setAttribute('data-visible', '1');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
          if (toastEl) toastEl.setAttribute('data-visible', '0');
        }, 2600);
      } catch (e) { /* ignore */ }
    }

    // --------------------------------------------------------------- decoding
    /**
     * Load an image without tainting the canvas.
     * @param {string} src image URL.
     * @param {boolean} cors request it as CORS-visible.
     * @returns {Promise<HTMLImageElement>}
     */
    function loadImage(src, cors) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        if (cors) img.crossOrigin = 'anonymous';
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = src;
      });
    }

    /** @param {HTMLImageElement} img @returns {Promise<Blob>} PNG bytes. */
    function toPngBlob(img) {
      return new Promise(function (resolve, reject) {
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, img.naturalWidth || img.width);
        canvas.height = Math.max(1, img.naturalHeight || img.height);
        var ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas unavailable')); return; }
        // PNG sources keep alpha; JPEG/BMP get an opaque white matte so the
        // pasted result does not turn black in apps that ignore transparency.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('png encode failed'));
        }, 'image/png');
      });
    }

    /**
     * Build the PNG blob for a source, trying every route that can work.
     * @param {string} src image URL.
     * @returns {Promise<Blob>}
     */
    async function exportPng(src) {
      var failures = [];
      // 1. CORS-visible load: the normal path under dsh-app:// and http(s)
      //    origins that send Access-Control-Allow-Origin.
      try {
        return await toPngBlob(await loadImage(src, true));
      } catch (e) { failures.push('cors:' + e.message); }
      // 2. Same bytes, fetched and decoded from a blob: URL. Covers servers
      //    that omit CORS headers but are still reachable.
      try {
        var res = await fetch(src, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var raw = await res.blob();
        var url = URL.createObjectURL(raw);
        try {
          return await toPngBlob(await loadImage(url, false));
        } finally {
          setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        }
      } catch (e) { failures.push('fetch:' + e.message); }
      // 3. Plain load: works for any same-origin image, taints the canvas.
      //    Only reached when both routes above failed, so it is last resort;
      //    it still cannot be copied (toBlob throws) and is caught here.
      try {
        return await toPngBlob(await loadImage(src, false));
      } catch (e) { failures.push('plain:' + e.message); }
      throw new Error('无法读取图片像素（' + failures.join('; ') + '）');
    }

    /** @returns {Promise<boolean>} whether the PNG reached the clipboard. */
    async function writeClipboard(blob) {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch (e) {
        return false;
      }
    }

    // ----------------------------------------------------------------- viewer
    /** @type {{imgs: HTMLImageElement[], index: number, src: string, alt: string}|null} */
    var state = null;
    var backdrop = null;
    var canvasEl = null;
    var captionEl = null;
    var prevBtn = null;
    var nextBtn = null;
    var copyBtn = null;
    var saveBtn = null;
    var zoom = 1;
    var panX = 0;
    var panY = 0;
    var dragging = false;
    var dragStart = null;
    var lastFocused = null;

    function filenameFor(src, alt) {
      var name = String(alt || '').trim();
      if (!name) {
        try {
          var path = new URL(src, location.href).pathname.split('/').pop() || '';
          name = decodeURIComponent(path);
        } catch (e) { name = ''; }
      }
      name = name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'image';
      return /\.[a-z0-9]{2,5}$/i.test(name) ? name.replace(/\.[a-z0-9]{2,5}$/i, '.png') : name + '.png';
    }

    function applyTransform() {
      if (!canvasEl) return;
      canvasEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
      canvasEl.setAttribute('data-zoomed', zoom > 1.001 ? '1' : '0');
    }

    function resetTransform() {
      zoom = 1; panX = 0; panY = 0;
      applyTransform();
    }

    function render() {
      if (!state || !canvasEl) return;
      resetTransform();
      canvasEl.src = state.src;
      canvasEl.alt = state.alt;
      if (captionEl) {
        var total = state.imgs.length;
        captionEl.textContent = total > 1
          ? (state.alt || 'image') + '  (' + (state.index + 1) + '/' + total + ')'
          : (state.alt || '');
      }
      var multi = state.imgs.length > 1;
      if (prevBtn) prevBtn.style.display = multi ? '' : 'none';
      if (nextBtn) nextBtn.style.display = multi ? '' : 'none';
    }

    function step(delta) {
      if (!state || state.imgs.length < 2) return;
      var n = state.imgs.length;
      // Walk the group, skipping entries that failed to yield a usable src.
      for (var i = 1; i <= n; i++) {
        var next = (state.index + delta * i + n * i) % n;
        var img = state.imgs[next];
        if (img && img.src) {
          state.index = next;
          state.src = img.src;
          state.alt = img.alt || '';
          render();
          return;
        }
      }
    }

    async function doCopy() {
      if (!state || !copyBtn) return;
      var src = state.src;
      copyBtn.disabled = true;
      var original = copyBtn.textContent;
      copyBtn.textContent = '复制中…';
      try {
        var blob = await exportPng(src);
        var ok = await writeClipboard(blob);
        if (ok) {
          toast('已复制图片到剪贴板');
        } else {
          // Clipboard API unavailable or denied. Hand the user the URL rather
          // than leaving them with nothing.
          var copied = false;
          try { await navigator.clipboard.writeText(src); copied = true; } catch (e) { copied = false; }
          toast(copied ? '无法写入图片，已改为复制图片地址' : '复制失败：剪贴板不可用');
        }
      } catch (e) {
        toast('复制失败：' + (e && e.message ? e.message : '未知错误'));
      } finally {
        copyBtn.disabled = false;
        copyBtn.textContent = original;
      }
    }

    async function doSave() {
      if (!state || !saveBtn) return;
      saveBtn.disabled = true;
      var original = saveBtn.textContent;
      saveBtn.textContent = '保存中…';
      try {
        var blob = await exportPng(state.src);
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filenameFor(state.src, state.alt);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      } catch (e) {
        toast('保存失败：' + (e && e.message ? e.message : '未知错误'));
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = original;
      }
    }

    function onWheel(e) {
      if (!canvasEl) return;
      e.preventDefault();
      var delta = e.deltaY < 0 ? 0.2 : -0.2;
      zoom = Math.min(8, Math.max(1, zoom + delta));
      if (zoom === 1) { panX = 0; panY = 0; }
      applyTransform();
    }

    function onPointerDown(e) {
      if (!canvasEl || zoom <= 1.001 || e.button !== 0) return;
      dragging = true;
      dragStart = { x: e.clientX - panX, y: e.clientY - panY };
      canvasEl.setAttribute('data-dragging', '1');
    }

    function onPointerMove(e) {
      if (!dragging) return;
      panX = e.clientX - dragStart.x;
      panY = e.clientY - dragStart.y;
      applyTransform();
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      if (canvasEl) canvasEl.removeAttribute('data-dragging');
    }

    function onKey(e) {
      if (!state) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowLeft') { e.stopPropagation(); step(-1); return; }
      if (e.key === 'ArrowRight') { e.stopPropagation(); step(1); return; }
      if (e.key === '0') { e.stopPropagation(); resetTransform(); return; }
    }

    function buildViewer() {
      injectStyle();
      backdrop = document.createElement('div');
      backdrop.className = 'dci-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-label', '图片查看器');
      backdrop.setAttribute('data-open', '0');

      var stage = document.createElement('div');
      stage.className = 'dci-stage';

      var mask = document.createElement('div');
      mask.className = 'dci-mask';
      mask.addEventListener('mousedown', close);

      canvasEl = document.createElement('img');
      canvasEl.className = 'dci-canvas';
      canvasEl.draggable = false;
      canvasEl.addEventListener('wheel', onWheel, { passive: false });
      canvasEl.addEventListener('pointerdown', onPointerDown);
      // Pointer move/up go on the document, not window: the drag has to keep
      // tracking when the cursor leaves the image, and a document listener is
      // the one target every host (browser, Electron, embedded webview) has.
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      canvasEl.addEventListener('dblclick', function () {
        zoom = zoom > 1.001 ? 1 : 2;
        panX = 0; panY = 0;
        applyTransform();
      });

      var bar = document.createElement('div');
      bar.className = 'dci-bar';

      copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'dci-btn';
      copyBtn.setAttribute('data-primary', '1');
      copyBtn.textContent = '复制';
      copyBtn.title = '复制图片到剪贴板 (Ctrl+C)';
      copyBtn.addEventListener('click', doCopy);

      saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'dci-btn';
      saveBtn.textContent = '保存';
      saveBtn.title = '保存为 PNG';
      saveBtn.addEventListener('click', doSave);

      var zoomOut = document.createElement('button');
      zoomOut.type = 'button';
      zoomOut.className = 'dci-btn';
      zoomOut.textContent = '−';
      zoomOut.title = '缩小';
      zoomOut.addEventListener('click', function () {
        zoom = Math.max(1, zoom - 0.25); if (zoom === 1) { panX = 0; panY = 0; } applyTransform();
      });

      var fitBtn = document.createElement('button');
      fitBtn.type = 'button';
      fitBtn.className = 'dci-btn';
      fitBtn.textContent = '1×';
      fitBtn.title = '适应窗口 (0)';
      fitBtn.addEventListener('click', resetTransform);

      var zoomIn = document.createElement('button');
      zoomIn.type = 'button';
      zoomIn.className = 'dci-btn';
      zoomIn.textContent = '+';
      zoomIn.title = '放大';
      zoomIn.addEventListener('click', function () {
        zoom = Math.min(8, zoom + 0.25); applyTransform();
      });

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'dci-btn';
      closeBtn.textContent = '✕';
      closeBtn.title = '关闭 (Esc)';
      closeBtn.addEventListener('click', close);

      var sep1 = document.createElement('span'); sep1.className = 'dci-sep';
      var sep2 = document.createElement('span'); sep2.className = 'dci-sep';

      [copyBtn, saveBtn, sep1, zoomOut, fitBtn, zoomIn, sep2, closeBtn]
        .forEach(function (node) { bar.appendChild(node); });

      prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'dci-nav';
      prevBtn.setAttribute('data-side', 'prev');
      prevBtn.textContent = '‹';
      prevBtn.title = '上一张 (←)';
      prevBtn.addEventListener('click', function () { step(-1); });

      nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'dci-nav';
      nextBtn.setAttribute('data-side', 'next');
      nextBtn.textContent = '›';
      nextBtn.title = '下一张 (→)';
      nextBtn.addEventListener('click', function () { step(1); });

      captionEl = document.createElement('div');
      captionEl.className = 'dci-caption';

      stage.appendChild(mask);
      stage.appendChild(canvasEl);
      stage.appendChild(bar);
      stage.appendChild(prevBtn);
      stage.appendChild(nextBtn);
      stage.appendChild(captionEl);
      backdrop.appendChild(stage);
      document.body.appendChild(backdrop);
    }

    function open(imgs, index) {
      if (!backdrop) buildViewer();
      var img = imgs[index];
      if (!img || !img.src) return;
      lastFocused = document.activeElement;
      state = { imgs: imgs, index: index, src: img.src, alt: img.alt || '' };
      render();
      backdrop.setAttribute('data-open', '1');
      document.addEventListener('keydown', onKey, true);
      // Focus the copy button: it is the reason this viewer exists.
      try { copyBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    function close() {
      if (!backdrop) return;
      backdrop.setAttribute('data-open', '0');
      document.removeEventListener('keydown', onKey, true);
      state = null;
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
    }

    // ------------------------------------------------------------- detection
    /**
     * True when the image lives inside the transcript rather than the shell
     * chrome (account avatar, sidebar glyphs, toolbars).
     * @param {HTMLImageElement} img
     * @returns {boolean}
     */
    function isConversationImage(img) {
      try {
        if (img.closest("[class*='avatar'],[class*='Avatar'],[class*='sidebar'],[class*='Sidebar']," +
                        "[class*='toolbar'],[class*='Toolbar'],[class*='navRail'],[class*='NavRail']," +
                        "[class*='dci-']")) return false;
        var el = img.parentElement;
        var hops = 0;
        while (el && el !== document.body && hops++ < 14) {
          var cn = typeof el.className === 'string' ? el.className : '';
          if (/(message|chat|conversation|bubble|turn|markdown|prose|flowItem|callRow|thread|transcript)/i.test(cn)) {
            return true;
          }
          var role = el.getAttribute ? (el.getAttribute('role') || '') : '';
          if (role === 'log' || role === 'list' || role === 'article' || role === 'main') return true;
          if (el.tagName === 'ARTICLE' || el.tagName === 'MAIN') return true;
          el = el.parentElement;
        }
        return false;
      } catch (e) { return false; }
    }

    /** @param {HTMLImageElement} img @returns {boolean} */
    function wantsImage(img) {
      if (!img || !img.src) return false;
      if (img.dataset.dciOwner === OWNER) return false;
      if (img.closest('[class*="dci-"]')) return false;
      if (img.src.indexOf('data:image/svg') === 0) return false;
      if (!isConversationImage(img)) return false;
      if (img.naturalWidth > 0 && (img.naturalWidth < MIN_EDGE || img.naturalHeight < MIN_EDGE)) return false;
      return true;
    }

    /**
     * The images the clicked one should page through: everything in the same
     * message, in DOM order. Computed at click time so React re-renders cannot
     * leave a stale list behind.
     * @param {HTMLImageElement} target
     * @returns {HTMLImageElement[]}
     */
    function groupOf(target) {
      var all = Array.prototype.slice
        .call(document.querySelectorAll('img'))
        .filter(wantsImage);
      var box = null;
      var el = target.parentElement;
      var hops = 0;
      while (el && el !== document.body && hops++ < 8) {
        var cn = typeof el.className === 'string' ? el.className : '';
        if (/(message|bubble|markdown|prose|gallery)/i.test(cn)) { box = el; break; }
        el = el.parentElement;
      }
      if (!box) return [target];
      var inner = all.filter(function (img) { return box.contains(img); });
      return inner.length ? inner : [target];
    }

    /** Swallow the click so DSH's own lightbox cannot take over afterwards. */
    function onClick(e) {
      var img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      if (img.dataset.dciOwner !== OWNER) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      var group = groupOf(img);
      var index = group.indexOf(img);
      open(group, index < 0 ? 0 : index);
    }

    /** Mark every eligible image; called on mutations and on a slow poll. */
    function scan() {
      try {
        var imgs = document.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var img = imgs[i];
          if (!wantsImage(img)) continue;
          img.dataset.dciOwner = OWNER;
          img.style.cursor = 'zoom-in';
          img.title = img.title || '点击查看并复制图片';
        }
      } catch (e) { /* never break the transcript over a scan */ }
    }

    // ------------------------------------------------------------------ wiring
    exports.inject = ['slots'];

    exports.apply = function (ctx) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return;
      injectStyle();

      // Capture phase: DSH's own attachment view registers a click handler on
      // the image; intercepting before it runs is what lets our viewer win.
      document.addEventListener('click', onClick, true);

      var scheduled = 0;
      function scheduleScan() {
        if (scheduled) return;
        scheduled = setTimeout(function () { scheduled = 0; scan(); }, 120);
      }

      var start = function () {
        scan();
        try {
          var observer = new MutationObserver(scheduleScan);
          observer.observe(document.body, { childList: true, subtree: true });
        } catch (e) { /* fall back to polling only */ }
        // Belt and braces: React's virtual list can recycle nodes without a
        // mutation we notice, so re-scan on a slow timer.
        setInterval(scheduleScan, 4000);
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        setTimeout(start, 300);
      }
    };

    return module.exports;
  }
});