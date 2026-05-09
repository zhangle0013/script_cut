# ScriptCut（MVP）

这是一个“把剧本文字剪到时间轴上”的最小可用原型（CLI 版）。

你给的脚本（例如 `20260509_陈曦_Seedance_你外卖到了_宽屏分镜_v1.md`）已经包含：
- 画面分镜（`Shot xx | 0:00-0:02 | ...`）
- Seedance 对白/旁白时间码（`[0:05.5-0:08] ...`）

工程 JSON 还应把**表演/走位**落到 **`trk_action`** 的 `clips`，勿只写进画面 `description`（见规范 §5.7）。另可含**音效轨**（§7.7）。从 Markdown 解析时：Shot 描述里用 **`动作：`** / **`Action:`** 等前缀的行会自动拆到动作轨；解析器也会预留空 `trk_sfx`。

这个工具会把它们解析成：
- `cuts`：时间点分界
- `visualSegments`：画面段落（两个 cut 之间的区间）
- `clips`：对白/旁白/音效等（独立轨道，可跨 cut/segment 重叠；音效不按口播字速标红）
- `report.md`：对白密度（chars-per-second）超阈值报警

**若由 AI 直接生成工程 JSON**（不写 Markdown），字段与时长预估规范见：[`docs/SCRIPT_CUT_AI_SPEC.md`](docs/SCRIPT_CUT_AI_SPEC.md)。

## 安装

```bash
cd "/Users/wanghuijuan/Documents/script_cut"
npm i
```

## 解析你的脚本（生成 out.json + report.md）

```bash
npm run parse -- "/Users/wanghuijuan/chenxi_project/prompts/20260509_陈曦_Seedance_你外卖到了_宽屏分镜_v1.md" --out out.json --report report.md --cps 12
```

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
- 先用 CLI 生成 `out.json`
- 在 UI 里点击「导入 JSON」选择 `out.json`
- 拖拽片段移动；拖拽左右边缘拉伸时长；开启“吸附 cut”可对齐画面段落边界
- 点击「导出 JSON」下载 `project.edited.json`

