import { mergeMissingTracks } from "../canonicalTracks.js";
import type { Clip, ScriptCutProject, TrackType, VisualSegment } from "../types.js";
import {
  CAMERA_MOVE_CODES,
  CAMERA_MOVE_LABELS_ZH,
  FRAMING_CODES,
  FRAMING_LABELS_ZH,
  MOVE_AMPLITUDE_LABELS_ZH,
  MOVE_AMPLITUDES,
  type CameraMoveCode,
  type FramingCode,
  type MoveAmplitude
} from "../filmVocabulary.js";
import { estimateSpeech, splitByPunctuation, type SpeechModelParams, DEFAULT_SPEECH_PARAMS } from "./speechModel.js";
import { snapToCuts } from "./utils.js";

/**
 * UI 层的“统一可编辑片段”类型。
 *
 * 解释：
 * - 你现在的后端/CLI 输出里，visualSegments 与 clips 是两个数组。
 * - UI 时间轴绘制与拖拽缩放需要一个统一的“片段”抽象（都具有 start/end/trackId/text 等）。
 * - 所以我们在 UI 层把 visualSegments 映射成一种“视觉 clip”（只用于显示/编辑段落时长）。
 *
 * 注意：
 * - 这里的视觉片段并不会回写成原始 md 的 Shot 文本；我们只是修改 JSON 数据。
 * - 未来你要做“回写 Markdown / 回写 Seedance 时间码”，可以在 CLI 层增加 exporter。
 */

export type TimelineItemKind = "visualSegment" | "clip";

export interface TimelineItemBase {
  id: string;
  kind: TimelineItemKind;
  trackType: TrackType;
  start: number;
  end: number;
  title: string;
  subtitle?: string;
  rawText?: string;
}

/** 画面段结构化字段自检问题码（供时间轴标红与 i18n） */
export type VisualStructIssue =
  | "invalidFramingStart"
  | "invalidFramingEnd"
  | "invalidCameraMove"
  | "invalidMoveAmplitude"
  | "framingOneSided"
  | "moveHintInvalid";

export interface TimelineItemVisual extends TimelineItemBase {
  kind: "visualSegment";
  segmentId: string;
  /** 非空时与对白「语速过快」一样走 danger 样式 */
  visualStructIssues?: VisualStructIssue[];
}

export interface TimelineItemClip extends TimelineItemBase {
  kind: "clip";
  clipId: string;
  speaker?: string;
  meta?: string;
}

export type TimelineItem = TimelineItemVisual | TimelineItemClip;

export interface TimelineProjectState {
  project: ScriptCutProject;
  /** UI 合并后的 items */
  items: TimelineItem[];
  /** 轨道展示顺序（按 type） */
  trackOrder: TrackType[];
}

/**
 * 由画面段 JSON 生成时间轴卡片上的摘要行（与检查器结构化字段一致，改字段后只依赖 project 重算即可）。
 */
const FRAMING_SET = new Set<string>(FRAMING_CODES);
const CAMERA_SET = new Set<string>(CAMERA_MOVE_CODES);
const AMPLITUDE_SET = new Set<string>(MOVE_AMPLITUDES);

/**
 * 检查画面段结构化字段是否与 `filmVocabulary` 枚举一致、景别是否成对等。
 * 不校验自由文本 `framing` / `camera` / `description` 内容是否合理。
 */
