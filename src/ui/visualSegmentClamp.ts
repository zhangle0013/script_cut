/**
 * 画面轨（visualSegment）时间区间约束：任意两段在内时间上不得重叠（允许端点贴合）。
 * 用于拖拽、滚动编辑 junction、键盘平移后的校正。
 */

import type { TimelineItem } from "./model.js";

/** 与时间轴一致的极小间隔：判断是否「重叠」而非「刚好相接」 */
export const VISUAL_SEGMENT_TIME_EPS = 1e-4;

/**
 * 判断两段区间是否在时间上重叠（严格重叠；两端相接不算重叠）。
 */
export function visualSegmentsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd - VISUAL_SEGMENT_TIME_EPS && aEnd > bStart + VISUAL_SEGMENT_TIME_EPS;
}

/**
 * 将某画面片段的 [start, end] 钳制到不与其它画面片段重叠的最邻近合法区间。
 * - `items`：当前时间线全部片段（用于查找其它 visualSegment）
 * - `draggedId`：正在移动的片段 id
 * - `minDur`：允许的最短时长（秒）
 */
export function clampVisualSegmentInterval(
  items: TimelineItem[],
  draggedId: string,
  start: number,
  end: number,
  minDur: number,
): { start: number; end: number } {
  const roundTime = (x: number) => Math.round(x * 1000) / 1000;
  let s = roundTime(Math.max(0, start));
  let e = roundTime(Math.max(s + minDur, end));
  const others = items.filter((i) => i.kind === "visualSegment" && i.id !== draggedId);

  for (let guard = 0; guard < 48; guard++) {
    let blocker: TimelineItem | undefined;
    for (const o of others) {
      if (visualSegmentsOverlap(s, e, o.start, o.end)) {
        blocker = o;
        break;
      }
    }
    if (!blocker) break;

    const mid = (s + e) / 2;
    const midB = (blocker.start + blocker.end) / 2;
    if (mid <= midB) {
      e = Math.min(e, blocker.start);
      e = roundTime(Math.max(s + minDur, e));
    } else {
      s = Math.max(s, blocker.end);
      s = roundTime(Math.min(s, e - minDur));
    }
  }

  s = Math.max(0, roundTime(s));
  e = Math.max(s + minDur, roundTime(e));
  return { start: s, end: e };
}

/**
 * 滚动编辑（Roll）场景：左右两段均为画面轨时，junction 位置不能使任一侧与其它画面片段重叠。
 * 在 [left.start + minDur, right.end - minDur] 内迭代收紧 junction。
 */
export function clampVisualRollJunction(
  items: TimelineItem[],
  leftId: string,
  rightId: string,
  junctionSec: number,
  leftStart: number,
  rightEnd: number,
  minDur: number,
): number {
  const roundTime = (x: number) => Math.round(x * 1000) / 1000;
  const others = items.filter(
    (i) => i.kind === "visualSegment" && i.id !== leftId && i.id !== rightId,
  );

  let j = roundTime(junctionSec);
  const lo = roundTime(leftStart + minDur);
  const hi = roundTime(rightEnd - minDur);
  j = Math.max(lo, Math.min(hi, j));

  for (let guard = 0; guard < 48; guard++) {
    let changed = false;
    const leftSegEnd = j;
    const rightSegStart = j;

    for (const o of others) {
      if (visualSegmentsOverlap(leftStart, leftSegEnd, o.start, o.end)) {
        const nj = roundTime(Math.max(j, o.end));
        if (nj !== j) {
          j = Math.min(hi, nj);
          changed = true;
        }
      }
      if (visualSegmentsOverlap(rightSegStart, rightEnd, o.start, o.end)) {
        const nj = roundTime(Math.min(j, o.start));
        if (nj !== j) {
          j = Math.max(lo, nj);
          changed = true;
        }
      }
    }

    j = Math.max(lo, Math.min(hi, roundTime(j)));
    if (!changed) break;
  }

  return Math.max(lo, Math.min(hi, roundTime(j)));
}
