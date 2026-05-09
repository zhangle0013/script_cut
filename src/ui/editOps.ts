import type { Clip, ScriptCutProject, VisualSegment } from "../types.js";
import type { TimelineItem } from "./model.js";

/** JSON 深拷贝工程（撤销栈与剪贴板用） */
export function cloneProject(project: ScriptCutProject): ScriptCutProject {
  return JSON.parse(JSON.stringify(project)) as ScriptCutProject;
}

const TIME_PAD = 0.05;

function roundMs(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function newClipId(prefix: string, n: number): string {
  return `${prefix}_dup_${Date.now()}_${String(n).padStart(3, "0")}`;
}

function newSegmentId(n: number): string {
  return `vs_split_${Date.now()}_${String(n).padStart(3, "0")}`;
}

/**
 * 在时刻 t 切开一条时间线 item（画面段或 clip）。
 * - 画面段：拆成两段并重建 cuts
 * - clip：拆成两条，文本按时长比例切分
 */
export function splitTimelineItemAtTime(
  project: ScriptCutProject,
  item: TimelineItem,
  t: number
): { next: ScriptCutProject } | null {
  if (t <= item.start + TIME_PAD || t >= item.end - TIME_PAD) return null;

  const next: ScriptCutProject = cloneProject(project);

  if (item.kind === "visualSegment") {
    const idx = next.visualSegments.findIndex((s) => s.id === item.segmentId);
    if (idx === -1) return null;
    const s = next.visualSegments[idx];
    const ratio = (t - s.start) / (s.end - s.start);
    const desc = s.description ?? "";
    const cutChar = Math.max(0, Math.min(desc.length, Math.round(desc.length * ratio)));
    const segA: VisualSegment = {
      ...s,
      end: roundMs(t),
      description: desc.slice(0, cutChar)
    };
    const segB: VisualSegment = {
      ...s,
      id: newSegmentId(1),
      start: roundMs(t),
      end: roundMs(s.end),
      description: desc.slice(cutChar),
      label: `${s.label}·2`
    };
    const vs = [...next.visualSegments];
    vs.splice(idx, 1, segA, segB);
    next.visualSegments = vs;
    next.cuts = buildCutsFromVisualSegments(next.visualSegments);
    return { next };
  }

  const cidx = next.clips.findIndex((c) => c.id === item.clipId);
  if (cidx === -1) return null;
  const c = next.clips[cidx];
  const ratio = (t - c.start) / (c.end - c.start);
  const text = c.text ?? "";
  const cutI = Math.max(1, Math.min(text.length - 1, Math.round(text.length * ratio)));
  const cLeft: Clip = {
    ...c,
    end: roundMs(t),
    text: text.slice(0, cutI)
  };
  const cRight: Clip = {
    ...c,
    id: newClipId(c.id, 1),
    start: roundMs(t),
    end: roundMs(c.end),
    text: text.slice(cutI)
  };
  const clips = [...next.clips];
  clips.splice(cidx, 1, cLeft, cRight);
  next.clips = clips;
  return { next };
}

function buildCutsFromVisualSegments(segments: VisualSegment[]) {
  const times = new Set<number>();
  for (const s of segments) {
    times.add(s.start);
    times.add(s.end);
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  return sorted.map((tt, idx) => ({ id: `cut_${String(idx + 1).padStart(3, "0")}`, t: tt }));
}

/** 剪贴板载荷：仅承载数据，不含时间（粘贴时再平移） */
export type TimelineClipboard = {
  clips: Clip[];
  visualSegments: VisualSegment[];
};

export function buildClipboardPayload(project: ScriptCutProject, items: TimelineItem[]): TimelineClipboard | null {
  if (items.length === 0) return null;
  const clipIds = new Set<string>();
  const segIds = new Set<string>();
  for (const it of items) {
    if (it.kind === "clip") clipIds.add(it.clipId);
    else segIds.add(it.segmentId);
  }
  const clips = project.clips.filter((c) => clipIds.has(c.id)).map((c) => ({ ...c }));
  const visualSegments = project.visualSegments.filter((s) => segIds.has(s.id)).map((s) => ({ ...s }));
  if (clips.length === 0 && visualSegments.length === 0) return null;
  return { clips, visualSegments };
}

/**
 * 将剪贴板内容粘贴到 playhead：整体平移使框的 min(start) 对齐 t0。
 */
export function pasteClipboardAtTime(project: ScriptCutProject, data: TimelineClipboard, t0: number): ScriptCutProject {
  const next = cloneProject(project);
  const starts: number[] = [];
  for (const c of data.clips) starts.push(c.start);
  for (const s of data.visualSegments) starts.push(s.start);
  if (starts.length === 0) return next;
  const base = Math.min(...starts);
  const delta = t0 - base;

  const newClips: Clip[] = data.clips.map((c, i) => {
    const nid = newClipId("clip", i);
    return {
      ...c,
      id: nid,
      start: roundMs(c.start + delta),
      end: roundMs(c.end + delta)
    };
  });

  const newSegs: VisualSegment[] = data.visualSegments.map((s, i) => {
    const nid = newSegmentId(i + 100);
    return {
      ...s,
      id: nid,
      start: roundMs(s.start + delta),
      end: roundMs(s.end + delta)
    };
  });

  next.clips = [...next.clips, ...newClips];
  next.visualSegments = [...next.visualSegments, ...newSegs];
  next.cuts = buildCutsFromVisualSegments(next.visualSegments);
  return next;
}

/** 在选中内容紧右侧复制一份（间隔 gapSec） */
export function duplicateTimelineItems(
  project: ScriptCutProject,
  items: TimelineItem[],
  gapSec = 0.08
): ScriptCutProject | null {
  const payload = buildClipboardPayload(project, items);
  if (!payload) return null;
  const ends: number[] = [];
  for (const it of items) ends.push(it.end);
  const tPaste = Math.max(...ends) + gapSec;
  return pasteClipboardAtTime(project, payload, tPaste);
}