export function visualSegmentStructIssues(s: VisualSegment): VisualStructIssue[] {
  const issues: VisualStructIssue[] = [];

  const s0 = s.framingStart != null ? String(s.framingStart).trim() : "";
  const s1 = s.framingEnd != null ? String(s.framingEnd).trim() : "";
  const invalidStart = s0 !== "" && !FRAMING_SET.has(s0);
  const invalidEnd = s1 !== "" && !FRAMING_SET.has(s1);
  if (invalidStart) issues.push("invalidFramingStart");
  if (invalidEnd) issues.push("invalidFramingEnd");
  /** 仅当两端都不是非法 code 时，提示「只填了 framingStart 或只填了 framingEnd」 */
  if (!invalidStart && !invalidEnd && (s0 !== "") !== (s1 !== "")) {
    issues.push("framingOneSided");
  }

  const cm = s.cameraMove != null ? String(s.cameraMove).trim() : "";
  if (cm !== "" && !CAMERA_SET.has(cm)) {
    issues.push("invalidCameraMove");
  }

  const amp = s.moveAmplitude != null ? String(s.moveAmplitude).trim() : "";
  if (amp !== "" && !AMPLITUDE_SET.has(amp)) {
    issues.push("invalidMoveAmplitude");
  }

  if (s.moveDurationHint != null) {
    const h = s.moveDurationHint;
    if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) {
      issues.push("moveHintInvalid");
    }
  }

  return issues;
}

export function visualSegmentCardFields(s: VisualSegment): { subtitle: string; rawText: string } {
  const fz = (code: FramingCode | undefined) => (code ? FRAMING_LABELS_ZH[code] ?? code : "");
  const framingBits =
    s.framingStart && s.framingEnd
      ? `${fz(s.framingStart)}→${fz(s.framingEnd)}`
      : [fz(s.framingStart), fz(s.framingEnd), s.framing].filter(Boolean).join(" ");
  const moveZh = s.cameraMove ? CAMERA_MOVE_LABELS_ZH[s.cameraMove as CameraMoveCode] ?? s.cameraMove : "";
  const ampZh = s.moveAmplitude
    ? MOVE_AMPLITUDE_LABELS_ZH[s.moveAmplitude as MoveAmplitude] ?? s.moveAmplitude
    : "";
  const camBits = [moveZh, ampZh, s.camera].filter(Boolean).join(" · ");
  return {
    subtitle: [framingBits, camBits].filter(Boolean).join(" · "),
    rawText: s.description ?? ""
  };
}

export function getTrackName(type: TrackType): string {
  switch (type) {
    case "visual":
      return "画面（段落）";
    case "dialogue":
      return "对白";
    case "narration":
      return "旁白";
    case "action":
      return "动作/节拍";
    case "info":
      return "信息/参考";
    case "environment":
      return "环境/场景";
    case "subtitle":
      return "字幕";
    case "sfx":
      return "音效";
    default:
      return type;
  }
}

/**
 * 将 ScriptCutProject 转换为 UI 需要的 TimelineProjectState。
 */
export function toTimelineState(project: ScriptCutProject): TimelineProjectState {
  const trackTypeById = new Map(project.tracks.map((t) => [t.id, t.type]));

  const items: TimelineItem[] = [];

  // 1) 视觉段落 -> 映射成 visual 轨的 items（结构化行优先中文释义）
  for (const s of project.visualSegments) {
    const card = visualSegmentCardFields(s);
    const visualStructIssues = visualSegmentStructIssues(s);
    items.push({
      id: `item_vs_${s.id}`,
      kind: "visualSegment",
      segmentId: s.id,
      trackType: "visual",
      start: s.start,
      end: s.end,
      title: s.label,
      subtitle: card.subtitle,
      rawText: card.rawText,
      ...(visualStructIssues.length > 0 ? { visualStructIssues } : {})
    });
  }

  // 2) clips -> 用原轨道类型
  for (const c of project.clips) {
    const type = trackTypeById.get(c.trackId) ?? "info";
    items.push({
      id: `item_clip_${c.id}`,
      kind: "clip",
      clipId: c.id,
      trackType: type,
      start: c.start,
      end: c.end,
      title: c.speaker ? `${c.speaker}` : "Clip",
      subtitle: c.meta,
      rawText: c.text,
      speaker: c.speaker,
      meta: c.meta
    });
  }

  /**
   * 时间轴自上而下轨顺序
   * 环境轨在信息/参考与画面之间，便于先读场景再对镜；音效仍在旁白之下。
   */
  const trackOrder: TrackType[] = [
    "info",
    "environment",
    "visual",
    "action",
    "dialogue",
    "narration",
    "sfx",
    "subtitle"
  ];

  return { project, items, trackOrder };
}

