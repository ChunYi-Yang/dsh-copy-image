# dsh-copy-image

**Copy any image out of a DeepSeek Harness conversation — one click, straight to the clipboard.**

[中文](#中文) | [English](#english)

> **The problem.** DSH renders chat pictures, but the built-in lightbox has a mask, the picture, and a close button — nothing else. There is no way to get the picture out except save-then-drag. Copy works for text (it is a normal selection) and not for images.
>
> **The fix.** This plugin adds a viewer that opens on click and puts **复制 / Copy** where you expect it.

---

## English

### What you get

Click any image in the transcript and a full-screen viewer opens with:

| Control | What it does |
| --- | --- |
| **复制 / Copy** | Encodes the image to PNG and writes it to the OS clipboard |
| **保存 / Save** | Saves it as a PNG file |
| **− / 1× / +** | Zoom 1×–8×, with wheel zoom and drag-to-pan when zoomed |
| **‹ / ›** | Page through the other images of the same message |
| **✕ / Esc** | Close |

The overlay never moves or reparents DSH's DOM nodes — it only listens on the document and draws into its own body portal. That is deliberate: DSH renders the transcript with a React virtual list, and reparenting its nodes makes React throw `removeChild` afterwards.

### Why copying works here

Two separate problems had to be solved, and the first version of this plugin only solved one of them.

**Getting the pixels.** `toBlob` needs a PNG blob, a blob needs a decoded image, and reading pixels needs the canvas to stay untainted. The desktop shell serves the UI from the `dsh-app://app` custom scheme (`secure: true`, `corsEnabled: true`), so an `<img crossOrigin="anonymous">` load is allowed. Three routes are tried in order — CORS-visible load, then `fetch` + `blob:` decode, then a plain load — so that Save keeps working even on hosts that send no CORS header.

**Writing the clipboard.** This is the part that failed. In an Electron renderer the harness installs a per-session permission handler, and `navigator.clipboard.write` rejects when it says no. The rejection is silent from the user's point of view: the button appears to do nothing.

The fix is to write the clipboard from the **host process**, which is not behind that gate:

```
renderer  --POST /dsh-copy-image/copy  (image/png body)-->  host
host      writes a temp PNG, runs a short STA PowerShell that calls
          System.Windows.Forms.Clipboard.SetImage, verifies by reading
          the image back, deletes the temp file, returns {ok:true}
```

`navigator.clipboard.write` is still attempted as a fallback, for the plain-browser profile where no host route exists.

### Install

**From GitHub (recommended, no registry needed):**

```sh
dsh plugin --profile desktop add github:447662/dsh-copy-image
```

**In the GUI:** sidebar **Plugins → Add plugin**, paste `github:447662/dsh-copy-image`, install.

**Local checkout (for development — edits take effect on page refresh):**

```sh
dsh plugin --profile desktop add link:/absolute/path/to/dsh-copy-image
```

Then **fully quit DSH and reopen** (closing the window is not enough — background processes keep the old bundle loaded).

### Requirements

- DSH kernel `>= 0.1.7-rc.1`. Verified against `0.2.1-rc.2`.
- Desktop shell or web profile. The copy path prefers the `dsh-app://app` scheme; in a plain browser tab on `http://127.0.0.1`, clipboard writes require the secure-context allowance that localhost has.

### Fixed in 0.2.0

- **The page froze after using the viewer.** The closed overlay was hidden with `opacity: 0` only, so the invisible full-viewport backdrop still swallowed every click and drag — the app looked dead, and neither Esc nor scrolling helped. It is now `display: none` + `pointer-events: none` while closed.
- **Copy did nothing.** See "Why copying works here" — the clipboard is now written host-side.
- **Right-click froze the viewer.** Only a left click opens the viewer now; right and middle clicks are left alone.

### Known limitations

- **SVG images are skipped.** Rasterising them needs a serializer that is not worth the byte count here; use the right-click "save image" on the original instead.
- **Very large images may be slow to copy.** The whole picture is re-encoded at native resolution; a 200-megapixel PNG takes a moment.
- **The original lightbox is replaced, not augmented.** Clicking an image opens this viewer instead of DSH's. Uninstalling restores the original behaviour immediately.
- **No right-click menu.** Copy lives on the viewer toolbar, which is where a picture can actually be read from.

### Layout

```
dsh-copy-image/
├── package.json          name = loader row = module id
├── cordis.patch.yml      the bundle row that mounts this plugin
├── lib/index.js          host half — loopback /copy route that writes the clipboard
├── lib/client.js         browser half — detection, viewer, canvas export, clipboard
├── locale/{en,zh}.json   plugin-card title and description
└── test/contract.cjs     runs the real bundle against a fake DOM
```

### Test

```sh
node test/contract.cjs
```

25 assertions: loader registration, export shape, conversation-image detection (avatar, sidebar glyph and 16×16 icons must be ignored), viewer opens with the default click suppressed, the copy button really POSTs to the host route, and a regression guard that the closed overlay is `display:none` + `pointer-events:none` so it cannot block the page again.

### Privacy

The host half registers two loopback-only routes (`/copy`, `/ping`). `/copy` accepts PNG bytes, writes a temp file, runs PowerShell to put it on the clipboard, then deletes the temp file. It takes no caller-supplied path, reads no other file and makes no network calls. The browser half only reads image URLs DSH has already rendered. Nothing is sent anywhere.

### License

MIT.

---

## 中文

**把 DeepSeek Harness 对话里的图片一键复制到剪贴板。**

### 背景

DSH 的对话能显示图片，但内置灯箱里只有一个遮罩、一张图和一颗关闭按钮——没有任何把图取出来的方式，只能"先保存再拖进别的软件"。文字能复制（那是正常的选区），图片不能。

这个插件补上的就是那个缺掉的按钮。

### 功能

点击对话里的任意图片，打开全屏查看器：

| 控件 | 作用 |
| --- | --- |
| **复制** | 把图片编码成 PNG 写进系统剪贴板 |
| **保存** | 存成 PNG 文件 |
| **− / 1× / +** | 1×–8× 缩放；放大后可滚轮缩放、拖拽平移 |
| **‹ / ›** | 在同一条消息的其他图片之间翻页 |
| **✕ / Esc** | 关闭 |

浮层**绝不移动或重挂 DSH 的 DOM 节点**，只监听 document、把界面画进自己的 body portal。这是刻意的：DSH 用 React 虚拟列表渲染对话，重挂它的节点会让 React 之后抛 `removeChild`。

### 为什么这里能复制

这里其实是两个问题，第一版只解决了一个。

**把像素拿出来。** `toBlob` 需要 PNG blob，blob 需要已解码的图片，读像素需要 canvas 不被污染。桌面端把界面跑在 `dsh-app://app` 自定义协议下（`secure: true` + `corsEnabled: true`），所以 `<img crossOrigin="anonymous">` 加载是被允许的。按顺序试三条通路——CORS 可见加载、`fetch` + `blob:` 解码、普通加载——所以即使图源不发 CORS 头，「保存」也能用。

**把剪贴板写进去。** 这才是当初失败的地方。Electron 渲染进程里，宿主装了按会话生效的权限处理器，一旦它拒绝，`navigator.clipboard.write` 就直接 reject；从用户角度看就是按钮完全没反应。

解决方式是把剪贴板写入交给**宿主进程**，它不受那道权限门约束：

```
渲染进程  --POST /dsh-copy-image/copy（body 是 image/png）-->  宿主
宿主      写临时 PNG → 起一个 STA 的 PowerShell 调
          System.Windows.Forms.Clipboard.SetImage → 读回校验 →
          删临时文件 → 返回 {ok:true}
```

`navigator.clipboard.write` 仍作为兜底保留，供纯浏览器 profile 使用（那里没有宿主路由）。

### 安装

**从 GitHub 安装（推荐，不需要发布到 npm）：**

```sh
dsh plugin --profile desktop add github:447662/dsh-copy-image
```

**在界面里装：** 侧栏 **Plugins → 添加插件**，粘贴 `github:447662/dsh-copy-image`，点安装。

**本地目录安装（开发用，改完刷新页面即生效）：**

```sh
dsh plugin --profile desktop add link:/绝对/路径/dsh-copy-image
```

装完**必须彻底退出 DSH 再重开**——只关窗口不算，后台进程会留着旧 bundle。

### 已知限制

- **跳过 SVG 图片**：栅格化 SVG 需要一个序列化器，为此增加体积不划算；请对 SVG 原图用右键另存。
- **超大图复制会慢**：整图按原始分辨率重新编码，两亿像素的 PNG 要等一下。
- **替换而非叠加原生灯箱**：点图打开的是本插件的查看器，不再是 DSH 的。卸载即恢复原行为。
- **不做右键菜单**：复制按钮放在查看器工具栏上——那才是能真正读到图片像素的地方。

### 测试

```sh
node test/contract.cjs
```

25 条断言：loader 注册、导出形状、对话图片识别（头像、侧栏图标、16×16 小图标必须被忽略）、查看器打开且默认点击被拦截、复制按钮真的 POST 到宿主路由，以及一条回归断言——关闭状态的浮层必须是 `display:none` + `pointer-events:none`，防止再次挡住整页。

### 隐私

宿主半区只注册两条仅限本机回环的路由（`/copy`、`/ping`）：前者接收 PNG 字节、写临时文件、调 PowerShell 放进剪贴板、然后删掉临时文件；不接受任意路径、不读取其他文件、不发网络请求。浏览器半区只读取 DSH 已经渲染出来的图片地址。不上传任何东西。

### 许可证

MIT。