import { DensityWarning, ScriptCutProject, TrackType } from "./types.js";
import { formatSeconds } from "./timecode.js";

/**
 * “对白密度/超速”分析。
 *
 * 核心指标：chars-per-second (cps) = 字符数 / 时长秒数
 *
 * 为什么用字符而不是“字”：
 * - MVP 阶段简单稳定；中英文混排也能工作。
 * - 真要更准，可以把中文按字、英文按词，再引入停顿权重。
 */

export interface DensityOptions {
  /** cps 阈值：超过就报警 */
  cpsThreshold: number;
  /** 哪些轨道要做密度检查 */
  trackTypes: TrackType[];
}

/**
 * 计算“可见字符数”：去掉空白字符。
 * - 你后续如果想把标点算作停顿，也可以在这里单独统计标点数量。
 */
export function countVisibleChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export function analyzeDensity(project: ScriptCutProject, opts: DensityOptions): DensityWarning[] {
  const trackTypeById = new Map(project.tracks.map((t) => [t.id, t.type]));
  const warnings: DensityWarning[] = [];

  for (const clip of project.clips) {
    const trackType = trackTypeById.get(clip.trackId);
    if (!trackType) continue;
    if (!opts.trackTypes.includes(trackType)) continue;

    const duration = clip.end - clip.start;
    if (duration <= 0) continue;

    const chars = countVisibleChars(clip.text);
    const cps = chars / duration;

    if (cps > opts.cpsThreshold) {
      warnings.push({
        clipId: clip.id,
        trackType,
        speaker: clip.speaker,
        start: clip.start,
        end: clip.end,
        duration,
        chars,
        cps,
        threshold: opts.cpsThreshold,
        text: clip.text,
        reason: `文本密度过高：${chars} 字符 / ${duration.toFixed(2)}s = ${cps.toFixed(2)} cps > ${opts.cpsThreshold}`
      });
    }
  }

  // 默认按 cps 从高到低排序，方便优先修最严重的
  warnings.sort((a, b) => b.cps - a.cps);
  return warnings;
}

/**
 * 生成 markdown 报告，便于你直接打开查看/贴到文档里。
 */
export function renderDensityReportMarkdown(
  project: ScriptCutProject,
  warnings: DensityWarning[]
): string {
  const lines: string[] = [];
  lines.push(`# ScriptCut 报告`);
  lines.push(``);
  lines.push(`- 输入：\`${project.inputPath}\``);
  lines.push(`- 画面段落（visualSegments）：**${project.visualSegments.length}**`);
  lines.push(`- cuts：**${project.cuts.length}**`);
  lines.push(`- clips：**${project.clips.length}**`);
  lines.push(``);
  lines.push(`## 白话密度报警（按 cps 降序）`);
  lines.push(``);

  if (warnings.length === 0) {
    lines.push(`未发现超过阈值的 clip。`);
    lines.push(``);
    return lines.join("\n");
  }

  // 为避免输出超长表格，这里用“列表”而不是 markdown 表格（也更好读）。
  for (const w of warnings) {
    lines.push(`- **${w.clipId}**（${w.trackType}${w.speaker ? ` / ${w.speaker}` : ""}）`);
    lines.push(`  - 时间：${formatSeconds(w.start)} - ${formatSeconds(w.end)}（${w.duration.toFixed(2)}s）`);
    lines.push(`  - 字符数：${w.chars}，cps：**${w.cps.toFixed(2)}**（阈值 ${w.threshold}）`);
    lines.push(`  - 原因：${w.reason}`);
    lines.push(`  - 文本：${w.text}`);
  }
  lines.push(``);

  return lines.join("\n");
}