/**
 * 把 UI 的 items 改动回写到 project（只改 start/end）。
 *
 * MVP 策略：
 * - visualSegment item -> 回写对应 visualSegments 的 start/end
 * - clip item -> 回写对应 clips 的 start/end
 */
export function applyItemsToProject(project: ScriptCutProject, items: TimelineItem[]): ScriptCutProject {
  const segById = new Map(project.visualSegments.map((s) => [s.id, s] as const));
  const clipById = new Map(project.clips.map((c) => [c.id, c] as const));

  // 深拷贝：避免直接改原对象导致 React 状态混乱
  const next: ScriptCutProject = {
    ...project,
    visualSegments: project.visualSegments.map((s) => ({ ...s })),
    clips: project.clips.map((c) => ({ ...c }))
  };

  const nextSegById = new Map(next.visualSegments.map((s) => [s.id, s] as const));
  const nextClipById = new Map(next.clips.map((c) => [c.id, c] as const));

  for (const it of items) {
    if (it.kind === "visualSegment") {
      const s = nextSegById.get(it.segmentId);
      if (s) {
        s.start = it.start;
        s.end = it.end;
      }
    } else {
      const c = nextClipById.get(it.clipId);
      if (c) {
        c.start = it.start;
        c.end = it.end;
      }
    }
  }

  // 同步 cuts：用所有 visualSegments 的 start/end 重算（和 CLI 一致）
  next.cuts = buildCutsFromVisualSegments(next.visualSegments);
  return next;
}

function buildCutsFromVisualSegments(segments: VisualSegment[]) {
  const times = new Set<number>();
  for (const s of segments) {
    times.add(s.start);
    times.add(s.end);
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  return sorted.map((t, idx) => ({ id: `cut_${String(idx + 1).padStart(3, "0")}`, t }));
}

function roundMs(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** 时间线排序后的 item id（先按 start，再按轨道顺序） */
export function sortedTimelineItemIds(items: TimelineItem[], trackOrder: TrackType[]): string[] {
  const rank = new Map(trackOrder.map((tt, i) => [tt, i]));
  return [...items]
    .sort(
      (a, b) =>
        a.start - b.start ||
        (rank.get(a.trackType) ?? 99) - (rank.get(b.trackType) ?? 99) ||
        a.id.localeCompare(b.id)
    )
    .map((x) => x.id);
}

/**
 * 从工程中删除选中的时间线条目（画面段或 clip）。
 * 若删光画面段，则用 0～全片最大时间重建 cuts，避免空工程。
 */
export function deleteTimelineItemsFromProject(project: ScriptCutProject, toRemove: TimelineItem[]): ScriptCutProject | null {
  if (toRemove.length === 0) return null;
  const segIds = new Set<string>();
  const clipIds = new Set<string>();
  for (const it of toRemove) {
    if (it.kind === "visualSegment") segIds.add(it.segmentId);
    else clipIds.add(it.clipId);
  }
  const next: ScriptCutProject = {
    ...project,
    visualSegments: project.visualSegments.filter((s) => !segIds.has(s.id)),
    clips: project.clips.filter((c) => !clipIds.has(c.id))
  };
  if (next.visualSegments.length > 0) {
    next.cuts = buildCutsFromVisualSegments(next.visualSegments);
  } else {
    let maxT = 1;
    for (const c of next.clips) maxT = Math.max(maxT, c.end);
    next.cuts = [
      { id: "cut_001", t: 0 },
      { id: "cut_002", t: roundMs(maxT) }
    ];
  }
  return next;
}

/** 更新画面段的结构化字段（检查器下拉绑定） */
export function updateVisualSegmentFields(
  project: ScriptCutProject,
  segmentId: string,
  patch: Partial<
    Pick<
      VisualSegment,
      "framingStart" | "framingEnd" | "cameraMove" | "moveAmplitude" | "moveDurationHint" | "description" | "label"
    >
  >
): ScriptCutProject {
  return {
    ...project,
    visualSegments: project.visualSegments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s))
  };
}

