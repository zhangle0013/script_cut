# Hermes / Agent 与时间线编辑器协作

本文说明：**Hermes（或其它自动化）生成工程 JSON 后**，如何让用户**尽快进入 ScriptCut 时间线**编辑，以及如何让模型**更懂时间线语义**。

## 1. 用户侧「打开方式」

### A. 本地开发（仓库内）

```bash
npm i && npm run dev
```

浏览器打开终端提示的地址（默认 `http://127.0.0.1:5173/`），再 **导入 JSON** 或 **从剪贴板导入**。

### B. 静态部署（推荐团队/Hermes 固定入口）

```bash
npm run build
```

将 `dist/` 部署到任意静态托管（内网 Nginx、GitHub Pages、对象存储 + CDN）。用户始终打开**同一 URL**，由 Hermes 把 JSON 交给该页（见下文）。

### C. 同源自动加载（适合 Hermes 把文件写到站点目录）

若部署根目录下可访问 `https://你的域名/out/hermes_project.json`，可让用户打开：

```text
https://你的域名/?importUrl=/out/hermes_project.json
```

**限制（安全）**：仅允许与页面 **同源** 的 URL；不支持任意跨域链接。

首次加载后会尝试 `fetch` 该路径并解析为工程 JSON（支持顶层 `{ project }` 或直接 `project` 字段，与「导入 JSON」一致）。

### D. 剪贴板（适合对话里贴 JSON）

Hermes 在回复里输出完整 JSON（或 `{ "project": { ... } }`），用户 **复制** 后在 ScriptCut 左栏点 **「从剪贴板导入 JSON」**（需浏览器剪贴板权限）。

---

## 2. Hermes 生成 JSON 时要注意什么

- **规范**：`docs/SCRIPT_CUT_AI_SPEC.md`（字段、轨道、`meta.targetDurationSec` 等）。
- **轨道顺序（UI 自上而下）**：与代码中 `TIMELINE_TRACK_ORDER` 一致——`info` → `environment` → `visual` → `action` → `dialogue` → `narration` → `sfx` → `subtitle`。
- **画面**：`visualSegments` + 由段落推导的 `cuts`；口播类在 `clips`，`trackId` 必须对应 `tracks[]` 里已有轨。
- **CLI 产物**：`npm run parse` 生成的是 **`{ stats, project, density }`**；UI 的 `readProjectFromJsonText` 会取 **`obj.project ?? obj`**，因此整包粘贴/导入也可行。

---

## 3. 让 Hermes「更懂时间线」的用法建议

1. **在系统提示或技能里挂载**  
   - 本文件 + `SCRIPT_CUT_AI_SPEC.md` 路径说明。  
   - 说明：编辑发生在 **时间轴**（start/end、cut、同轨重叠分层、波纹、roll 等），不是单纯「改剧本段落」。

2. **交付物不只 JSON**  
   Hermes 可在同目录写简短 **`HERMES_HANDOFF.md`**（非必须），例如：  
   - 片长、`visualSegments` / `clips` 条数  
   - 建议用户先 **适配全部** 看全貌，再 **点片段** 在右侧检查器改文案/时间  
   - 若需对口播做整理，提示 **对白去重叠** / **自动切镜** 在左栏哪一块  

3. **与 Cursor / MCP**  
   若 Hermes 跑在 Cursor 内：可把「导入后检查 `meta.targetDurationSec`」「导出前 `applyItemsToProject`」等写进项目 `AGENTS.md` 或规则，减少幻觉字段。

4. **桌面「像 App」**  
   若必须双击启动：需另加 Electron/Tauri 等壳（本仓库未内置）；短期仍推荐 **固定网页 + importUrl / 剪贴板**。

---

## 4. 安全说明

- `importUrl` **仅同源**，避免打开一个链接就加载第三方 JSON 的风险。  
- 剪贴板导入依赖用户主动点击与浏览器权限，避免静默读剪贴板。

如需 **跨域拉取**（例如 Hermes 只提供临时下载链接），应通过**你自己的后端**代理到同源路径，再让前端用 `?importUrl=/api/hermes/last.json` 这类地址加载。
