import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { TrackType } from "../types.js";
import type { MessageKey } from "./i18n.js";
import { trackTypeLabel } from "./i18n.js";
import { useI18n } from "./I18nProvider.js";
import type { TimelineItem, VisualStructIssue } from "./model.js";
import { sortedTimelineItemIds } from "./model.js";
import { clampVisualRollJunction, clampVisualSegmentInterval } from "./visualSegmentClamp.js";
import { calcCps, fmtTime, snapToCuts } from "./utils.js";

const TIME_EPS = 1e-6;
/** 略减小阈值，短间隙也更容易选中（仍须全轨无片段） */
const GAP_MIN_SEC = 0.03;
const LABEL_W = 140;
/** 与 `styles.css` 中 `.ruler` 的 height（34px）一致，供垂直布局与框选命中 */
const RULER_H = 34;
const DEFAULT_TRACK_H = 52;
/** 与 `.trackSoundDivider` 的 `height`（border-box）一致，用于垂直布局与框选命中 */
const SOUND_DIVIDER_H = 6;
const MIN_TRACK_H = 36;
/** 用户拖动上限；实际显示高度还会按片段文字量自动不低于估算值（见 effectiveTrackHeight） */
const MAX_TRACK_H = 360;
/** 估算换行时单行约略字符数（中英混排近似） */
const CHAR_PX_APPROX = 9;
/** 单行文字近似高度（px），与 .clipTitle / .clipSub 字号匹配 */
const CLIP_LINE_H = 14;
/** clip 内上下留白（与 CSS padding 协调） */
const CLIP_VERTICAL_PAD = 20;
/** 同轨重叠时分层行之间的间距（px） */
const STACK_LANE_GAP_PX = 3;
/** 分层区域上下内边距（px），与原先 clip 贴边留白一致 */
const STACK_TRACK_PAD_PX = 4;

/** 画面结构化自检问题码 → i18n 键（时间轴 tooltip） */
const VISUAL_STRUCT_ISSUE_KEY: Record<VisualStructIssue, MessageKey> = {
  invalidFramingStart: "visualStructInvalidFramingStart",
  invalidFramingEnd: "visualStructInvalidFramingEnd",
  invalidCameraMove: "visualStructInvalidCameraMove",
  invalidMoveAmplitude: "visualStructInvalidMoveAmplitude",
  framingOneSided: "visualStructFramingOneSided",
  moveHintInvalid: "visualStructMoveHintInvalid"
};

function roundTime(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * 估算单个片段在轨道上所需的最小高度（px），用于换行与自动撑高。
 * 抽出为模块级函数，供「单轨最大高度」与「重叠分层每行高度」共用。
 */
function estimateClipMinHeightPx(it: TimelineItem, pxPerSec: number): number {
  const clipW = Math.max(40, (it.end - it.start) * pxPerSec);
  const charsPerLine = Math.max(10, Math.floor(clipW / CHAR_PX_APPROX));
  const titleLen = (it.title?.length ?? 0) + 22;
  const sub = it.subtitle ?? "";
  const raw = it.rawText ?? "";
  const textLen =
    it.trackType === "visual"
      ? titleLen + sub.length + raw.length + 4
      : titleLen + Math.max(sub.length, raw.length);
  const lines = Math.max(2, Math.ceil(textLen / charsPerLine));
  return CLIP_VERTICAL_PAD + lines * CLIP_LINE_H;
}

/**
 * 将同轨片段按时间重叠关系分到不同「层」（行）：同一层内时间段互不重叠。
 * 采用按开始时间排序的贪心算法，使层数最少，轨道垂直方向可分层绘制而不互相遮挡。
 */
function assignOverlapLanes(laneItems: TimelineItem[]): Map<string, number> {
  const sorted = [...laneItems].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  /** laneEnds[L] = 当前第 L 层最后一个片段的结束时间 */
  const laneEnds: number[] = [];
  const laneById = new Map<string, number>();
  for (const it of sorted) {
    let placed = false;
    for (let L = 0; L < laneEnds.length; L += 1) {
      if (laneEnds[L] <= it.start + TIME_EPS) {
        laneById.set(it.id, L);
        laneEnds[L] = it.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const L = laneEnds.length;
      laneById.set(it.id, L);
      laneEnds.push(it.end);
    }
  }
  return laneById;
}

/** 单轨重叠分层后的布局指标（行高、累计 top、轨道内容最小高度） */
interface TrackStackMetrics {
  laneById: Map<string, number>;
  laneCount: number;
  rowHeights: number[];
  rowTops: number[];
  /** 该轨 lane 区域应占的最小高度（不含底部分隔条 resize handle） */
  totalStackH: number;
}

function computeTrackStackMetrics(laneItems: TimelineItem[], pxPerSec: number): TrackStackMetrics {
  if (laneItems.length === 0) {
    return {
      laneById: new Map(),
      laneCount: 1,
      rowHeights: [Math.max(MIN_TRACK_H - STACK_TRACK_PAD_PX * 2, 28)],
      rowTops: [STACK_TRACK_PAD_PX],
      totalStackH: MIN_TRACK_H
    };
  }
  /** 画面轨：强制单行排列（时间上禁止重叠由拖拽/Roll 钳制），避免多层叠在同一条视觉带上 */
  const isVisualTrack = laneItems.length > 0 && laneItems.every((it) => it.trackType === "visual");
  const laneById = isVisualTrack
    ? new Map(laneItems.map((it) => [it.id, 0]))
    : assignOverlapLanes(laneItems);
  const laneIndices = Array.from(laneById.values());
  /** 最大层索引 + 1 = 层数（例如层号 0、1 → 共 2 层） */
  const laneCount = laneIndices.length === 0 ? 1 : Math.max(...laneIndices) + 1;
  const rowHeights = Array.from({ length: laneCount }, () => 28);
  for (const it of laneItems) {
    const L = laneById.get(it.id) ?? 0;
    const need = estimateClipMinHeightPx(it, pxPerSec);
    rowHeights[L] = Math.max(rowHeights[L], need);
  }
  const rowTops: number[] = [];
  let y = STACK_TRACK_PAD_PX;
  for (let L = 0; L < laneCount; L += 1) {
    rowTops.push(y);
    y += rowHeights[L];
    if (L < laneCount - 1) y += STACK_LANE_GAP_PX;
  }
  const totalStackH = y + STACK_TRACK_PAD_PX;
  return { laneById, laneCount, rowHeights, rowTops, totalStackH };
}

/** 区间 [lo, hi] 是否与任意片段（任意轨）有交集；无交集即「全轨道空白」 */
function isRangeGloballyEmpty(items: TimelineItem[], lo: number, hi: number): boolean {
  if (hi - lo < GAP_MIN_SEC) return false;
  for (const it of items) {
    if (it.start < hi - TIME_EPS && it.end > lo + TIME_EPS) return false;
  }
  return true;
}

/** 将所有条目的时间段合并为互不重叠的区间（全局占用），用于找「点击处的整条空隙」 */
function mergeAllItemIntervals(items: TimelineItem[]): [number, number][] {
  const raw = items.map((it) => [it.start, it.end] as [number, number]);
  raw.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of raw) {
    if (!out.length || s > out[out.length - 1][1] + TIME_EPS) {
      out.push([s, e]);
    } else {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    }
  }
  return out;
}

/** 横向拖动空隙判定「已从点击升级为拖拽」的位移阈值（像素²） */
const GAP_CLICK_DRAG_THRESHOLD_SQ = 36;

/** `data-track-lane` 合法取值校验（与 `TrackType` 一致） */
const TRACK_LANE_TYPES = new Set<string>([
  "visual",
  "dialogue",
  "narration",
  "action",
  "sfx",
  "info",
  "environment",
  "subtitle"
]);

function parseTrackLaneTypeFromTarget(target: HTMLElement): TrackType | null {
  const lane = target.closest("[data-track-lane]");
  const raw = lane?.getAttribute("data-track-lane");
  if (!raw || !TRACK_LANE_TYPES.has(raw)) return null;
  return raw as TrackType;
}

/** 单轨占用区间合并（用于找「该轨上的整条空白」） */
function mergeTrackItemIntervals(items: TimelineItem[], trackType: TrackType): [number, number][] {
  const raw = items
    .filter((it) => it.trackType === trackType)
    .map((it) => [it.start, it.end] as [number, number]);
  raw.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of raw) {
    if (!out.length || s > out[out.length - 1][1] + TIME_EPS) {
      out.push([s, e]);
    } else {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    }
  }
  return out;
}