/**
 * 找到 clip 及其轨道信息（用于 ripple/拆分）。
 */
export function findClip(project: ScriptCutProject, clipId: string): Clip | undefined {
  return project.clips.find((c) => c.id === clipId);
}

export function trackTypeOfClip(project: ScriptCutProject, clip: Clip): TrackType {
  const t = project.tracks.find((x) => x.id === clip.trackId);
  return t?.type ?? "info";
}

/**
 * 一键修复“超速对白/旁白”：把 clip 延长到“建议最短时长”，并对「整条时间线」做 ripple（与口播排队全局 ripple 同类）。
 *
 * ripple 规则：
 * - 当前片段只拉长 end（起点不变）
 * - 所有其它 clips：若 start >= 延长前的原 end，则整条 clip 右移 delta
 * - 所有 visualSegments：同样 start >= oldEnd 则整体右移 delta（保持声画相对对齐）
 * - cuts：若有画面段则从片段边界重建；若无画面段则对每个 cut.t >= oldEnd 加 delta
 * - 起点早于 oldEnd 但与延长区间相交的重叠片段不推移（与原先「同轨抢话」策略一致，避免误伤）
 */
export function extendClipToMinSpeechDurationWithRipple(
  project: ScriptCutProject,
  clipId: string,
  params: SpeechModelParams = DEFAULT_SPEECH_PARAMS
): { next: ScriptCutProject; applied: boolean; suggestedMin: number } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return { next: project, applied: false, suggestedMin: 0 };

  const type = trackTypeOfClip(project, clip);
  if (type !== "dialogue" && type !== "narration") {
    // 只对口播类轨道生效
    return { next: project, applied: false, suggestedMin: 0 };
  }

  const est = estimateSpeech(clip.text, params);
  const suggestedMin = est.minDuration;

  const curDur = clip.end - clip.start;
  if (curDur >= suggestedMin) {
    return { next: project, applied: false, suggestedMin };
  }

  const delta = suggestedMin - curDur;
  const oldEnd = clip.end;

  const next: ScriptCutProject = {
    ...project,
    visualSegments: project.visualSegments.map((s) => ({ ...s })),
    clips: project.clips.map((c) => ({ ...c }))
  };

  for (const c of next.clips) {
    if (c.id === clipId) {
      c.end = roundMs(c.end + delta);
      continue;
    }
    if (c.start >= oldEnd) {
      c.start = roundMs(c.start + delta);
      c.end = roundMs(c.end + delta);
    }
  }

  for (const s of next.visualSegments) {
    if (s.start >= oldEnd) {
      s.start = roundMs(s.start + delta);
      s.end = roundMs(s.end + delta);
    }
  }

  if (next.visualSegments.length > 0) {
    next.cuts = buildCutsFromVisualSegments(next.visualSegments);
  } else {
    next.cuts = next.cuts.map((cu) => ({
      ...cu,
      t: cu.t >= oldEnd ? roundMs(cu.t + delta) : cu.t
    }));
  }

  return { next, applied: true, suggestedMin };
}

/**
 * 按标点拆分 clip，并可选“切分点对齐到 cut”。
 *
 * 设计目标：
 * - 不改变整体的语速原则：拆分后的每段按口播模型估算最短时长
 * - 拆分后总时长 = max(原时长, 建议最短总时长)
 * - 若对齐 cut，会把每个分段边界吸附到最近 cut（在阈值内才吸）
 *
 * 注意：
 * - 这会产生新的 clip IDs，并替换旧 clip
 * - ripple：如果拆分导致总时长变长，也会将同轨后续 clips 推后
 */
