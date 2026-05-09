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

## 版本管理（GitHub）

本地已初始化 Git 并完成首次提交。把代码推到 GitHub 只需再建远程仓库并推送一次：

1. 浏览器打开 <https://github.com/new>，新建仓库（例如名 `script_cut`），**不要**勾选添加 README（本地已有）。
2. 在本项目目录终端执行（把 `你的用户名` 换成你的 GitHub 用户名）：

```bash
cd "/Users/wanghuijuan/Documents/script_cut"
git remote add origin https://github.com/你的用户名/script_cut.git
git push -u origin main
```

若 GitHub 要求登录：HTTPS 需使用 **Personal Access Token**（仓库设置里生成，权限勾选 `repo`），代替密码；或使用 **SSH**（本机 `ssh-keygen` 后把公钥加到 GitHub → Settings → SSH keys），并把上面地址改成 `git@github.com:你的用户名/script_cut.git`。

可选：安装 [GitHub CLI](https://cli.github.com/) 后执行 `gh auth login`，再用 `gh repo create script_cut --private --source=. --remote=origin --push` 一条龙创建并推送。

提交邮箱当前设为 `wanghuijuan@users.noreply.github.com`，若要改成自己的，可执行：`git config user.email "你的邮箱"`。

