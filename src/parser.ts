import { readFile } from "node:fs/promises";
import { buildCanonicalTracks } from "./canonicalTracks.js";
import { Clip, Cut, ScriptCutProject, TrackType, VisualSegment } from "./types.js";
import { parseRangeToSeconds, parseTimeToSeconds } from "./timecode.js";

/**
 * 这个解析器专门针对你当前的 Markdown 格式做“确定性提取”（不用 AI 也能稳定跑通）。
 *
 * 支持的输入块：
 * 1) 英文文字节点里的 Shot 行：
 *    Shot 01 | 0:00-0:02 | WIDE | Fixed
 *    <下一行起到下一个空行/下一个 Shot 之前的描述文本>
 *
 * 2) Seedance 中文对白块里的时间码行（允许重叠）：
 *    [0:05.5-0:08] AI骑手（无缝衔接...）：
 *    "台词内容"
 *
 * MVP 不做的事（但预留扩展位）：
 * - 不解析 LibTV 生图 prompt
 * - 不解析“字幕表”为 clips（后续可以加）
 * - 不从“选题元信息”做结构化 meta（后续可以加）
 *
 * Shot 描述拆动作（可选约定）：
 * - 若某行以「动作：」「表演：」「Action:」「Beat:」等开头（可带 - / * 列表符），
 *   该行正文会从画面 description 中移除，并合并为一条 `trk_action` clip（时间与该镜一致）。
 * - 多条动作行在同一镜内合并为一条 clip，避免同轨重叠；细节拍请用工程 JSON 分条写 `clips`。
 */

export interface ParseOptions {
  /**
   * 白话：每秒字符数阈值。超过就报警。
   * - 你之前提到“1 秒 100 字”更像极限；真实口播一般是 6-10 字/秒。
   * - MVP 先给一个保守默认 12，避免过度报警；你可以改成 100。
   */
  cpsThreshold?: number;
}

export interface ParseResult {
  project: ScriptCutProject;
  /** 便于 debug：解析过程中的“发现”统计 */
  stats: {
    shotsFound: number;
    clipsFound: number;
    cutsFound: number;
    /** 从 Shot 描述行（动作：前缀等）拆到动作轨的条数 */
    actionClipsFromShots: number;
  };
}