export function splitClipByPunctuationIntoClips(
  project: ScriptCutProject,
  clipId: string,
  options: {
    params?: SpeechModelParams;
    alignToCuts?: boolean;
    cutSnapThresholdSec?: number;
  } = {}
): { next: ScriptCutProject; applied: boolean; created: number } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return { next: project, applied: false, created: 0 };

  const type = trackTypeOfClip(project, clip);
  if (type !== "dialogue" && type !== "narration") return { next: project, applied: false, created: 0 };

  const segs = splitByPunctuation(clip.text);
  if (segs.length <= 1) return { next: project, applied: false, created: 0 };

  const params = options.params ?? DEFAULT_SPEECH_PARAMS;
  const ests = segs.map((s) => estimateSpeech(s, params));
  const sumMin = ests.reduce((acc, e) => acc + e.minDuration, 0);

  const oldStart = clip.start;
  const oldEnd = clip.end;
  const oldDur = oldEnd - oldStart;
  const newTotal = Math.max(oldDur, sumMin);

  // 按比例分配：每段时长 = newTotal * (segMin / sumMin)
  const durations = ests.map((e) => (sumMin > 0 ? (newTotal * e.minDuration) / sumMin : newTotal / ests.length));

  // 生成新 clips 的时间边界
  const cuts = project.cuts.map((c) => c.t).sort((a, b) => a - b);
  const snap = (t: number) => {
    if (!options.alignToCuts) return t;
    const thr = options.cutSnapThresholdSec ?? 0.08;
    return snapToCuts(t, cuts, thr);
  };

  const newClips: Clip[] = [];
  let t = oldStart;
  for (let i = 0; i < segs.length; i += 1) {
    const segText = segs[i];
    const dur = durations[i];
    const start = i === 0 ? oldStart : snap(t);
    const end = i === segs.length - 1 ? oldStart + newTotal : snap(start + dur);
    t = end;

    newClips.push({
      ...clip,
      id: `${clip.id}_s${String(i + 1).padStart(2, "0")}`,
      start: roundMs(start),
      end: roundMs(end),
      text: segText
    });
  }

  // 如果对齐 cut 导致边界跑偏，做一次单调修正（保证 start <= end 且连续）
  for (let i = 0; i < newClips.length; i += 1) {
    if (i === 0) continue;
    if (newClips[i].start < newClips[i - 1].end) newClips[i].start = newClips[i - 1].end;
    if (newClips[i].end < newClips[i].start + 0.1) newClips[i].end = newClips[i].start + 0.1;
  }

  const delta = newTotal - oldDur;

  const next: ScriptCutProject = {
    ...project,
    clips: project.clips.map((c) => ({ ...c }))
  };

  // 1) 替换旧 clip
  const idx = next.clips.findIndex((c) => c.id === clipId);
  if (idx === -1) return { next: project, applied: false, created: 0 };
  next.clips.splice(idx, 1, ...newClips);

  // 2) ripple 推后同轨后续 clips
  if (delta > 0) {
    for (const c of next.clips) {
      // new clips 不动
      if (c.id.startsWith(`${clip.id}_s`)) continue;
      if (c.trackId === clip.trackId && c.start >= oldEnd) {
        c.start = roundMs(c.start + delta);
        c.end = roundMs(c.end + delta);
      }
    }
  }

  return { next, applied: true, created: newClips.length };
}

/**
 * 根据对白/旁白生成 cut，并重建画面段落（visualSegments）。
 *
 * 你想要的是“镜头节奏跟台词/停顿/换人对齐”：
 * - 我们用对白/旁白 clip 的边界作为强候选 cut
 * - 再加入“句末标点”带来的停顿 cut（通过文本内部拆分近似模拟）
 * - 最后用 min/max 镜头长度做约束：太长就自动补 cut，太短就合并（MVP 先做补 cut）
 *
 * 注意：
 * - 这是第一版启发式，目的是给你一个“可用的默认切法”，不是最终答案
 * - 你仍然可以在 UI 上手工拉伸/移动画面段落
 */