/** 区间 [lo, hi] 是否与「指定轨」上任一片段相交 */
function isRangeEmptyOnTrack(items: TimelineItem[], lo: number, hi: number, trackType: TrackType): boolean {
  if (hi - lo < GAP_MIN_SEC) return false;
  for (const it of items) {
    if (it.trackType !== trackType) continue;
    if (it.start < hi - TIME_EPS && it.end > lo + TIME_EPS) return false;
  }
  return true;
}

/**
 * 点选轨内空白：返回「仅在该轨上」包含时刻 `t` 的最大空隙（其它轨可有片段）。
 * 逻辑与 `globallyEmptyGapAtClick` 相同，仅占用区间改为单轨合并。
 */
function trackEmptyGapAtClick(
  items: TimelineItem[],
  t: number,
  canvasRightSec: number,
  trackType: TrackType
): { lo: number; hi: number } | null {
  const merged = mergeTrackItemIntervals(items, trackType);
  let hiCanvas = Math.max(canvasRightSec, 1);
  for (const it of items) {
    if (it.trackType === trackType) hiCanvas = Math.max(hiCanvas, it.end + 1);
  }

  const contains = (lo: number, hi: number): boolean =>
    t >= lo - TIME_EPS * 4 && t <= hi + TIME_EPS * 4 && hi - lo >= GAP_MIN_SEC;

  if (merged.length === 0) {
    const lo = 0;
    const hi = hiCanvas;
    return contains(lo, hi) ? { lo, hi } : null;
  }

  {
    const lo = 0;
    const hi = merged[0][0];
    if (contains(lo, hi)) return { lo, hi };
  }

  for (let i = 0; i < merged.length - 1; i++) {
    const lo = merged[i][1];
    const hi = merged[i + 1][0];
    if (contains(lo, hi)) return { lo, hi };
  }

  {
    const lo = merged[merged.length - 1][1];
    const hi = hiCanvas;
    if (contains(lo, hi)) return { lo, hi };
  }

  return null;
}

/**
 * 点选空白：返回包含时刻 `t` 的最大全局空隙 [lo, hi]。
 * - 空隙两侧由全局合并后的占用边界界定；最后一节后延伸至画布右侧（scrollWidth），便于删尾部留白。
 */
function globallyEmptyGapAtClick(items: TimelineItem[], t: number, canvasRightSec: number): { lo: number; hi: number } | null {
  const merged = mergeAllItemIntervals(items);
  /** 画布右缘对应的秒数，至少盖住当前已有内容 */
  let hiCanvas = Math.max(canvasRightSec, 1);
  for (const it of items) hiCanvas = Math.max(hiCanvas, it.end + 1);

  const contains = (lo: number, hi: number): boolean =>
    t >= lo - TIME_EPS * 4 && t <= hi + TIME_EPS * 4 && hi - lo >= GAP_MIN_SEC;

  if (merged.length === 0) {
    const lo = 0;
    const hi = hiCanvas;
    return contains(lo, hi) ? { lo, hi } : null;
  }

  {
    const lo = 0;
    const hi = merged[0][0];
    if (contains(lo, hi)) return { lo, hi };
  }

  for (let i = 0; i < merged.length - 1; i++) {
    const lo = merged[i][1];
    const hi = merged[i + 1][0];
    if (contains(lo, hi)) return { lo, hi };
  }

  {
    const lo = merged[merged.length - 1][1];
    const hi = hiCanvas;
    if (contains(lo, hi)) return { lo, hi };
  }

  return null;
}

/**
 * 同轨相邻条目可 roll 的接点对（保持两条总长不变，只移动接缝）。
 * 含 clip 与画面段（visualSegment）；原先排除画面轨导致画面镜头缝无法 roll。
 */
function rollPairsByItemId(items: TimelineItem[]): { leftItemId: string; rightItemId: string; junction: number }[] {
  const byTrack = new Map<TrackType, TimelineItem[]>();
  for (const it of items) {
    const arr = byTrack.get(it.trackType) ?? [];
    arr.push(it);
    byTrack.set(it.trackType, arr);
  }
  const pairs: { leftItemId: string; rightItemId: string; junction: number }[] = [];
  for (const arr of byTrack.values()) {
    arr.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < arr.length - 1; i += 1) {
      const L = arr[i];
      const R = arr[i + 1];
      if (Math.abs(L.end - R.start) < 0.06) {
        pairs.push({ leftItemId: L.id, rightItemId: R.id, junction: (L.end + R.start) / 2 });
      }
    }
  }
  return pairs;
}

/** 间隙选中：全局空白（全轨无片段）或仅某一轨上的空白（仅该轨波纹左移） */
export type TimelineGapSelection =
  | { scope: "global"; lo: number; hi: number }
  | { scope: "track"; trackType: TrackType; lo: number; hi: number };

export interface TrackUiState {
  locked?: boolean;
  solo?: boolean;
  hidden?: boolean;
}

