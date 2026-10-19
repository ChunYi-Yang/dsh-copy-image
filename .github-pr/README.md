# awesome-dsh-plugin 收录提交包

> 状态：**材料已就绪，但暂时无法提交。** 详见本文末尾「为什么现在提交不了」。

这个目录是给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
提 PR 用的全部材料。等账号恢复后，按下面的步骤 15 分钟内可以提完。

---

## 一、要提交的内容

**方式**：Fork → 新增**一个文件** → 发 PR。只改一个文件，不动 README
（README 由 CI 从 `data/plugins/*.yml` 自动生成，手改会冲突）。

**目标路径**：`data/plugins/447662__dsh-copy-image.yml`

**文件内容**：见同目录 [`447662__dsh-copy-image.yml`](./447662__dsh-copy-image.yml)，
内容如下：

```yaml
url: https://github.com/447662/dsh-copy-image
name: 447662/dsh-copy-image
category: ui
tarball: https://github.com/447662/dsh-copy-image/releases/latest/download/dsh-copy-image.tgz
description:
  en: 'Adds a conversation image viewer whose Copy button writes the picture to the clipboard; the clipboard is written from the host process, so it works where the renderer clipboard permission is denied.'
  zh: '给对话图片加一个查看器，其中的“复制”按钮把图片写进剪贴板；剪贴板由宿主进程写入，因此在渲染进程剪贴板权限被拒绝时仍然可用。'
```

**几个规范细节**（都已按规则处理）：

- `en` 描述里含 `: ` 会让 YAML 解析成嵌套键，所以**整段用了单引号**
- `en` 以句号结尾，`zh` 以中文句号结尾（CI 会查）
- `category: ui` —— 插件改的是对话区的图片查看体验，属 UI 增强；`vision` 是识图能力，不是同一件事
- `tarball` 指向 Release 资产，**文件名不带版本号**。这是刻意的：`releases/latest/download/<名字>`
  只在请求时解析 `latest`，文件名是照字面取的，带版本号的话下个版本一发布就 404
- 描述只陈述功能，没有营销词。CI 会把描述当"对代码的声明"逐句核对，所以特意写了
  "由宿主进程写剪贴板"这个可验证的实现细节

---

## 二、提交步骤

```bash
# 1. Fork（如果 fork 还在就直接用）
#    https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork

# 2. 克隆你的 fork
git clone https://github.com/447662/awesome-dsh-plugin.git
cd awesome-dsh-plugin

# 3. 建分支
git checkout -b add-dsh-copy-image

# 4. 放文件（内容就是上面那段）
mkdir -p data/plugins
#    把 447662__dsh-copy-image.yml 拷进去

# 5. 本地验证（可选但建议）
npm ci
node scripts/generate-readme.mjs     # 确认 README 能重新生成
git diff --stat                      # 应当只有一个新文件

# 6. 提交并推送
git add data/plugins/447662__dsh-copy-image.yml
git commit -m "Add 447662/dsh-copy-image"
git push -u origin add-dsh-copy-image
```

然后在 GitHub 上开 PR，标题 `Add 447662/dsh-copy-image`，正文见下一节。

---

## 三、PR 正文（可直接粘贴）