export function autoGenerateCutsAndRebuildVisualSegments(
  project: ScriptCutProject,
  options: {
    params?: SpeechModelParams;
    minSegSec: number;
    maxSegSec: number;
    keepExistingCuts?: boolean;
  }
): ScriptCutProject {
  const params = options.params ?? DEFAULT_SPEECH_PARAMS;
  const minSegSec = Math.max(0.2, options.minSegSec);
  const maxSegSec = Math.max(minSegSec, options.maxSegSec);

  const trackTypeById = new Map(project.tracks.map((t) => [t.id, t.type]));
  const speechClips = project.clips
    .filter((c) => {
      const tt = trackTypeById.get(c.trackId);
      return tt === "dialogue" || tt === "narration";
    })
    .slice()
    .sort((a, b) => a.start - b.start);

  // 项目总时长：取所有 clip/段落的最大 end
  let maxT = 0;
  for (const c of project.clips) maxT = Math.max(maxT, c.end);
  for (const s of project.visualSegments) maxT = Math.max(maxT, s.end);
  maxT = Math.max(1, maxT);

  const times = new Set<number>();
  times.add(0);
  times.add(roundMs(maxT));

  if (options.keepExistingCuts) {
    for (const c of project.cuts) times.add(roundMs(c.t));
  }

  // 强候选：clip 边界 + 换人说话点
  let lastSpeaker: string | undefined;
  for (const c of speechClips) {
    times.add(roundMs(c.start));
    times.add(roundMs(c.end));
    if (lastSpeaker && c.speaker && c.speaker !== lastSpeaker) {
      // 换人处：把它的 start 强制当作 cut 候选
      times.add(roundMs(c.start));
    }
    lastSpeaker = c.speaker;

    // 弱候选：句末标点停顿（通过拆分 + 累积时长近似定位到时间线）
    const segs = splitByPunctuation(c.text);
    if (segs.length > 1) {
      // 用“建议最短时长”来分配内部切点位置：这会比纯字符比例更稳定一些
      const ests = segs.map((s) => estimateSpeech(s, params).minDuration);
      const sum = ests.reduce((a, b) => a + b, 0);
      const dur = c.end - c.start;
      let acc = 0;
      for (let i = 0; i < segs.length - 1; i += 1) {
        acc += ests[i];
        const ratio = sum > 0 ? acc / sum : (i + 1) / segs.length;
        const t = c.start + dur * ratio;
        // 只把“疑似停顿比较强”的切点加入（句号/问号/感叹号/省略号）
        if (/[。？！…]/.test(segs[i])) {
          times.add(roundMs(t));
        }
      }
    }
  }

  // 排序去重
  let cutTimes = Array.from(times).sort((a, b) => a - b);
  cutTimes = cutTimes.filter((t, idx) => idx === 0 || Math.abs(t - cutTimes[idx - 1]) > 0.02);

  // 约束：太长就补 cut（均分插入）
  const constrained: number[] = [];
  for (let i = 0; i < cutTimes.length - 1; i += 1) {
    const a = cutTimes[i];
    const b = cutTimes[i + 1];
    constrained.push(a);
    const span = b - a;
    if (span > maxSegSec) {
      const pieces = Math.ceil(span / maxSegSec);
      for (let k = 1; k < pieces; k += 1) {
        constrained.push(roundMs(a + (span * k) / pieces));
      }
    }
  }
  constrained.push(cutTimes[cutTimes.length - 1]);
  constrained.sort((a, b) => a - b);

  // 约束：太短（< minSegSec）MVP 暂不自动合并，以免“吞掉”你手工节奏；后续可加合并策略。
  const finalCuts = constrained;

  // 重建 visualSegments：每段是 [cut[i], cut[i+1]]
  const visualSegments: VisualSegment[] = [];
  for (let i = 0; i < finalCuts.length - 1; i += 1) {
    const start = finalCuts[i];
    const end = finalCuts[i + 1];
    if (end - start < 0.05) continue;
    visualSegments.push({
      id: `vs_auto_${String(i + 1).padStart(3, "0")}`,
      start,
      end,
      label: `Auto ${String(i + 1).padStart(2, "0")}`,
      framing: "",
      camera: "",
      description: "",
      group: "auto"
    });
  }

  return {
    ...project,
    visualSegments,
    cuts: finalCuts.map((t, idx) => ({ id: `cut_${String(idx + 1).padStart(3, "0")}`, t }))
  };
}