export interface TimelineProps {
  items: TimelineItem[];
  trackOrder: TrackType[];
  cuts: number[];
  pxPerSec: number;
  snapEnabled: boolean;
  snapThresholdSec: number;
  cpsThreshold: number;
  onChangeItems: (next: TimelineItem[]) => void;
  /** 兼容：单选 id（若未传 selectedIds 则用它） */
  onSelectItem?: (id: string | null) => void;
  selectedItemId?: string | null;
  /** 多选 id 列表 */
  selectedIds?: string[];
  onSelectIds?: (ids: string[]) => void;
  /** 播放头（秒） */
  playheadSec?: number;
  onPlayheadChange?: (t: number) => void;
  /** 工作区入点/出点（秒）；均有值时播放循环该区间 */
  workInSec?: number | null;
  workOutSec?: number | null;
  trackStates?: Partial<Record<TrackType, TrackUiState>>;
  trackHeights?: Partial<Record<TrackType, number>>;
  onTrackHeightChange?: (type: TrackType, h: number) => void;
  onToggleTrackFlag?: (type: TrackType, flag: "locked" | "solo" | "hidden") => void;
  /** 拖拽/roll 等手势开始（用于撤销栈快照） */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** 删除间隙写回工程前调用（用于撤销快照） */
  onBeforeGapClose?: () => void;
  /** 间隙选中变化（可选，用于侧栏提示等） */
  onGapSelectionChange?: (gap: TimelineGapSelection | null) => void;
  /** 是否正在播放：为 true 时播放头位置由 ref 每帧更新，减轻 React 重绘 */
  playing?: boolean;
}

/** 父组件在播放循环中每帧调用，直接改 DOM + 视口滚动 */
export interface TimelineHandle {
  setPlayheadTimeSec(t: number): void;
}

type DragMode = "move" | "resizeLeft" | "resizeRight";

interface DragState {
  itemId: string;
  mode: DragMode;
  startX: number;
  origStart: number;
  origEnd: number;
  ripple: boolean;
  itemsBaseline: { id: string; start: number; end: number }[];
}

interface RollDragState {
  leftItemId: string;
  rightItemId: string;
  origJunction: number;
  startX: number;
  itemsBaseline: { id: string; start: number; end: number }[];
}