function makeId(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(3, "0")}`;
}

/**
 * 从 Shot 块的多行描述中拆出动作轨文案，其余保留为画面 description。
 *
 * 与 `docs/SCRIPT_CUT_AI_SPEC.md` §5.7 一致：画面段只保留「看见什么」，表演/走位进动作轨。
 */
function partitionShotDescriptionLines(lines: string[]): {
  visualLines: string[];
  actionBodies: string[];
} {
  const visualLines: string[] = [];
  const actionBodies: string[] = [];

  // 「动作：…」「- Action: …」「1. 表演：…」「【动作】…」等
  const actionHeaderRe =
    /^(?:(?:[-*+]|\d+\.)\s*)?(?:动作|表演|走位|Blocking|Action|Beat)[:：]\s*(.*)$/i;
  const bracketRe = /^(?:【动作】|\[动作\])\s*(.*)$/;

  for (const raw of lines) {
    const line = raw.trim();
    let m = line.match(actionHeaderRe);
    if (m) {
      const body = (m[1] ?? "").trim();
      if (body.length > 0) actionBodies.push(body);
      continue;
    }
    m = line.match(bracketRe);
    if (m) {
      const body = (m[1] ?? "").trim();
      if (body.length > 0) actionBodies.push(body);
      continue;
    }
    visualLines.push(line);
  }

  return { visualLines, actionBodies };
}

/** 与 `canonicalTracks.buildCanonicalTracks` 一致，保证 `Record<TrackType, string>` 键齐全 */
function ensureTracks() {
  return buildCanonicalTracks();
}

/**
 * 解析 Shot 列表（从英文文字节点中）。
 *
 * 重要：你当前文档里有两个“文字节点”区域：
 * - 第 1 页：Shot 01-09
 * - 第 2 页：Shot 10-18
 *
 * 我们不需要精确定位 fenced code block，只要扫描全文件并匹配 Shot 行即可。
 * 这样对你未来换位置/加说明也更鲁棒。
 */
function parseShots(md: string, actionTrackId: string): { segments: VisualSegment[]; actionClips: Clip[] } {
  const lines = md.split(/\r?\n/);
  const segments: VisualSegment[] = [];
  const actionClips: Clip[] = [];

  // Shot 行样式：Shot 01 | 0:00-0:02 | WIDE | Fixed
  const shotHeaderRe =
    /^Shot\s+(\d+)\s*\|\s*([0-9:.]+\s*-\s*[0-9:.]+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const m = line.match(shotHeaderRe);
    if (!m) {
      i += 1;
      continue;
    }

    const shotNum = Number(m[1]);
    const rangeRaw = m[2];
    const framing = m[3].trim();
    const camera = m[4].trim();
    const { start, end } = parseRangeToSeconds(rangeRaw);

    // Shot 描述通常在下一行开始，直到遇到空行或下一个 Shot header。
    const descLines: string[] = [];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrim = next.trim();
      if (nextTrim.length === 0) break;
      if (shotHeaderRe.test(nextTrim)) break;
      descLines.push(nextTrim);
      i += 1;
    }

    const { visualLines, actionBodies } = partitionShotDescriptionLines(descLines);
    const description =
      visualLines.length > 0 ? visualLines.join("\n") : undefined;

    segments.push({
      id: makeId("vs", segments.length + 1),
      start,
      end,
      label: `Shot ${String(shotNum).padStart(2, "0")}`,
      framing,
      camera,
      description
    });

    if (actionBodies.length > 0) {
      actionClips.push({
        id: makeId("clip_act", actionClips.length + 1),
        trackId: actionTrackId,
        start,
        end,
        text: actionBodies.join("\n"),
        meta: "自 Markdown Shot 块拆分",
        source: "md.shotAction"
      });
    }

    // 跳过空行
    while (i < lines.length && lines[i].trim().length === 0) i += 1;
  }

  return { segments, actionClips };
}

/**
 * 解析 Seedance 对白/旁白 clips。
 *
 * 输入格式核心规律（从你这份 v1.md 总结）：
 * - 先是一个“时间 + 说话人 + meta”的行，末尾以全角/半角冒号结束
 * - 下一行是被引号包裹的台词文本（可能是同一行，也可能跨行，但你当前是单行）
 *
 * 例：
 * [0:12-0:14] AI骑手（立刻回应，机械音切换为联网提示音后恢复——轻快平淡如查天气）：
 * "联网校准中——校准完成。2326年。已更新时区，不影响配送时效。"
 */
function parseSeedanceClips(md: string, trackIds: Record<TrackType, string>): Clip[] {
  const lines = md.split(/\r?\n/);
  const clips: Clip[] = [];

  /**
   * 关键修复：支持“分段脚本时间码从 0:00 重置”的情况。
   *
   * 你的输入里存在：
   * - 段 1：镜 01-09（0:00-0:15）→ 段内对白时间码从 0:00 起
   * - 段 2：镜 10-18（0:15-0:30）→ 段内对白时间码又从 0:00 起
   *
   * 我们要做的是：识别“### 段 X：...（start-end）”行，取 start 作为 baseOffset，
   * 然后把该段内的所有对白时间加上 baseOffset，变成全局时间线（0~30s）。
   */
  let baseOffsetSec = 0;
  let segmentLabel = "segment?";

  // 段标题行示例：### 段 2：镜 10-18（0:15-0:30）
  const segmentHeaderRe = /^###\s*段\s*(\d+)\s*[:：]?.*?（\s*([0-9:.]+)\s*-\s*([0-9:.]+)\s*）\s*$/;

  // header 行： [0:05.5-0:08] AI骑手（...）：
  // - meta 括号可选
  const headerRe = /^\[([0-9:.]+\s*-\s*[0-9:.]+)\]\s*([^（(:]+?)\s*(?:（(.+?)）)?\s*：\s*$/;

  // 台词行： "...."
  const quoteRe = /^"([\s\S]*?)"\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // 先检测是否进入了新的“段”
    const seg = line.match(segmentHeaderRe);
    if (seg) {
      const segNo = Number(seg[1]);
      const segStartRaw = seg[2];
      // const segEndRaw = seg[3]; // 目前不强依赖 end
      baseOffsetSec = parseTimeToSeconds(segStartRaw);
      segmentLabel = `segment${segNo}`;
      i += 1;
      continue;
    }

    const m = line.match(headerRe);
    if (!m) {
      i += 1;
      continue;
    }

    const rangeRaw = m[1];
    const speaker = m[2].trim();
    const meta = (m[3] ?? "").trim() || undefined;
    const { start, end } = parseRangeToSeconds(rangeRaw);
    const startAbs = start + baseOffsetSec;
    const endAbs = end + baseOffsetSec;

    // 默认认为下一行是引号台词；如果不是，先跳过（容错：未来你可能把台词写在同一行）。
    let text = "";
    const next = lines[i + 1]?.trim() ?? "";
    const qm = next.match(quoteRe);
    if (qm) {
      text = qm[1].trim();
      i += 2;
    } else {
      // 容错策略：继续往后找第一条引号行（最多找 3 行），避免文档中夹杂空行/说明导致断裂。
      let found = false;
      for (let k = 1; k <= 3; k += 1) {
        const candidate = lines[i + k]?.trim() ?? "";
        const q2 = candidate.match(quoteRe);
        if (q2) {
          text = q2[1].trim();
          i += k + 1;
          found = true;
          break;
        }
      }
      if (!found) {
        // 如果没找到，就把它当成空文本 clip（仍保留时间跨度，便于 UI 上提示缺失）
        i += 1;
      }
    }

    // 轨道归类：若 meta 里包含 “旁白”，优先放 narration，否则放 dialogue。
    const isNarration = (meta ?? "").includes("旁白");
    const trackId = isNarration ? trackIds.narration : trackIds.dialogue;

    clips.push({
      id: makeId("clip", clips.length + 1),
      trackId,
      start: startAbs,
      end: endAbs,
      speaker,
      meta,
      text,
      source: `seedance.${segmentLabel}`
    });
  }

  return clips;
}

/**
 * 从 visualSegments 生成 cuts（时间点集合）。
 *
 * 规则：
 * - 收集每段的 start 与 end
 * - 去重 + 排序
 * - 生成 cut 列表
 */
function buildCutsFromSegments(segments: VisualSegment[]): Cut[] {
  const times = new Set<number>();
  for (const s of segments) {
    times.add(s.start);
    times.add(s.end);
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  return sorted.map((t, idx) => ({ id: makeId("cut", idx + 1), t }));
}

/**
 * 解析入口：读文件并产出 project。
 */
export async function parseMarkdownFile(
  inputPath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const md = await readFile(inputPath, "utf8");

  const tracks = ensureTracks();
  const trackIds: Record<TrackType, string> = tracks.reduce((acc, t) => {
    acc[t.type] = t.id;
    return acc;
  }, {} as Record<TrackType, string>);

  const { segments: visualSegments, actionClips } = parseShots(md, trackIds.action);
  const cuts = buildCutsFromSegments(visualSegments);
  const clips = [...actionClips, ...parseSeedanceClips(md, trackIds)];

  const project: ScriptCutProject = {
    version: "0.1",
    inputPath,
    meta: {},
    tracks,
    cuts,
    visualSegments,
    clips
  };

  return {
    project,
    stats: {
      shotsFound: visualSegments.length,
      clipsFound: clips.length,
      cutsFound: cuts.length,
      actionClipsFromShots: actionClips.length
    }
  };
}

