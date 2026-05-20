# ScriptCut（MVP）

这是一个“把剧本文字剪到时间轴上”的最小可用原型（CLI 版）。

你给的脚本（例如 `20260509_陈曦_Seedance_你外卖到了_宽屏分镜_v1.md`）已经包含：
- 画面分镜（`Shot xx | 0:00-0:02 | ...`）
- Seedance 对白/旁白时间码（`[0:05.5-0:08] ...`）

工程 JSON 还应把**表演/走位**落到 **`trk_action`** 的 `clips`，勿只写进画面 `description`（见规范 §5.7）；**场景/时空**可走 **`trk_environment`**（时间在 UI 上介于信息轨与画面轨之间，见规范）。另可含**音效轨**（§7.7）。从 Markdown 解析时：Shot 描述里用 **`动作：`** / **`Action:`** 等前缀的行会自动拆到动作轨；解析器会按 `src/canonicalTracks.ts` 补齐默认轨道（含环境轨）。

这个工具会把它们解析成：
- `cuts`：时间点分界
- `visualSegments`：画面段落（两个 cut 之间的区间）
- `clips`：对白/旁白/音效等（独立轨道，可跨 cut/segment 重叠；音效不按口播字速标红）
- `report.md`：对白密度（chars-per-second）超阈值报警

**若由 AI 直接生成工程 JSON**（不写 Markdown），字段与时长预估规范见：[`docs/SCRIPT_CUT_AI_SPEC.md`](docs/SCRIPT_CUT_AI_SPEC.md)。

## 安装

```bash
git clone <你的仓库 URL>
cd script_cut
npm i
```

（若已在本地目录开发，直接进入该目录执行 `npm i` 即可。）

## 解析你的脚本（生成 out.json + report.md）

```bash
npm run parse -- "./your-script.md" --out out.json --report report.md --cps 12
```

把 `./your-script.md` 换成你的 Markdown 分镜脚本路径。

说明：
- `--cps 12` 是一个偏“现实口播”的报警阈值
- 如果你想用“极限约束”，可以设成 `--cps 100`

## 输出说明（简版）

- `project.visualSegments[]`：由 Shot 行生成（start/end/framing/camera/description）
- `project.clips[]`：主要由 Seedance 时间码行生成对白/旁白；音效等可由 AI 直接写入 JSON 或后续扩展解析
- `density.warnings[]`：密度超阈值的 clips（按 cps 降序）

## 启动时间轴 UI（可拖拽/拉伸编辑）

```bash
npm run dev
```

打开浏览器访问 `http://127.0.0.1:5173/`。

操作流程：
- 先用 CLI 生成 `out.json`，或由 AI 直接产出符合规范的 JSON
- 在 UI 里点击「导入 JSON」选择文件；浏览器标签与侧栏使用 `public/scriptcut-logo.png` 品牌图标（仓库自备，无第三方版权问题；可自行替换）
- 拖拽片段移动；左右细条拉伸；**Ctrl/⌘ + 细条**为全轨波纹；同轨相邻接缝处可 **roll（黄条）**（含画面轨）
- 无刻度空白：**单击**选中整条全局空隙，或横向拖选空隙；**Delete** 波纹左移后续内容（与删单片段区分）
- 「一键延长」口播偏短时为**全时间线波纹**（片段与画面段一起在 `原出点` 之后右移）
- 导出 JSON 固定文件名为 **`03_ScriptCut已编辑.json`**

详细交互说明见界面内「帮助模式」及 `docs/SCRIPT_CUT_AI_SPEC.md`。

与 **Hermes / AI 协作**（生成 JSON 后打开编辑、同源深链、剪贴板导入）见 [`docs/HERMES_INTEGRATION.md`](docs/HERMES_INTEGRATION.md)。

## 许可

本项目以 **MIT** 许可证开源，见仓库根目录 [`LICENSE`](LICENSE)。

## 更新日志

各版本说明见 [`CHANGELOG.md`](CHANGELOG.md)。当前 `package.json` 版本号与发布记录一致。

## 版本管理（GitHub）

推送前建议：

```bash
npm run typecheck
npm run build
```

若尚未添加远程仓库：浏览器打开 <https://github.com/new> 新建空仓库后执行 `git remote add origin …` 再 `git push -u origin main`。  
若本地已有 `origin`，提交并推送：

```bash
git add -A
git status
git commit -m "chore(release): v0.3.0"
git push origin main
```

打 **Git 标签**（便于 GitHub Releases 对应源码版本）：

```bash
git tag -a v0.3.0 -m "ScriptCut v0.3.0"
git push origin v0.3.0
```

在 GitHub 仓库页 **Releases → Draft a new release**，选择标签 `v0.3.0`，标题例：`ScriptCut v0.3.0`，正文可粘贴 `CHANGELOG.md` 中对应段落。

登录方式：HTTPS 使用 **Personal Access Token**；或使用 **SSH**。也可用 [GitHub CLI](https://cli.github.com/)：`gh auth login` 后推送；发布 Release 可用 `gh release create v0.3.0 --notes-file CHANGELOG.md`（按需裁剪正文）。

