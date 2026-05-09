/**
 * UI 工具函数（时间轴）。
 *
 * 设计原则：
 * - 全部逻辑尽量“可解释、可调参”
 * - 在 MVP 阶段优先保证拖拽/缩放的正确性与稳定性
 */

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * 将秒数格式化为 "m:ss.s"（UI 显示用）
 */
export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  // 1 位小数足够做 UI 提示；精确值仍保存在数据中。
  const ss = s.toFixed(1).padStart(4, "0"); // "05.5"
  return `${m}:${ss}`;
}

/**
 * 简单的“可见字符数”统计：
 * - 去掉空白字符
 * - 中英文都按单字符计
 * 后续你可以替换成更真实的“中文按字、英文按词、标点按停顿”的模型。
 */
export function countVisibleChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/**
 * 计算 cps（chars per second）
 */
export function calcCps(text: string, start: number, end: number): number {
  const dur = Math.max(0.000_001, end - start);
  return countVisibleChars(text) / dur;
}

/**
 * 时间吸附（snap）到 cuts。
 *
 * - t：候选时间
 * - cuts：cut 时间数组（秒）
 * - thresholdSec：吸附阈值（秒），例如 0.08 表示 80ms 内就吸过去
 */
export function snapToCuts(t: number, cuts: number[], thresholdSec: number): number {
  if (cuts.length === 0) return t;
  let best = t;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of cuts) {
    const d = Math.abs(c - t);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return bestDist <= thresholdSec ? best : t;
}

/**
 * 下载文本文件（用于导出 JSON）
 */
export function downloadText(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 导出 JSON 时的下载文件名：`{源文件名去扩展名}_edited.json`
 *
 * - `inputPath` 来自工程字段（如 CLI 的 md 路径、或 AI 的 `ai://generated`）
 * - 取路径最后一段、去掉扩展名；非法文件名字符替换为 `_`
 * - 无法得到有效 stem 时 fallback 为 `project_edited.json`
 */
export function editedExportFilename(inputPath: string): string {
  const raw = (inputPath ?? "").trim();
  let stem = "project";
  if (raw.length > 0) {
    const normalized = raw.replace(/\\/g, "/");
    const lastSeg = normalized.split("/").pop() ?? "";
    const noFrag = lastSeg.split("?")[0]?.split("#")[0] ?? lastSeg;
    const dot = noFrag.lastIndexOf(".");
    const base = dot > 0 ? noFrag.slice(0, dot) : noFrag;
    const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
    if (cleaned.length > 0) stem = cleaned.slice(0, 120);
  }
  return `${stem}_edited.json`;
}