/**
 * 同轨去重叠（口播轨道专用）：把重叠的对白/旁白按时间顺序“排成一条队”。
 *
 * 你现在遇到的现象是：
 * - 原脚本时间码里存在大量对白重叠（例如 AI 播报被陈曦打断）
 * - 自动重建画面段落只会改 visualSegments/cuts，不会改对白
 * - 所以你会看到“镜头变了，但对白还是挤在一起”
 *
 * 这个函数的目标：
 * - 对指定 trackTypes（默认对白/旁白）在每条轨道内做“去重叠”
 * - 做法：按 start 排序，若 next.start < prev.end，则把 next 整体右移到 prev.end（保持时长不变）
 *
 * 为什么选“右移保持时长”：
 * - 不会把台词内容压缩到听不清
 * - 更符合你要的“时长稳定”：让时间轴体现“至少要花这么久说完”
 *
 * ripple 范围：
 * - 只在“同一 trackId”内顺延
 * - 不跨轨道，不改视觉段落（你可以选择之后再自动切镜头以贴合新对白节奏）
 */
export function resolveOverlapsByShiftingForward(
  project: ScriptCutProject,
  options: {
    trackTypes?: TrackType[];
    /** 片段之间最小间隔（秒），例如 0.05 给一点呼吸感 */
    gapSec?: number;
    /** 将 start/end 量化到多少毫秒，避免浮点抖动 */
    quantizeMs?: number;
  } = {}
): { next: ScriptCutProject; shiftedCount: number } {
  const trackTypes = options.trackTypes ?? ["dialogue", "narration"];
  const gapSec = options.gapSec ?? 0;
  const qMs = options.quantizeMs ?? 1;

  const trackTypeById = new Map(project.tracks.map((t) => [t.id, t.type]));

  const next: ScriptCutProject = {
    ...project,
    clips: project.clips.map((c) => ({ ...c }))
  };

  // 按 trackId 分组处理（因为同一类型可能有多条轨）
  const clipsByTrack = new Map<string, Clip[]>();
  for (const c of next.clips) {
    const tt = trackTypeById.get(c.trackId);
    if (!tt || !trackTypes.includes(tt)) continue;
    const arr = clipsByTrack.get(c.trackId) ?? [];
    arr.push(c);
    clipsByTrack.set(c.trackId, arr);
  }

  let shiftedCount = 0;

  for (const arr of clipsByTrack.values()) {
    arr.sort((a, b) => a.start - b.start || a.end - b.end);
    let cursor = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const c = arr[i];
      const dur = Math.max(0.1, c.end - c.start);
      if (i === 0) {
        cursor = c.end;
        continue;
      }
      const minStart = cursor + gapSec;
      if (c.start < minStart) {
        // 右移保持时长
        c.start = quantize(Math.max(0, minStart), qMs);
        c.end = quantize(c.start + dur, qMs);
        shiftedCount += 1;
      }
      cursor = Math.max(cursor, c.end);
    }
  }

  return { next, shiftedCount };
}

/**
 * 同轨去重叠（口播轨道）+ 全时间线 ripple。
 *
 * 你提出的关键诉求是：
 * - AI 初稿常出现“一个镜头里说不完这么多话” → 我们把对白顺延
 * - 但对白顺延后，画面段落也应该一起顺延（否则对白和画面错位）
 *
 * 所以这里做“全时间线 ripple”：
 * - 当某条口播 clip 由于重叠被右移了 delta 秒
 * - 就把“时间点 >= 该 clip 原 start”的所有内容（所有轨道 clips + visualSegments）整体右移 delta
 *
 * 这样能最大程度保持“从这个点开始，画面与台词的相对对齐关系”。
 *
 * 注意：
 * - 这是一种偏“剪辑软件 ripple edit”的行为，会改变整体时长
 * - 如果你想保留某些轨道不动（比如 BGM），可以后续加白名单/黑名单
 */