```markdown
Adds `447662/dsh-copy-image`, a viewer for conversation images whose Copy button
puts the picture on the clipboard.

**Why it exists.** DSH's built-in image lightbox renders a mask, the `<img>` and
a close button — nothing else. There is no way to get a picture out except
save-then-drag; text copies normally because it is a selection, images do not.

**What it does.** Clicking a conversation image opens a viewer with Copy, Save,
zoom (1×–8×, wheel + drag) and prev/next within the same message. The overlay
never moves or reparents DSH's DOM nodes — it listens on the document and draws
into its own body portal, because the transcript is a React virtual list and
reparenting its nodes makes React throw `removeChild` afterwards.

**One implementation detail worth flagging, because it is the part that took
two attempts:** `navigator.clipboard.write` rejects in an Electron renderer when
the harness's per-session permission handler denies clipboard-write, and the
button then appears to do nothing. So the clipboard is written by the host
process instead: the renderer POSTs PNG bytes to a loopback-only route, the host
lands them in a temp file, runs a short STA PowerShell that calls
`Clipboard.SetImage`, verifies by reading the image back, then deletes the temp
file. `navigator.clipboard.write` remains as the fallback for plain-browser
profiles.

**Checks:**

- `dsh.bundle` is declared in `package.json` and `cordis.patch.yml` is at the repo root.
- Host half registers two loopback-only routes (`/copy`, `/ping`) — no arbitrary
  path reads, no filesystem browsing, no network calls.
- `test/contract.cjs` runs the real client bundle against a fake DOM: 25
  assertions, including a regression guard that a closed overlay cannot block
  the page (an earlier build left an invisible full-viewport backdrop in the
  hit-testing tree and froze the UI).
- Installable from a prebuilt tarball:
  `https://github.com/447662/dsh-copy-image/releases/latest/download/dsh-copy-image.tgz`

Install:

```
dsh plugin --profile desktop add github:447662/dsh-copy-image
```
```

---

## 四、提交前必须满足的条件

| 条件 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ 已声明 |
| 根目录有 `cordis.patch.yml` | ✅ 已有 |
| 仓库有真实可用代码（非占位 / 非纯 README） | ✅ 约 900 行，含测试 |
| 仓库加了 `dsh-plugin` topic | ✅ 已加（另含 `dsh` `deepseek-harness` `image` `clipboard` `copy-image` `lightbox`） |
| 仓库创建满 **1 天** | ⏳ 创建于 2026-10-19 18:19 UTC |
| 一个 PR 最多 3 条 | ✅ 只提 1 条 |
| 描述属实、无营销词 | ✅ 已按此标准撰写 |

CI 会按顺序检查：条目数 → `dsh.bundle` → 仓库年龄（>= 1 天）→ `awesome-lint` + 站点构建。
`check-submission.mjs` 里写死了 `MIN_AGE_DAYS = 1`，这一项**时间无法伪造**。

---

## 五、为什么现在提交不了

`2026-10-20 02:40`（Asia/Shanghai）检查时的实际情况：

1. **GitHub 账号处于封禁状态。**
   调用 `GET /api/user` 返回：

   ```json
   { "message": "Sorry. Your account was suspended",
     "documentation_url": "https://docs.github.com/rest", "status": "403" }
   ```

   这不是限流（未认证请求同一时刻仍可用，`rate_limit` 显示 53/60 剩余），
   而是账号级封禁。连带影响：

   - 认证请求全部 403
   - 仓库暂时对外不可见：`GET /repos/447662/dsh-copy-image` → **404**
   - `git-upload-pack` → **401**
   - Release 资产下载 → **404**

   也就是说**连已经推上去的代码现在也访问不到**，提 PR 自然无从谈起。

2. **仓库年龄还不够。** 即便账号立刻恢复，仓库创建于
   `2026-10-19T18:19:39Z`，CI 要求满 1 天，最早可提交时间约
   **2026-10-20 18:20 UTC**（北京时间 10-21 02:20 之后）。

**恢复顺序建议：**

1. 先解决账号封禁（GitHub 支持渠道 / 确认是否有违规通知邮件）
2. 账号恢复后确认仓库重新可见：`curl -s https://api.github.com/repos/447662/dsh-copy-image`
3. 等仓库满 1 天后按上面步骤提 PR

---

## 六、另：npm 发布（可选，未做）

`contributing.md` 明确说**发不发 npm 不影响收录**，只影响市场能否显示下载量。
但有两点值得知道：

- 预构建 tarball 已经覆盖了"避免 `allowBuilds` 构建授权"这个好处
- 如果以后要发 npm，`package.json` 的 `repository` 字段必须指回本仓库，
  否则 registry 里的包不会和列表条目关联