interface MarqueeState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  pointerId: number;
}

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(props, ref) {
  const { t } = useI18n();

  const {
    items,
    trackOrder,
    cuts,
    pxPerSec,
    snapEnabled,
    snapThresholdSec,
    cpsThreshold,
    onChangeItems,
    onSelectItem,
    selectedItemId,
    selectedIds: selectedIdsProp,
    onSelectIds,
    playheadSec = 0,
    onPlayheadChange,
    workInSec = null,
    workOutSec = null,
    trackStates = {},
    trackHeights = {},
    onTrackHeightChange,
    onToggleTrackFlag,
    onGestureStart,
    onGestureEnd,
    onBeforeGapClose,
    onGapSelectionChange,
    playing = false
  } = props;

  const selectedIds = selectedIdsProp ?? (selectedItemId ? [selectedItemId] : []);

  const setSelection = (ids: string[]) => {
    onSelectIds?.(ids);
    onSelectItem?.(ids[0] ?? null);
  };

  const toggleInSelection = (id: string) => {
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setSelection(Array.from(set));
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  /** 播放头竖线 DOM；播放中用 imperative 更新 left，减少整表重绘 */
  const playheadLineRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次播放头时间（秒），用于播放中改缩放时重算位置 */
  const lastPlayheadTRef = useRef(playheadSec);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  /** 标尺拖动时 rAF 里调用，避免闭包拿到过期的 onPlayheadChange */
  const onPlayheadChangeRef = useRef(onPlayheadChange);
  onPlayheadChangeRef.current = onPlayheadChange;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  /** Shift+点击扩选时的锚点 id（最近一次「非 Shift」点在片段上设定的条目） */
  const selectionRangeAnchorRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rollDrag, setRollDrag] = useState<RollDragState | null>(null);

  const gapSessionRef = useRef<{
    startT: number;
    startClientX: number;
    startClientY: number;
    pointerId: number;
    alt: boolean;
    /** true 表示指针移动已超过「点击」阈值，按横向拖选空隙处理 */
    dragExceededClickThreshold: boolean;
    /** 指针按下时若命中某条 `trackLane`，用于「仅该轨」空隙选中 */
    laneTrackType: TrackType | null;
  } | null>(null);
  const [gapPreview, setGapPreview] = useState<TimelineGapSelection | null>(null);
  const [gapSelect, setGapSelect] = useState<TimelineGapSelection | null>(null);

  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  /** 框选/间隙拖选挂在 window 上的监听，用 AbortController 在 cancel 时一并移除，避免泄漏 */
  const timelineInteractAbortRef = useRef<AbortController | null>(null);

  const [resizeTrack, setResizeTrack] = useState<{ type: TrackType; startY: number; startH: number } | null>(null);

  /** 避免「点一下未拖动」也入撤销栈：仅在首次产生位移时快照 */
  const undoPrimedDragRef = useRef(false);
  const undoPrimedRollRef = useRef(false);

  const visibleTrackOrder = useMemo(
    () => trackOrder.filter((tt) => !trackStates[tt]?.hidden),
    [trackOrder, trackStates]
  );

  const anySolo = useMemo(() => visibleTrackOrder.some((tt) => trackStates[tt]?.solo), [visibleTrackOrder, trackStates]);

  const getTrackH = (tt: TrackType) => trackHeights[tt] ?? DEFAULT_TRACK_H;

  /**
   * 每条轨道的「重叠分层」布局：同轨时间段重叠的片段排到不同行，避免互相盖住。
   * 对 trackOrder 中每一类轨道都算一遍，空轨也占默认高度。
   */
  const stackMetricsByTrack = useMemo(() => {
    const m = new Map<TrackType, TrackStackMetrics>();
    for (const tt of trackOrder) {
      const laneItems = items.filter((i) => i.trackType === tt);
      m.set(tt, computeTrackStackMetrics(laneItems, pxPerSec));
    }
    return m;
  }, [items, trackOrder, pxPerSec]);

  /** 轨道显示高度：不小于用户拖动值，也不小于分层后的内容高度 */
  const displayTrackHeight = (tt: TrackType) => {
    const stack = stackMetricsByTrack.get(tt);
    const contentMin = stack?.totalStackH ?? MIN_TRACK_H;
    return Math.min(MAX_TRACK_H, Math.max(MIN_TRACK_H, getTrackH(tt), contentMin));
  };

  /** 每条可见轨的垂直范围（相对 timelineInner 顶部），用于框选 */
  const trackVerticalLayout = useMemo(() => {
    let y = RULER_H;
    const map = new Map<TrackType, { top: number; bottom: number }>();
    /** 粗分组线画在「对白」轨上方：布局上在首条可见对白之前预留一条带高度 */
    let addedDialogueTopDivider = false;
    for (const tt of visibleTrackOrder) {
      if (tt === "dialogue" && !addedDialogueTopDivider) {
        y += SOUND_DIVIDER_H;
        addedDialogueTopDivider = true;
      }
      const h = displayTrackHeight(tt);
      map.set(tt, { top: y, bottom: y + h });
      y += h;
    }
    return { map, totalH: y };
  }, [visibleTrackOrder, trackHeights, stackMetricsByTrack]);

  /** 供框选/间隙逻辑读取最新布局，避免闭包滞后 */
  const trackVerticalLayoutRef = useRef(trackVerticalLayout);
  trackVerticalLayoutRef.current = trackVerticalLayout;
  const stackMetricsByTrackRef = useRef(stackMetricsByTrack);
  stackMetricsByTrackRef.current = stackMetricsByTrack;
  const visibleTrackOrderRef = useRef(visibleTrackOrder);
  visibleTrackOrderRef.current = visibleTrackOrder;
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;

  useImperativeHandle(
    ref,
    () => ({
      setPlayheadTimeSec(t: number) {
        lastPlayheadTRef.current = t;
        const lineEl = playheadLineRef.current;
        if (!lineEl) return;
        const x = LABEL_W + t * pxPerSecRef.current;
        lineEl.style.left = `${x}px`;
        /** 播放时横向滚动，使播放头保持在可视区内（留边距） */
        const sc = containerRef.current;
        if (!sc || !playingRef.current) return;
        const w = sc.clientWidth;
        if (w <= 0) return;
        const left = sc.scrollLeft;
        const right = left + w;
        const margin = Math.max(64, Math.floor(w * 0.18));
        if (x < left + margin) {
          sc.scrollLeft = Math.max(0, x - margin);
        } else if (x > right - margin) {
          sc.scrollLeft = Math.min(Math.max(0, sc.scrollWidth - w), x - w + margin);
        }
      }
    }),
    []
  );

  /** 暂停/拖拽标尺：用 state 同步播放头位置 */
  useLayoutEffect(() => {
    if (playing) return;
    const el = playheadLineRef.current;
    if (!el) return;
    lastPlayheadTRef.current = playheadSec;
    el.style.left = `${LABEL_W + playheadSec * pxPerSec}px`;
  }, [playheadSec, pxPerSec, playing]);

  /** 播放中仅改缩放：按缓存时间重算竖线 x */
  useLayoutEffect(() => {
    if (!playing) return;
    const el = playheadLineRef.current;
    if (!el) return;
    const t = lastPlayheadTRef.current;
    el.style.left = `${LABEL_W + t * pxPerSec}px`;
  }, [pxPerSec, playing]);
  const setSelectionRef = useRef(setSelection);
  setSelectionRef.current = setSelection;

  /**
   * 框选命中检测：横坐标与 `clientXToTime` 一致，用 timelineInner 的视口矩形换算片段左右边，
   * 避免横向滚动或容器 border 导致框选与可见片段脱节。
   */
  const pickItemsInMarquee = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const inner = innerRef.current;
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    const ml = Math.min(x0, x1);
    const mr = Math.max(x0, x1);
    const mt = Math.min(y0, y1);
    const mb = Math.max(y0, y1);
    const ids: string[] = [];
    const layoutMap = trackVerticalLayoutRef.current.map;
    const stacks = stackMetricsByTrackRef.current;
    const px = pxPerSecRef.current;
    const vis = visibleTrackOrderRef.current;
    for (const it of itemsRef.current) {
      if (!vis.includes(it.trackType)) continue;
      const lay = layoutMap.get(it.trackType);
      if (!lay) continue;
      const stack = stacks.get(it.trackType);
      const lane = stack?.laneById.get(it.id) ?? 0;
      const clipLeft = ir.left + LABEL_W + it.start * px;
      const clipRight = ir.left + LABEL_W + it.end * px;
      const rowTop = stack ? stack.rowTops[lane] ?? 0 : 0;
      const rowH = stack ? stack.rowHeights[lane] ?? lay.bottom - lay.top : lay.bottom - lay.top;
      const clipTop = ir.top + lay.top + rowTop;
      const clipBot = clipTop + rowH;
      if (clipRight >= ml && clipLeft <= mr && clipBot >= mt && clipTop <= mb) ids.push(it.id);
    }
    setSelectionRef.current(ids);
    /** 框选后_shift 扩选的锚点：排序中最靠前的被选条目 */
    if (ids.length > 0) {
      const ord = sortedTimelineItemIds(itemsRef.current, trackOrderRef.current);
      selectionRangeAnchorRef.current = ord.find((id) => ids.includes(id)) ?? ids[0];
    } else {
      selectionRangeAnchorRef.current = null;
    }
  }, []);

  const rollPairs = useMemo(() => rollPairsByItemId(items), [items]);

  /**
   * 视口坐标 → 时间（秒）。
   * 必须用 `timelineInner` 的定位矩形换算横坐标：它的屏幕位置已随横向 scroll 变化，
   * 等价于「contentX = scrollLeft + (clientX - containerViewportLeft)」，且一并吃掉外层 `.timeline` 的 border，
   * 避免仅用容器 rect + scrollLeft 时漏减 clientLeft 造成播放头与刻度/片段错位。
   */
  const clientXToTime = (clientX: number): number => {
    const innerEl = innerRef.current;
    if (!innerEl) return 0;
    const ir = innerEl.getBoundingClientRect();
    const xInInner = clientX - ir.left;
    const tt = (xInInner - LABEL_W) / pxPerSec;
    return Math.max(0, tt);
  };

  const maxT = useMemo(() => {
    let m = 0;
    for (const it of items) m = Math.max(m, it.end);
    return Math.max(1, m);
  }, [items]);

  const ticks = useMemo(() => {
    const n = Math.ceil(maxT);
    return Array.from({ length: n + 1 }, (_, i) => i);
  }, [maxT]);

  useEffect(() => {
    if (!drag) return;
    const onUp = () => {
      setDrag(null);
      onGestureEnd?.();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, onGestureEnd]);

  useEffect(() => {
    if (!rollDrag) return;
    const onUp = () => {
      setRollDrag(null);
      onGestureEnd?.();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [rollDrag, onGestureEnd]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - drag.startX;
      if (!undoPrimedDragRef.current && Math.abs(dx) > 0.5) {
        undoPrimedDragRef.current = true;
        onGestureStart?.();
      }
      const dt = dx / pxPerSec;

      const baseline = new Map(drag.itemsBaseline.map((x) => [x.id, x] as const));
      if (!baseline.has(drag.itemId)) return;

      const minDur = 0.1;
      const origDur = drag.origEnd - drag.origStart;

      let start = drag.origStart;
      let end = drag.origEnd;

      if (drag.mode === "move") {
        start = drag.origStart + dt;
        end = drag.origEnd + dt;
      } else if (drag.mode === "resizeLeft") {
        start = drag.origStart + dt;
        start = Math.min(start, end - minDur);
      } else {
        end = drag.origEnd + dt;
        end = Math.max(end, start + minDur);
      }

      if (drag.mode === "move") {
        if (start < 0) {
          start = 0;
          end = start + origDur;
        }
      } else {
        start = Math.max(0, start);
        end = Math.max(start + minDur, end);
      }

      if (snapEnabled) {
        if (drag.mode === "move") {
          const snappedStart = snapToCuts(start, cuts, snapThresholdSec);
          const snapDelta = snappedStart - start;
          start = snappedStart;
          end = end + snapDelta;
        } else if (drag.mode === "resizeLeft") {
          start = snapToCuts(start, cuts, snapThresholdSec);
          start = Math.min(start, end - minDur);
        } else {
          end = snapToCuts(end, cuts, snapThresholdSec);
          end = Math.max(end, start + minDur);
        }
      }

      start = roundTime(start);
      end = roundTime(end);

      let rippleDelta = 0;
      if (drag.ripple && (drag.mode === "resizeLeft" || drag.mode === "resizeRight")) {
        rippleDelta = drag.mode === "resizeRight" ? end - drag.origEnd : start - drag.origStart;
      }

      const downstreamAnchor = drag.origEnd;

      let next = itemsRef.current.map((it) => {
        const b = baseline.get(it.id);
        if (!b) return it;

        if (it.id === drag.itemId) {
          return { ...it, start, end };
        }

        if (
          drag.ripple &&
          (drag.mode === "resizeLeft" || drag.mode === "resizeRight") &&
          Math.abs(rippleDelta) > TIME_EPS
        ) {
          if (b.start >= downstreamAnchor - TIME_EPS) {
            return {
              ...it,
              start: roundTime(b.start + rippleDelta),
              end: roundTime(b.end + rippleDelta)
            };
          }
        }

        return { ...it, start: roundTime(b.start), end: roundTime(b.end) };
      });

      /** 画面轨片段：拖动结果与其它画面段不得时间重叠 */
      const draggedNext = next.find((i) => i.id === drag.itemId);
      if (draggedNext?.kind === "visualSegment") {
        const c = clampVisualSegmentInterval(next, drag.itemId, draggedNext.start, draggedNext.end, minDur);
        next = next.map((it) => (it.id === drag.itemId ? { ...it, start: c.start, end: c.end } : it));
      }

      const minStart = Math.min(...next.map((i) => i.start));
      if (minStart < -TIME_EPS) {
        const fix = -minStart;
        onChangeItems(
          next.map((it) => ({
            ...it,
            start: roundTime(it.start + fix),
            end: roundTime(it.end + fix)
          }))
        );
      } else {
        onChangeItems(next);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    return () => window.removeEventListener("pointermove", onMove);
  }, [drag, pxPerSec, snapEnabled, snapThresholdSec, cuts, onChangeItems, onGestureStart]);

  useEffect(() => {
    if (!rollDrag) return;

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - rollDrag.startX;
      if (!undoPrimedRollRef.current && Math.abs(dx) > 0.5) {
        undoPrimedRollRef.current = true;
        onGestureStart?.();
      }
      const dt = dx / pxPerSec;
      let newJ = roundTime(rollDrag.origJunction + dt);

      const baseline = new Map(rollDrag.itemsBaseline.map((x) => [x.id, x] as const));
      const bL = baseline.get(rollDrag.leftItemId);
      const bR = baseline.get(rollDrag.rightItemId);
      if (!bL || !bR) return;

      newJ = Math.max(bL.start + 0.1, Math.min(bR.end - 0.1, newJ));
      if (snapEnabled) newJ = snapToCuts(newJ, cuts, snapThresholdSec);

      const rollItemL = itemsRef.current.find((i) => i.id === rollDrag.leftItemId);
      const rollItemR = itemsRef.current.find((i) => i.id === rollDrag.rightItemId);
      /** 两侧均为画面轨时，junction 不得使任一侧与其它画面段重叠 */
      if (rollItemL?.kind === "visualSegment" && rollItemR?.kind === "visualSegment") {
        newJ = clampVisualRollJunction(
          itemsRef.current,
          rollDrag.leftItemId,
          rollDrag.rightItemId,
          newJ,
          bL.start,
          bR.end,
          0.1,
        );
      }

      const next = itemsRef.current.map((it) => {
        if (it.id === rollDrag.leftItemId) return { ...it, end: newJ };
        if (it.id === rollDrag.rightItemId) return { ...it, start: newJ };
        const b = baseline.get(it.id);
        return b ? { ...it, start: roundTime(b.start), end: roundTime(b.end) } : it;
      });
      onChangeItems(next);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    return () => window.removeEventListener("pointermove", onMove);
  }, [rollDrag, pxPerSec, snapEnabled, snapThresholdSec, cuts, onChangeItems, onGestureStart]);

  /** 间隙选中状态同步到 App（侧栏、快捷键协调等） */
  useEffect(() => {
    onGapSelectionChange?.(gapSelect);
  }, [gapSelect, onGapSelectionChange]);

  useEffect(() => {
    if (!gapSelect) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      if (e.key === "Escape") {
        setGapSelect(null);
        setGapPreview(null);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      /** 捕获阶段优先处理，避免与 App 中「删除选中片段」的 Delete 冲突 */
      e.stopPropagation();
      onBeforeGapClose?.();
      const { lo, hi } = gapSelect;
      const delta = hi - lo;
      const next = itemsRef.current.map((it) => {
        const shouldRipple =
          gapSelect.scope === "global"
            ? it.start >= hi - TIME_EPS
            : it.trackType === gapSelect.trackType && it.start >= hi - TIME_EPS;
        if (shouldRipple) {
          return { ...it, start: roundTime(it.start - delta), end: roundTime(it.end - delta) };
        }
        return it;
      });
      const minStart = Math.min(...next.map((i) => i.start));
      if (minStart < -TIME_EPS) {
        const fix = -minStart;
        onChangeItems(
          next.map((it) => ({
            ...it,
            start: roundTime(it.start + fix),
            end: roundTime(it.end + fix)
          }))
        );
      } else {
        onChangeItems(next);
      }
      setGapSelect(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [gapSelect, onChangeItems, onBeforeGapClose]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return;
      const dominant = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(dominant) < 0.25) return;
      e.preventDefault();
      el.scrollLeft += dominant;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!resizeTrack || !onTrackHeightChange) return;
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - resizeTrack.startY;
      const nh = Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, resizeTrack.startH + dy));
      onTrackHeightChange(resizeTrack.type, nh);
    };
    const onUp = () => setResizeTrack(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizeTrack, onTrackHeightChange]);

  const itemsByTrack = useMemo(() => {
    const map = new Map<TrackType, TimelineItem[]>();
    for (const tt of trackOrder) map.set(tt, []);
    for (const it of items) {
      const arr = map.get(it.trackType) ?? [];
      arr.push(it);
      map.set(it.trackType, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.start - b.start);
    }
    return map;
  }, [items, trackOrder]);

  const onTimelinePointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement;
    if (target.closest("[data-clip-id]") || target.closest("[data-roll-junction]")) return;
    if (target.closest(".ruler") || target.closest(".trackLabel")) return;
    /** 轨高拖动条：不参与空隙点选/拖选 */
    if (target.closest(".trackResizeHandle")) return;

    const host = ev.currentTarget as HTMLElement;
    const pid = ev.pointerId;
    timelineInteractAbortRef.current?.abort();
    const ac = new AbortController();
    timelineInteractAbortRef.current = ac;
    const sig = ac.signal;

    /** Alt 或 Shift + 拖：框选（window 监听，滑出时间线仍可更新/结束） */
    if (ev.altKey || ev.shiftKey) {
      const sx = ev.clientX;
      const sy = ev.clientY;
      setMarquee({ startX: sx, startY: sy, curX: sx, curY: sy, pointerId: pid });
      setGapPreview(null);
      setGapSelect(null);
      gapSessionRef.current = null;

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pid) return;
        setMarquee((m) => (m && m.pointerId === pid ? { ...m, curX: e.clientX, curY: e.clientY } : m));
      };
      const onEnd = (e: PointerEvent) => {
        if (e.pointerId !== pid) return;
        const ex = e.clientX;
        const ey = e.clientY;
        setMarquee((m) => {
          if (!m || m.pointerId !== pid) return null;
          pickItemsInMarquee(m.startX, m.startY, ex, ey);
          return null;
        });
        onGestureEnd?.();
        try {
          host.releasePointerCapture(pid);
        } catch {
          /* */
        }
        ac.abort();
        if (timelineInteractAbortRef.current === ac) timelineInteractAbortRef.current = null;
      };
      window.addEventListener("pointermove", onMove, { signal: sig });
      window.addEventListener("pointerup", onEnd, { signal: sig });
      window.addEventListener("pointercancel", onEnd, { signal: sig });
      host.setPointerCapture(pid);
      return;
    }

    /**
     * 无修饰键：
     * - **单击**（几乎未移动）：选中点击时刻所在的最大全局空隙（剪辑软件式「点空白→亮一块→Delete 波纹左移」）
     * - **横向拖动**：沿用原有拖选空隙矩形逻辑
     */
    const t0 = clientXToTime(ev.clientX);
    gapSessionRef.current = {
      startT: t0,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      pointerId: pid,
      alt: false,
      dragExceededClickThreshold: false,
      laneTrackType: parseTrackLaneTypeFromTarget(target)
    };
    setGapPreview(null);
    setGapSelect(null);
    setSelection([]);
    selectionRangeAnchorRef.current = null;
    setMarquee(null);

    const onGapMove = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      const sess = gapSessionRef.current;
      if (!sess) return;
      const dx = e.clientX - sess.startClientX;
      const dy = e.clientY - sess.startClientY;
      if (!sess.dragExceededClickThreshold && dx * dx + dy * dy > GAP_CLICK_DRAG_THRESHOLD_SQ) {
        sess.dragExceededClickThreshold = true;
      }
      if (!sess.dragExceededClickThreshold) return;
      const t1 = clientXToTime(e.clientX);
      const s = sess.startT;
      const lo = Math.min(s, t1);
      const hi = Math.max(s, t1);
      if (hi - lo < GAP_MIN_SEC) {
        setGapPreview(null);
        return;
      }
      if (isRangeGloballyEmpty(itemsRef.current, lo, hi)) {
        setGapPreview({ scope: "global", lo, hi });
      } else if (sess.laneTrackType && isRangeEmptyOnTrack(itemsRef.current, lo, hi, sess.laneTrackType)) {
        setGapPreview({ scope: "track", trackType: sess.laneTrackType, lo, hi });
      } else {
        setGapPreview(null);
      }
    };
    const onGapEnd = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      const sess = gapSessionRef.current;
      gapSessionRef.current = null;
      setGapPreview(null);
      try {
        host.releasePointerCapture(pid);
      } catch {
        /* */
      }
      if (!sess) {
        ac.abort();
        if (timelineInteractAbortRef.current === ac) timelineInteractAbortRef.current = null;
        return;
      }

      if (!sess.dragExceededClickThreshold) {
        /** 点选：优先「全轨空白」；否则尝试「仅当前轨空白」 */
        const innerEl = innerRef.current;
        const canvasRightSec = innerEl ? Math.max(0, (innerEl.scrollWidth - LABEL_W) / pxPerSecRef.current) : 120;
        const gGlobal = globallyEmptyGapAtClick(itemsRef.current, sess.startT, canvasRightSec);
        if (gGlobal && isRangeGloballyEmpty(itemsRef.current, gGlobal.lo, gGlobal.hi)) {
          setGapSelect({ scope: "global", lo: gGlobal.lo, hi: gGlobal.hi });
        } else if (sess.laneTrackType) {
          const gTr = trackEmptyGapAtClick(
            itemsRef.current,
            sess.startT,
            canvasRightSec,
            sess.laneTrackType
          );
          if (
            gTr &&
            isRangeEmptyOnTrack(itemsRef.current, gTr.lo, gTr.hi, sess.laneTrackType)
          ) {
            setGapSelect({ scope: "track", trackType: sess.laneTrackType, lo: gTr.lo, hi: gTr.hi });
          } else {
            setGapSelect(null);
          }
        } else {
          setGapSelect(null);
        }
      } else {
        const t1 = clientXToTime(e.clientX);
        const lo = Math.min(sess.startT, t1);
        const hi = Math.max(sess.startT, t1);
        if (hi - lo < GAP_MIN_SEC) {
          setGapSelect(null);
        } else if (isRangeGloballyEmpty(itemsRef.current, lo, hi)) {
          setGapSelect({ scope: "global", lo, hi });
        } else if (sess.laneTrackType && isRangeEmptyOnTrack(itemsRef.current, lo, hi, sess.laneTrackType)) {
          setGapSelect({ scope: "track", trackType: sess.laneTrackType, lo, hi });
        } else {
          setGapSelect(null);
        }
      }
      ac.abort();
      if (timelineInteractAbortRef.current === ac) timelineInteractAbortRef.current = null;
    };
    window.addEventListener("pointermove", onGapMove, { signal: sig });
    window.addEventListener("pointerup", onGapEnd, { signal: sig });
    window.addEventListener("pointercancel", onGapEnd, { signal: sig });
    host.setPointerCapture(pid);
  };

  const onTimelinePointerCancel = (ev: React.PointerEvent) => {
    timelineInteractAbortRef.current?.abort();
    timelineInteractAbortRef.current = null;
    gapSessionRef.current = null;
    setGapPreview(null);
    setMarquee(null);
    try {
      (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
    } catch {
      /* */
    }
  };

  /**
   * 标尺：按下即可跳转，按住拖动连续 scrub。
   * 拖动中主要改播放头 DOM + lastPlayheadTRef，onPlayheadChange 用 rAF 节流，减轻整表重绘卡顿。
   */
  const onRulerPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const host = ev.currentTarget as HTMLElement;
    const pid = ev.pointerId;

    const applyT = (clientX: number) => {
      const t = roundTime(clientXToTime(clientX));
      lastPlayheadTRef.current = t;
      const lineEl = playheadLineRef.current;
      if (lineEl) lineEl.style.left = `${LABEL_W + t * pxPerSecRef.current}px`;
      return t;
    };

    applyT(ev.clientX);
    let rafId = 0;
    const flushToParent = () => {
      rafId = 0;
      onPlayheadChangeRef.current?.(lastPlayheadTRef.current);
    };
    const scheduleFlush = () => {
      if (!rafId) rafId = requestAnimationFrame(flushToParent);
    };
    scheduleFlush();

    const ac = new AbortController();
    const sig = ac.signal;
    try {
      host.setPointerCapture(pid);
    } catch {
      /* 部分环境可能不支持 */
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      applyT(e.clientX);
      scheduleFlush();
    };
    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      ac.abort();
      try {
        host.releasePointerCapture(pid);
      } catch {
        /* */
      }
      if (rafId) cancelAnimationFrame(rafId);
      const tf = applyT(e.clientX);
      onPlayheadChangeRef.current?.(tf);
    };

    window.addEventListener("pointermove", onMove, { signal: sig });
    window.addEventListener("pointerup", onEnd, { signal: sig });
    window.addEventListener("pointercancel", onEnd, { signal: sig });
  };

  const totalWidth = Math.max(900, maxT * pxPerSec + 180);

  const gapBand = gapPreview ?? gapSelect;

  const workShade =
    workInSec != null && workOutSec != null && workOutSec > workInSec ? (
      <>
        {workInSec > 0 ? (
          <div
            className="workAreaShade"
            style={{ left: LABEL_W, width: workInSec * pxPerSec }}
            aria-hidden
          />
        ) : null}
        <div
          className="workAreaActive"
          style={{
            left: LABEL_W + workInSec * pxPerSec,
            width: (workOutSec - workInSec) * pxPerSec
          }}
          aria-hidden
        />
        {workOutSec < maxT ? (
          <div
            className="workAreaShade"
            style={{
              left: LABEL_W + workOutSec * pxPerSec,
              width: (maxT - workOutSec) * pxPerSec
            }}
            aria-hidden
          />
        ) : null}
      </>
    ) : null;

  /**
   * 点击标尺/片段/空白等（非 button/input）时把焦点收到时间线根节点，
   * 以便 App 侧仅在「时间线区域获得焦点」时响应 Ctrl+A / macOS Cmd+A 全选。
   */
  const onTimelineMouseDownFocusRoot = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("input, textarea, select, button, a[href], [contenteditable='true']")) return;
    (ev.currentTarget as HTMLDivElement).focus({ preventScroll: true });
  };

  return (
    <div
      className="timeline"
      ref={containerRef}
      data-timeline-focus-root
      tabIndex={-1}
      onMouseDown={onTimelineMouseDownFocusRoot}
      onPointerDown={onTimelinePointerDown}
      onPointerCancel={onTimelinePointerCancel}
    >
      <div ref={innerRef} className="timelineInner" style={{ width: totalWidth, minHeight: trackVerticalLayout.totalH }}>
        <div className="timelineUnderlay" style={{ bottom: 0 }}>
          {workShade}
        </div>

        {gapBand?.scope === "global" ? (
          <div
            className="gapSelectionBand"
            style={{
              left: LABEL_W + gapBand.lo * pxPerSec,
              width: Math.max(2, (gapBand.hi - gapBand.lo) * pxPerSec)
            }}
            aria-hidden
          />
        ) : null}

        {marquee ? (
          <div
            className="marqueeRect"
            style={{
              position: "fixed",
              left: Math.min(marquee.startX, marquee.curX),
              top: Math.min(marquee.startY, marquee.curY),
              width: Math.abs(marquee.curX - marquee.startX),
              height: Math.abs(marquee.curY - marquee.startY),
              zIndex: 2000,
              pointerEvents: "none"
            }}
            aria-hidden
          />
        ) : null}

        <div
          className="ruler"
          style={{ height: RULER_H }}
          onPointerDown={onRulerPointerDown}
        >
          <div className="rulerTicks">
            {ticks.map((sec) => (
              <div
                key={sec}
                className="tick mono"
                style={{ left: LABEL_W + sec * pxPerSec }}
                title={t("timelineTick", { sec })}
              >
                {t("timelineTick", { sec })}
              </div>
            ))}
          </div>
        </div>

        <div ref={playheadLineRef} className="playheadLine" aria-hidden />

        {cuts.map((ct) => (
          <div key={ct} className="cutLine" style={{ left: LABEL_W + ct * pxPerSec, top: 0 }} />
        ))}

        {visibleTrackOrder.map((tt, idx) => {
          /** 口播区顶部分组线：画在首条可见「对白」轨之前（对白与画面/动作等上方区域分界） */
          const firstDialogueIdx = visibleTrackOrder.indexOf("dialogue");
          const showSpeechBlockDivider = firstDialogueIdx >= 0 && idx === firstDialogueIdx;
          const laneItems = itemsByTrack.get(tt) ?? [];
          /** 显示高度：用户值、分层内容高度、上限三者取齐 */
          const th = displayTrackHeight(tt);
          const stack = stackMetricsByTrack.get(tt)!;
          const dim =
            anySolo && !trackStates[tt]?.solo ? " trackLaneDimmed" : "";
          const locked = trackStates[tt]?.locked;

          return (
            <React.Fragment key={tt}>
              {showSpeechBlockDivider ? <div className="trackSoundDivider" aria-hidden /> : null}
              <div className="track trackRow" style={{ minHeight: th }}>
                <div className="trackLabel" style={{ minHeight: th }}>
                  <div className="trackLabelBtns">
                    <button
                      type="button"
                      className={`trackFlagBtn${trackStates[tt]?.locked ? " active" : ""}`}
                      title={t("trackLock")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleTrackFlag?.(tt, "locked");
                      }}
                    >
                      L
                    </button>
                    <button
                      type="button"
                      className={`trackFlagBtn${trackStates[tt]?.solo ? " active" : ""}`}
                      title={t("trackSolo")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleTrackFlag?.(tt, "solo");
                      }}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      className={`trackFlagBtn${trackStates[tt]?.hidden ? " active" : ""}`}
                      title={t("trackHide")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleTrackFlag?.(tt, "hidden");
                      }}
                    >
                      H
                    </button>
                  </div>
                  <span className="trackLabelText">{trackTypeLabel(tt, t)}</span>
                </div>
                <div className="trackLaneColumn">
                  <div className={`trackLane${dim}`} data-track-lane={tt} style={{ minHeight: th }}>
                    {/* 单轨空隙画在 lane 内，left 与 clip 一致（相对 lane），避免外层推算纵向偏移错误 */}
                    {gapBand && gapBand.scope === "track" && gapBand.trackType === tt ? (
                      <div
                        className="gapSelectionBand gapSelectionBandTrack gapSelectionBandInLane"
                        style={{
                          left: gapBand.lo * pxPerSec,
                          width: Math.max(2, (gapBand.hi - gapBand.lo) * pxPerSec)
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {rollPairs
                      .filter((p) => items.find((i) => i.id === p.leftItemId)?.trackType === tt)
                      .map((p) => (
                        <div
                          key={`roll-${p.leftItemId}-${p.rightItemId}`}
                          data-roll-junction
                          className="rollJunction"
                          style={{ left: p.junction * pxPerSec }}
                          title={t("rollEditHint")}
                          onPointerDown={(ev) => {
                            if (locked) return;
                            ev.stopPropagation();
                            ev.preventDefault();
                            setGapSelect(null);
                            setGapPreview(null);
                            undoPrimedRollRef.current = false;
                            (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                            setRollDrag({
                              leftItemId: p.leftItemId,
                              rightItemId: p.rightItemId,
                              origJunction: p.junction,
                              startX: ev.clientX,
                              itemsBaseline: itemsRef.current.map((x) => ({ id: x.id, start: x.start, end: x.end }))
                            });
                          }}
                        />
                      ))}
                  {laneItems.map((it) => {
                    const left = it.start * pxPerSec;
                    const width = Math.max(8, (it.end - it.start) * pxPerSec);
                    const lane = stack.laneById.get(it.id) ?? 0;
                    const rowTop = stack.rowTops[lane] ?? STACK_TRACK_PAD_PX;
                    const rowH = stack.rowHeights[lane] ?? 40;

                    const cps =
                      it.trackType === "dialogue" || it.trackType === "narration"
                        ? calcCps(it.rawText ?? "", it.start, it.end)
                        : 0;
                    const speechDanger =
                      (it.trackType === "dialogue" || it.trackType === "narration") && cps > cpsThreshold;
                    const visualStructIssues: VisualStructIssue[] =
                      it.kind === "visualSegment" ? it.visualStructIssues ?? [] : [];
                    const visualStructDanger = visualStructIssues.length > 0;
                    const isDanger = speechDanger || visualStructDanger;

                    const isSelected = selectedIds.includes(it.id);

                    const clipTitleTooltip = (() => {
                      const lines: string[] = [
                        it.title,
                        `${fmtTime(it.start)} - ${fmtTime(it.end)}`,
                        it.subtitle ?? ""
                      ].filter((x) => x.length > 0);
                      if (speechDanger) {
                        lines.push(`⚠ ${t("tooltipCpsWarn", { cps: cps.toFixed(2), max: cpsThreshold })}`);
                      }
                      for (const code of visualStructIssues) {
                        lines.push(`⚠ ${t(VISUAL_STRUCT_ISSUE_KEY[code])}`);
                      }
                      return lines.join("\n");
                    })();

                    /** 各轨 clip 用独立色调区分（与 .clip.visual / .narration 等样式对应） */
                    const toneClass =
                      tt === "visual" ||
                      tt === "narration" ||
                      tt === "dialogue" ||
                      tt === "action" ||
                      tt === "sfx" ||
                      tt === "info" ||
                      tt === "environment" ||
                      tt === "subtitle"
                        ? tt
                        : "";
                    const className = ["clip", toneClass, isDanger ? "danger" : ""].filter(Boolean).join(" ");

                    const onClipPointerDown = (ev: React.PointerEvent, mode: DragMode) => {
                      if (locked) return;
                      ev.stopPropagation();
                      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                      /** 先前若选中了空隙条，点片段应取消空隙选中，避免两种选中状态并存 */
                      setGapSelect(null);
                      setGapPreview(null);

                      /** 时间线顺序（先按开始时间，再按轨道顺序），供 Shift 扩选 */
                      const ordered = sortedTimelineItemIds(itemsRef.current, trackOrderRef.current);
                      let anchor = selectionRangeAnchorRef.current;
                      if (!anchor || !ordered.includes(anchor)) {
                        anchor = selectedIds[0] ?? null;
                      }

                      if (ev.shiftKey && anchor && ordered.includes(it.id)) {
                        const ia = ordered.indexOf(anchor);
                        const ib = ordered.indexOf(it.id);
                        const lo = Math.min(ia, ib);
                        const hi = Math.max(ia, ib);
                        const rangeIds = ordered.slice(lo, hi + 1);
                        if (ev.ctrlKey || ev.metaKey) {
                          const union = new Set(selectedIds);
                          for (const id of rangeIds) union.add(id);
                          setSelection(Array.from(union));
                        } else {
                          setSelection(rangeIds);
                        }
                      } else if (ev.ctrlKey || ev.metaKey) {
                        toggleInSelection(it.id);
                        selectionRangeAnchorRef.current = it.id;
                      } else {
                        setSelection([it.id]);
                        selectionRangeAnchorRef.current = it.id;
                      }

                      undoPrimedDragRef.current = false;
                      const ripple =
                        (mode === "resizeLeft" || mode === "resizeRight") && (ev.ctrlKey || ev.metaKey);
                      setDrag({
                        itemId: it.id,
                        mode,
                        startX: ev.clientX,
                        origStart: it.start,
                        origEnd: it.end,
                        ripple,
                        itemsBaseline: itemsRef.current.map((x) => ({ id: x.id, start: x.start, end: x.end }))
                      });
                    };

                    return (
                      <div
                        key={it.id}
                        data-clip-id={it.id}
                        className={className}
                        style={{
                          left,
                          width,
                          top: rowTop,
                          height: rowH,
                          bottom: "auto",
                          zIndex: isSelected ? 26 : 10 + lane,
                          outline: isSelected ? "2px solid rgba(106,166,255,0.8)" : "none",
                          outlineOffset: "1px"
                        }}
                        title={clipTitleTooltip}
                        onPointerDown={(ev) => onClipPointerDown(ev, "move")}
                      >
                        <div
                          className="handle left"
                          title={t("timelineHandleRipple")}
                          onPointerDown={(ev) => onClipPointerDown(ev, "resizeLeft")}
                        />
                        {/* 中间区单独滚动，避免滚动条盖住右侧修剪手柄 */}
                        <div className="clipBody">
                          <div className="clipTitle">
                            {it.title}{" "}
                            <span
                              className="mono"
                              style={{ opacity: 0.75 }}
                              title={t("clipDurationTooltip", {
                                start: fmtTime(it.start),
                                end: fmtTime(it.end)
                              })}
                            >
                              {t("clipDurationDisplay", {
                                sec: Math.max(0, it.end - it.start).toFixed(1)
                              })}
                            </span>
                          </div>
                          {it.trackType === "visual" && it.subtitle ? (
                            <div className="clipStruct mono" title={it.subtitle}>
                              {it.subtitle}
                            </div>
                          ) : null}
                          <div className="clipSub">
                            {it.trackType === "visual"
                              ? it.rawText ?? ""
                              : it.rawText ?? it.subtitle ?? ""}
                            {(it.trackType === "dialogue" || it.trackType === "narration") && (
                              <span className="mono" style={{ marginLeft: 8, opacity: 0.75 }}>
                                {t("clipCpsLabel")} {cps.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          className="handle right"
                          title={t("timelineHandleRipple")}
                          onPointerDown={(ev) => onClipPointerDown(ev, "resizeRight")}
                        />
                      </div>
                    );
                  })}
                  </div>
                  {onTrackHeightChange ? (
                    <div
                      className="trackResizeHandle"
                      onPointerDown={(ev) => {
                        if (ev.button !== 0) return;
                        ev.stopPropagation();
                        /** 从当前「实际显示高度」起算拖动，避免自动撑高后与内部存储不一致导致跳变 */
                        setResizeTrack({ type: tt, startY: ev.clientY, startH: th });
                      }}
                      title={t("trackResizeHint")}
                    />
                  ) : null}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});

Timeline.displayName = "Timeline";