export function resolveSpeechOverlapsWithGlobalRipple(
  project: ScriptCutProject,
  options: {
    trackTypes?: TrackType[];
    gapSec?: number;
    quantizeMs?: number;
    /** 是否让 visualSegments 也跟着 ripple（你希望是 true） */
    rippleVisualSegments?: boolean;
  } = {}
): { next: ScriptCutProject; shiftedCount: number; totalShift: number } {
  const trackTypes = options.trackTypes ?? ["dialogue", "narration"];
  const gapSec = options.gapSec ?? 0;
  const qMs = options.quantizeMs ?? 10;
  const rippleVS = options.rippleVisualSegments ?? true;

  const trackTypeById = new Map(project.tracks.map((t) => [t.id, t.type]));

  const next: ScriptCutProject = {
    ...project,
    visualSegments: project.visualSegments.map((s) => ({ ...s })),
    clips: project.clips.map((c) => ({ ...c }))
  };

  const speechClips = next.clips
    .filter((c) => {
      const tt = trackTypeById.get(c.trackId);
      return tt && trackTypes.includes(tt);
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let shiftedCount = 0;
  let totalShift = 0;

  // cursor 表示“当前口播轨道队列”应该占到的最右端（因为全局 ripple，跨轨道也会被推后，所以这里用绝对时间）
  let cursor = 0;

  for (let i = 0; i < speechClips.length; i += 1) {
    const c = speechClips[i];
    const dur = Math.max(0.1, c.end - c.start);

    if (i === 0) {
      cursor = c.end;
      continue;
    }

    const minStart = cursor + gapSec;
    if (c.start >= minStart) {
      cursor = Math.max(cursor, c.end);
      continue;
    }

    const oldStart = c.start;
    const oldEnd = c.end;
    const newStart = quantize(minStart, qMs);
    const delta = newStart - oldStart;
    if (delta <= 0) continue;

    // 1) 先把当前这条口播 clip 移到新位置
    c.start = newStart;
    c.end = quantize(newStart + dur, qMs);
    shiftedCount += 1;
    totalShift += delta;

    // 2) ripple：把时间 >= oldStart 的所有其它内容右移 delta
    for (const other of next.clips) {
      if (other.id === c.id) continue;
      if (other.start >= oldStart) {
        other.start = quantize(other.start + delta, qMs);
        other.end = quantize(other.end + delta, qMs);
      }
    }

    if (rippleVS) {
      for (const s of next.visualSegments) {
        if (s.start >= oldStart) {
          s.start = quantize(s.start + delta, qMs);
          s.end = quantize(s.end + delta, qMs);
        }
      }
    }

    // 3) 更新 cursor：因为我们整体推后了后面的内容，所以 cursor 也应在当前位置基础上推进
    cursor = Math.max(cursor, c.end);

    // 4) 同步 speechClips 引用数组里的后续元素时间（因为它们是 next.clips 的同对象引用，已被 ripple 改了）
    //    不需要额外处理。
  }

  // 最后重算 cuts（保持与工程一致）
  next.cuts = buildCutsFromVisualSegments(next.visualSegments);
  return { next, shiftedCount, totalShift };
}

function quantize(sec: number, ms: number): number {
  const step = Math.max(1, Math.floor(ms));
  return Math.round(sec * 1000 / step) * (step / 1000);
}

/**
 * 用于从 out.json 里安全读取 project。
 * - out.json 顶层结构是 { stats, project, density }
 * - 我们只取 project
 */
export function readProjectFromJsonText(text: string): ScriptCutProject {
  const obj = JSON.parse(text) as any;
  if (!obj || typeof obj !== "object") throw new Error("JSON 不是对象");
  const project = obj.project ?? obj;
  if (!project || typeof project !== "object") throw new Error("JSON 中未找到 project");
  if (!Array.isArray(project.tracks) || !Array.isArray(project.cuts) || !Array.isArray(project.visualSegments)) {
    throw new Error("project 结构不完整（缺 tracks/cuts/visualSegments）");
  }
  if (!Array.isArray(project.clips)) throw new Error("project 结构不完整（缺 clips）");
  const raw = project as ScriptCutProject;
  return {
    ...raw,
    tracks: mergeMissingTracks(raw.tracks)
  };
}

