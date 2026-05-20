import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraMoveCode, FramingCode, MoveAmplitude, ScriptCutProject, TrackType } from "../types.js";
import { clampVisualSegmentInterval } from "./visualSegmentClamp.js";
import {
  CAMERA_MOVE_CODES,
  CAMERA_MOVE_LABELS_ZH,
  FRAMING_CODES,
  FRAMING_LABELS_ZH,
  MOVE_AMPLITUDE_LABELS_ZH,
  MOVE_AMPLITUDES
} from "../filmVocabulary.js";
import { kindLabel, trackTypeLabel } from "./i18n.js";
import { FeatureHelp } from "./FeatureHelp.js";
import { useI18n } from "./I18nProvider.js";
import { readLayoutWidths, writeLayoutWidths, type LayoutWidths } from "./persistedLayout.js";
import { SidebarSection } from "./SidebarSection.js";
import type { TimelineHandle, TrackUiState } from "./Timeline.js";
import { Timeline, TIMELINE_LABEL_COLUMN_PX } from "./Timeline.js";
import {
  buildClipboardPayload,
  cloneProject,
  duplicateTimelineItems,
  pasteClipboardAtTime,
  splitTimelineItemAtTime,
  TIMELINE_SPLIT_EDGE_PAD_SEC
} from "./editOps.js";
import {
  addEmptyClipToProject,
  addVisualSegmentToProject,
  applyItemsToProject,
  autoGenerateCutsAndRebuildVisualSegments,
  createBlankScriptCutProject,
  deleteTimelineItemsFromProject,
  extendClipToMinSpeechDurationNoRipple,
  extendClipToMinSpeechDurationWithRipple,
  resolveSpeechOverlapsWithGlobalRipple,
  readProjectFromJsonText,
  sortedTimelineItemIds,
  splitClipByPunctuationIntoClips,
  TIMELINE_TRACK_ORDER,
  toTimelineState,
  updateClipFields,
  updateVisualSegmentFields
} from "./model.js";
import { downloadText, editedExportFilename, fmtTime } from "./utils.js";
import { DEFAULT_SPEECH_PARAMS, estimateSpeech } from "./speechModel.js";

/**
 * App：时间轴容器
 *
 * - 播放头 / 工作区循环 / 标尺跳转
 * - 多选、复制粘贴重复、播放头拆分、roll（在 Timeline 内）
 * - 轨锁定/独奏/隐藏、轨高、声画分组粗分割线
 * - 撤销/重做（工程 JSON 快照；轨高与 L/S/H 不入栈）
 */

const DEFAULT_CPS_THRESHOLD = 12;
const UNDO_CAP = 60;

/** 时间线横向缩放 `pxPerSec` 范围与默认值（与左侧数值框、Timeline 内滚轮一致） */
const ZOOM_PX_MIN = 40;
const ZOOM_PX_MAX = 420;
const ZOOM_PX_DEFAULT = 140;

export function App() {
  const { t, locale, setLocale } = useI18n();

  const [project, setProject] = useState<ScriptCutProject | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const [pxPerSec, setPxPerSec] = useState(ZOOM_PX_DEFAULT);
  /** 缩放后是否尽量将播放头滚入可视区（指针锚点缩放后再微调） */
  const [zoomKeepPlayheadVisible, setZoomKeepPlayheadVisible] = useState(true);

  /** 三栏宽度（像素），可拖拽分隔条调整并写入 localStorage */
  const [layoutWidths, setLayoutWidths] = useState<LayoutWidths>(() => readLayoutWidths());

  /** 左分隔条：向右拖加宽左栏 */
  const onResizeLeftGutter = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startLeft = layoutWidths.left;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      setLayoutWidths((w) => ({
        ...w,
        left: Math.max(220, Math.min(440, startLeft + dx))
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLayoutWidths((w) => {
        writeLayoutWidths(w);
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [layoutWidths.left]);

  /** 右分隔条：向右拖减窄右栏（中间变宽） */
  const onResizeRightGutter = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startRight = layoutWidths.right;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      setLayoutWidths((w) => ({
        ...w,
        right: Math.max(240, Math.min(560, startRight - dx))
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLayoutWidths((w) => {
        writeLayoutWidths(w);
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [layoutWidths.right]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapThresholdSec, setSnapThresholdSec] = useState(0.1);
  const [cpsThreshold, setCpsThreshold] = useState(DEFAULT_CPS_THRESHOLD);

  /** 多选：时间线条目 id（item_vs_* / item_clip_*） */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [workInSec, setWorkInSec] = useState<number | null>(null);
  const [workOutSec, setWorkOutSec] = useState<number | null>(null);

  const [trackStates, setTrackStates] = useState<Partial<Record<TrackType, TrackUiState>>>({});
  const [trackHeights, setTrackHeights] = useState<Partial<Record<TrackType, number>>>({});

  const undoStackRef = useRef<ScriptCutProject[]>([]);
  const redoStackRef = useRef<ScriptCutProject[]>([]);
  const clipboardRef = useRef<ReturnType<typeof buildClipboardPayload> | null>(null);

  const playBoundsRef = useRef({
    maxT: 30 as number,
    workIn: null as number | null,
    workOut: null as number | null
  });

  const [autoMinSegSec, setAutoMinSegSec] = useState(1.5);
  const [autoMaxSegSec, setAutoMaxSegSec] = useState(3.5);
  const [autoKeepExistingCuts, setAutoKeepExistingCuts] = useState(true);

  const [importError, setImportError] = useState<string | null>(null);
  const [helpMode, setHelpMode] = useState(false);
  /** 「在播放头新建片段」默认落轨 */
  /** 「新建片段」下拉菜单是否展开（选类型后在播放头插入约 2s 空 clip） */
  const [newClipMenuOpen, setNewClipMenuOpen] = useState(false);
  const newClipMenuRef = useRef<HTMLDivElement | null>(null);

  /** 新建画面段弹窗：null 关闭；startSec 为插入时间（由工具栏「新建 ▾」选画面轨打开） */
  const [newVsModal, setNewVsModal] = useState<{ startSec: number } | null>(null);
  const [vsFormLabel, setVsFormLabel] = useState("");
  const [vsFormDuration, setVsFormDuration] = useState("2.5");

  /** 播放循环内写回时间线竖线与滚动，与 state 解耦以减轻卡顿 */
  const timelineHandleRef = useRef<TimelineHandle | null>(null);
  const playheadSecRef = useRef(playheadSec);
  playheadSecRef.current = playheadSec;

  const timelineState = useMemo(() => {
    if (!project) return null;
    return toTimelineState(project);
  }, [project]);

  const cuts = useMemo(() => {
    if (!project) return [];
    return project.cuts.map((c) => c.t).sort((a, b) => a - b);
  }, [project]);

  const timelineMaxT = useMemo(() => {
    if (!timelineState) return 1;
    let m = 0;
    for (const it of timelineState.items) m = Math.max(m, it.end);
    return Math.max(1, m);
  }, [timelineState]);

  /** 与 Timeline 内 Ctrl+滚轮一致，将 pxPerSec 限制在合法区间 */
  const setPxPerSecClamped = useCallback((n: number) => {
    setPxPerSec(Math.max(ZOOM_PX_MIN, Math.min(ZOOM_PX_MAX, Math.round(n))));
  }, []);

  /** 工具栏 ±：以当前播放头为锚缩放 */
  const onToolbarZoomStep = useCallback((dir: -1 | 1) => {
    const h = timelineHandleRef.current;
    if (!h) return;
    h.anchorZoomAtTimeSec(playheadSecRef.current);
    setPxPerSec((p) =>
      Math.max(ZOOM_PX_MIN, Math.min(ZOOM_PX_MAX, Math.round(p * (dir > 0 ? 1.12 : 1 / 1.12))))
    );
  }, []);

  /** 恢复默认缩放（100%） */
  const onToolbarZoomReset = useCallback(() => {
    const h = timelineHandleRef.current;
    if (!h) return;
    h.anchorZoomAtTimeSec(playheadSecRef.current);
    setPxPerSec(ZOOM_PX_DEFAULT);
  }, []);

  /** 适配整条时间线进视口（略留边距） */
  const onFitTimelineAll = useCallback(() => {
    const h = timelineHandleRef.current;
    if (!h || !timelineState) return;
    const w = h.getViewportClientWidth();
    if (w <= 16) return;
    const dur = Math.max(0.5, timelineMaxT);
    const usable = Math.max(80, w - TIMELINE_LABEL_COLUMN_PX - 20);
    const next = Math.max(ZOOM_PX_MIN, Math.min(ZOOM_PX_MAX, Math.round((usable / dur) * 0.92)));
    setPxPerSec(next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => h.scrollToTimeSec(0, "left"));
    });
  }, [timelineState, timelineMaxT]);

  /** 适配当前多选片段的时间范围进视口 */
  const onFitTimelineSelection = useCallback(() => {
    const h = timelineHandleRef.current;
    if (!h || !timelineState || selectedIds.length === 0) return;
    const items = timelineState.items.filter((i) => selectedIds.includes(i.id));
    if (!items.length) return;
    const t0 = Math.min(...items.map((i) => i.start));
    const t1 = Math.max(...items.map((i) => i.end));
    const dur = Math.max(0.25, t1 - t0);
    const w = h.getViewportClientWidth();
    if (w <= 16) return;
    const usable = Math.max(80, w - TIMELINE_LABEL_COLUMN_PX - 20);
    const next = Math.max(ZOOM_PX_MIN, Math.min(ZOOM_PX_MAX, Math.round((usable / dur) * 0.92)));
    setPxPerSec(next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => h.scrollToTimeSec(t0, "left"));
    });
  }, [timelineState, selectedIds]);

  useEffect(() => {
    playBoundsRef.current = { maxT: timelineMaxT, workIn: workInSec, workOut: workOutSec };
  }, [timelineMaxT, workInSec, workOutSec]);

  const selectedItem = useMemo(() => {
    if (!timelineState || selectedIds.length === 0) return null;
    return timelineState.items.find((x) => x.id === selectedIds[0]) ?? null;
  }, [timelineState, selectedIds]);

  const selectedSegment = useMemo(() => {
    if (!project || !selectedItem || selectedItem.kind !== "visualSegment") return null;
    return project.visualSegments.find((s) => s.id === selectedItem.segmentId) ?? null;
  }, [project, selectedItem]);

  /** 检查器编辑 clip 字段时用工程内最新 Clip（与时间线条目同源） */
  const selectedClip = useMemo(() => {
    if (!project || !selectedItem || selectedItem.kind !== "clip") return null;
    return project.clips.find((c) => c.id === selectedItem.clipId) ?? null;
  }, [project, selectedItem]);

  /** 手势开始前快照，供撤销（拖拽/roll 由 Timeline 触发） */
  const beginGesture = () => {
    const p = projectRef.current;
    if (!p) return;
    undoStackRef.current.push(cloneProject(p));
    if (undoStackRef.current.length > UNDO_CAP) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  const undo = () => {
    const p = projectRef.current;
    if (!p || undoStackRef.current.length === 0) return;
    redoStackRef.current.push(cloneProject(p));
    const prev = undoStackRef.current.pop()!;
    setProject(prev);
  };

  const redo = () => {
    const p = projectRef.current;
    if (!p || redoStackRef.current.length === 0) return;
    undoStackRef.current.push(cloneProject(p));
    const next = redoStackRef.current.pop()!;
    setProject(next);
  };

  /**
   * 播放：rAF 推进时间；每帧只 imperative 更新时间线播放头（避免整棵时间轴随 setState 60 次/秒重绘）。
   * 工具栏等处的 playheadSec 用 startTransition 低频同步（约 15Hz）。
   */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let frame = 0;
    let t = playheadSecRef.current;
    const tAnimRef = { current: t };
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { maxT, workIn, workOut } = playBoundsRef.current;
      t += dt;
      const hasLoop = workIn != null && workOut != null && workOut > workIn + 0.05;
      if (hasLoop) {
        if (t >= workOut - 1e-6) t = workIn;
      } else if (t >= maxT) {
        t = maxT;
        tAnimRef.current = t;
        playheadSecRef.current = t;
        timelineHandleRef.current?.setPlayheadTimeSec(t);
        startTransition(() => setPlayheadSec(t));
        setPlaying(false);
        return;
      }
      t = Math.round(t * 1000) / 1000;
      tAnimRef.current = t;
      playheadSecRef.current = t;
      timelineHandleRef.current?.setPlayheadTimeSec(t);
      frame += 1;
      if (frame % 4 === 0) {
        startTransition(() => setPlayheadSec(t));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      const endT = tAnimRef.current;
      playheadSecRef.current = endT;
      startTransition(() => setPlayheadSec(endT));
      timelineHandleRef.current?.setPlayheadTimeSec(endT);
    };
  }, [playing]);

  /** 空格：播放/暂停；i/o：工作区入点/出点（不在输入框内） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!timelineState) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      if (e.key === "i" || e.key === "I") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        setWorkInSec(playheadSec);
        return;
      }
      if (e.key === "o" || e.key === "O") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        setWorkOutSec(playheadSec);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timelineState, playheadSec]);

  /** 复制 / 粘贴 / 重复 / 撤销 / 重做 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!timelineState || !project) return;
      if (e.key === "c" || e.key === "C") {
        const payload = buildClipboardPayload(
          project,
          timelineState.items.filter((i) => selectedIds.includes(i.id))
        );
        if (payload) {
          e.preventDefault();
          clipboardRef.current = payload;
        }
        return;
      }
      if (e.key === "v" || e.key === "V") {
        const data = clipboardRef.current;
        if (!data) return;
        e.preventDefault();
        beginGesture();
        setProject(pasteClipboardAtTime(project, data, playheadSec));
        return;
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        const items = timelineState.items.filter((i) => selectedIds.includes(i.id));
        const next = duplicateTimelineItems(project, items);
        if (!next) return;
        beginGesture();
        setProject(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timelineState, project, selectedIds, playheadSec]);

  /** ← → 多选平移 */
  useEffect(() => {
    if (helpMode || !timelineState || selectedIds.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable))
        return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      beginGesture();
      const step = e.shiftKey ? 0.5 : 0.1;
      const delta = e.key === "ArrowLeft" ? -step : step;
      const sel = new Set(selectedIds);
      let next = timelineState.items.map((it) => {
        if (!sel.has(it.id)) return it;
        const dur = it.end - it.start;
        let s = it.start + delta;
        let en = it.end + delta;
        if (s < 0) {
          en -= s;
          s = 0;
        }
        const r = (x: number) => Math.round(x * 1000) / 1000;
        return { ...it, start: r(s), end: r(en) };
      });
      /** 画面轨：←→ 平移后与其它画面段不得重叠（按开始时间顺序依次钳制） */
      const visualSelIds = next
        .filter((it) => sel.has(it.id) && it.kind === "visualSegment")
        .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
        .map((it) => it.id);
      const minDur = 0.1;
      for (const vid of visualSelIds) {
        const cur = next.find((i) => i.id === vid);
        if (!cur || cur.kind !== "visualSegment") continue;
        const c = clampVisualSegmentInterval(next, vid, cur.start, cur.end, minDur);
        next = next.map((it) => (it.id === vid ? { ...it, start: c.start, end: c.end } : it));
      }
      setProject(applyItemsToProject(timelineState.project, next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpMode, timelineState, selectedIds]);

  /** ↑ / ↓：按时间线排序在片段间切换单选（与轨道顺序一致） */
  useEffect(() => {
    if (helpMode || !timelineState) return;
    const order = sortedTimelineItemIds(timelineState.items, timelineState.trackOrder);
    if (order.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable))
        return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const cur = selectedIds.length >= 1 ? selectedIds[0] : null;
      const idx = cur ? order.indexOf(cur) : -1;
      if (e.key === "ArrowDown") {
        if (idx < 0) setSelectedIds([order[0]]);
        else if (idx < order.length - 1) setSelectedIds([order[idx + 1]]);
      } else {
        if (idx < 0) setSelectedIds([order[order.length - 1]]);
        else if (idx > 0) setSelectedIds([order[idx - 1]]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpMode, timelineState, selectedIds]);

  /**
   * Ctrl+A（Windows/Linux）/ Cmd+A（macOS）：仅当焦点在时间线根节点（`[data-timeline-focus-root]`）内时全选 clip；
   * 检查 `metaKey` 以支持 Mac Command 键。
   */
  useEffect(() => {
    if (helpMode || !timelineState || timelineState.items.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const root = document.querySelector("[data-timeline-focus-root]");
      const ae = document.activeElement;
      if (!root || !(ae instanceof HTMLElement) || !root.contains(ae)) return;
      if (ae.matches("input, textarea, select, [contenteditable='true']")) return;
      if (!(e.ctrlKey || e.metaKey) || (e.key !== "a" && e.key !== "A")) return;
      e.preventDefault();
      setSelectedIds(timelineState.items.map((i) => i.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpMode, timelineState]);

  /**
   * Delete / Backspace：单选一条时间线条目时从工程中删除（删间隙仍由 Timeline 在捕获阶段优先处理）。
   */
  useEffect(() => {
    if (helpMode || !timelineState || !project) return;
    const onKey = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable))
        return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedIds.length !== 1) return;
      const item = timelineState.items.find((x) => x.id === selectedIds[0]);
      if (!item) return;
      e.preventDefault();
      beginGesture();
      const next = deleteTimelineItemsFromProject(project, [item]);
      if (next) {
        setProject(next);
        setSelectedIds([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpMode, timelineState, project, selectedIds]);

  /**
   * 从 JSON 文本加载工程（文件 / 剪贴板 / 同源 ?importUrl= 共用）。
   * 支持 CLI 输出的 `{ stats, project, density }` 或仅含 `project` 的对象。
   */
  const loadProjectFromJsonText = useCallback((text: string) => {
    try {
      setImportError(null);
      const p = readProjectFromJsonText(text);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setProject(p);
      setSelectedIds([]);
      setPlayheadSec(0);
      setPlaying(false);
      setWorkInSec(null);
      setWorkOutSec(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      setProject(null);
      setSelectedIds([]);
    }
  }, []);

  const onImportJson = async (file: File) => {
    const text = await file.text();
    loadProjectFromJsonText(text);
  };

  /** Hermes / 用户：复制整段 JSON 后一键导入（需浏览器剪贴板权限） */
  const onImportFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setImportError(t("importClipboardEmpty"));
        return;
      }
      loadProjectFromJsonText(text);
    } catch {
      setImportError(t("importClipboardDenied"));
    }
  };

  /** 启动时同源 ?importUrl=/path/to.json（仅 fetch 本站路径，供 Hermes 部署侧写入文件后打开） */
  const importUrlFetchedRef = useRef(false);
  useEffect(() => {
    if (importUrlFetchedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("importUrl");
    if (!raw?.trim()) return;
    importUrlFetchedRef.current = true;
    let target: URL;
    try {
      target = new URL(raw.trim(), window.location.origin);
    } catch {
      setImportError(t("importUrlInvalid"));
      return;
    }
    if (target.origin !== window.location.origin) {
      setImportError(t("importUrlCrossOrigin"));
      return;
    }
    void (async () => {
      try {
        const res = await fetch(target.toString(), { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        loadProjectFromJsonText(text);
        const clean = new URL(window.location.href);
        clean.searchParams.delete("importUrl");
        window.history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadProjectFromJsonText, t]);

  const onExportJson = () => {
    if (!timelineState) return;
    const nextProject = applyItemsToProject(timelineState.project, timelineState.items);
    const content = JSON.stringify({ project: nextProject }, null, 2);
    downloadText(editedExportFilename(), content, "application/json");
  };

  const onReset = () => {
    setProject(null);
    setSelectedIds([]);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setPlayheadSec(0);
    setPlaying(false);
    /** 避免清空后仍显示上次导入错误、或沿用上一工程的轨显隐/高度/工作区 */
    setImportError(null);
    setTrackStates({});
    setTrackHeights({});
    setWorkInSec(null);
    setWorkOutSec(null);
    setNewClipMenuOpen(false);
    setNewVsModal(null);
  };

  /**
   * 新建空白工程：规范轨道与默认 cut，可直接在时间轴上添加片段；与「清空」不同，会进入可编辑空时间线。
   */
  const onNewBlankProject = () => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setProject(createBlankScriptCutProject());
    setSelectedIds([]);
    setPlayheadSec(0);
    setPlaying(false);
    setImportError(null);
    setTrackStates({});
    setTrackHeights({});
    setWorkInSec(null);
    setWorkOutSec(null);
    setNewClipMenuOpen(false);
    setNewVsModal(null);
  };

  const onChangeItems = (nextItems: Parameters<typeof applyItemsToProject>[1]) => {
    if (!timelineState) return;
    const nextProject = applyItemsToProject(timelineState.project, nextItems);
    setProject(nextProject);
  };

  const onFixOverspeedRipple = () => {
    if (!project || !selectedItem) return;
    if (selectedItem.kind !== "clip") return;
    beginGesture();
    const { next, applied } = extendClipToMinSpeechDurationWithRipple(project, selectedItem.clipId, DEFAULT_SPEECH_PARAMS);
    if (applied) setProject(next);
  };

  /** 只加长本条口播出点，不推移后续片段 / 画面轨 / cuts */
  const onFixOverspeedNoRipple = () => {
    if (!project || !selectedItem) return;
    if (selectedItem.kind !== "clip") return;
    beginGesture();
    const { next, applied } = extendClipToMinSpeechDurationNoRipple(project, selectedItem.clipId, DEFAULT_SPEECH_PARAMS);
    if (applied) setProject(next);
  };

  const onSplitSelected = (alignToCuts: boolean) => {
    if (!project || !selectedItem) return;
    if (selectedItem.kind !== "clip") return;
    beginGesture();
    const { next, applied } = splitClipByPunctuationIntoClips(project, selectedItem.clipId, {
      alignToCuts,
      cutSnapThresholdSec: snapThresholdSec,
      params: DEFAULT_SPEECH_PARAMS
    });
    if (applied) {
      setProject(next);
      setSelectedIds([]);
    }
  };

  const onSplitAtPlayhead = () => {
    if (!timelineState || !project || selectedIds.length === 0) return;
    const tCut = playheadSec;
    beginGesture();
    let nextP = project;
    let state = toTimelineState(nextP);
    for (const id of selectedIds) {
      const it = state.items.find((i) => i.id === id);
      if (!it) continue;
      const r = splitTimelineItemAtTime(nextP, it, tCut);
      if (!r) continue;
      nextP = r.next;
      state = toTimelineState(nextP);
    }
    setProject(nextP);
    setSelectedIds([]);
  };

  /**
   * 在播放头时刻对所有「内部穿过播放头」的片段各切一刀（无需事先选中）。
   * 顺序按时间线排序，避免同一刀多次作用在同一逻辑条目上。
   */
  const onSplitAllAtPlayhead = () => {
    if (!timelineState || !project) return;
    const tCut = playheadSec;
    const pad = TIMELINE_SPLIT_EDGE_PAD_SEC;
    const ids = sortedTimelineItemIds(timelineState.items, timelineState.trackOrder).filter((id) => {
      const it = timelineState.items.find((i) => i.id === id);
      return it != null && tCut > it.start + pad && tCut < it.end - pad;
    });
    if (ids.length === 0) return;
    beginGesture();
    let nextP = project;
    let state = toTimelineState(nextP);
    for (const id of ids) {
      const it = state.items.find((i) => i.id === id);
      if (!it) continue;
      const r = splitTimelineItemAtTime(nextP, it, tCut);
      if (!r) continue;
      nextP = r.next;
      state = toTimelineState(nextP);
    }
    setProject(nextP);
    setSelectedIds([]);
  };

  /** 播放头处可拆分的条目数（用于禁用「全部拆分」按钮） */
  const splittableCountAtPlayhead = useMemo(() => {
    if (!timelineState) return 0;
    const t = playheadSec;
    const pad = TIMELINE_SPLIT_EDGE_PAD_SEC;
    return timelineState.items.filter((it) => t > it.start + pad && t < it.end - pad).length;
  }, [timelineState, playheadSec]);

  /**
   * 在播放头处新建一条空 clip（默认约 2s），便于在检查器填写各轨文案。
   * 画面段落仍由 visualSegments / 切镜管理，不在此创建。
   */
  /**
   * 在播放头时间插入指定轨类型的空 clip（时长由 model 内默认，约 2s）。不含 `visual`（画面段用弹窗）。
   */
  const onNewClipAtPlayheadOfType = (trackType: TrackType) => {
    if (!project) return;
    if (trackType === "visual") return;
    beginGesture();
    const { project: next, newClipId } = addEmptyClipToProject(project, trackType, playheadSec);
    setProject(next);
    setSelectedIds([`item_clip_${newClipId}`]);
    setNewClipMenuOpen(false);
  };

  /** 工具栏「新建」菜单：按轨类型在播放头插入 clip，或打开画面段弹窗 */
  const onChooseNewAtPlayhead = (trackType: TrackType) => {
    if (!project) return;
    if (trackType === "visual") {
      setNewClipMenuOpen(false);
      setNewVsModal({ startSec: playheadSec });
      return;
    }
    onNewClipAtPlayheadOfType(trackType);
  };

  /** 弹窗确认：写入 visualSegments、重建 cuts、选中新建段 */
  const confirmNewVisualSegment = () => {
    if (!project || !newVsModal) return;
    const dur = Number(vsFormDuration);
    if (!Number.isFinite(dur) || dur < 0.1) return;
    beginGesture();
    const labelArg = vsFormLabel.trim() === "" ? undefined : vsFormLabel.trim();
    const { project: next, newSegmentId } = addVisualSegmentToProject(
      project,
      newVsModal.startSec,
      dur,
      labelArg
    );
    setProject(next);
    setSelectedIds([`item_vs_${newSegmentId}`]);
    setNewVsModal(null);
  };

  const onAutoCuts = () => {
    if (!project) return;
    beginGesture();
    const next = autoGenerateCutsAndRebuildVisualSegments(project, {
      params: DEFAULT_SPEECH_PARAMS,
      minSegSec: autoMinSegSec,
      maxSegSec: autoMaxSegSec,
      keepExistingCuts: autoKeepExistingCuts
    });
    setProject(next);
    setSelectedIds([]);
  };

  const onResolveSpeechOverlaps = () => {
    if (!project) return;
    beginGesture();
    const { next, shiftedCount } = resolveSpeechOverlapsWithGlobalRipple(project, {
      trackTypes: ["dialogue", "narration"],
      gapSec: 0.05,
      quantizeMs: 10,
      rippleVisualSegments: true
    });
    if (shiftedCount > 0) {
      setProject(next);
      /** 仅在实际改动工程时清空多选，避免「无重叠可排」仍丢掉当前选中 */
      setSelectedIds([]);
    }
  };

  const onToggleTrackFlag = (type: TrackType, flag: "locked" | "solo" | "hidden") => {
    setTrackStates((prev) => {
      const cur = prev[type] ?? {};
      return {
        ...prev,
        [type]: { ...cur, [flag]: !cur[flag] }
      };
    });
  };

  useEffect(() => {
    document.title = t("pageTitle");
  }, [locale, t]);

  /** 打开新建画面段弹窗时重置表单默认值 */
  useEffect(() => {
    if (!newVsModal || !project) return;
    const n = project.visualSegments.length;
    setVsFormLabel(`Shot ${String(n + 1).padStart(2, "0")}`);
    setVsFormDuration("2.5");
  }, [newVsModal, project]);

  /** 弹窗 Esc 关闭 */
  useEffect(() => {
    if (!newVsModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewVsModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newVsModal]);

  /** 新建 clip 菜单：点击外部或 Esc 关闭 */
  useEffect(() => {
    if (!newClipMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = newClipMenuRef.current;
      if (el && !el.contains(e.target as Node)) setNewClipMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewClipMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [newClipMenuOpen]);

  return (
    <>
    <div className="container">
      <div className="appShell">
        <div
          className="workArea"
          style={{
            gridTemplateColumns: `${layoutWidths.left}px 6px minmax(0, 1fr) 6px ${layoutWidths.right}px`
          }}
        >
          <div className="leftBar">
            <div className="leftBarInner">
              <div className="card">
                <div className="title appTitleBar" style={{ marginBottom: 6 }}>
                  <div className="appBrand">
                    {/**
                     * 品牌图标：`public/scriptcut-logo.png`，与 index.html favicon 同源，构建后由站点根路径提供
                     */}
                    <img className="appLogo" src="/scriptcut-logo.png" alt="" width={44} height={44} decoding="async" />
                    <div className="appBrandText">
                      <h1 style={{ fontSize: 16 }}>{t("appTitle")}</h1>
                      <div className="hint">{t("appTagline")}</div>
                    </div>
                  </div>
                </div>
                <div className="langRow">
                  <label>{t("languageLabel")}</label>
                  <button
                    type="button"
                    className={`langBtn${locale === "zh" ? " langBtnActive" : ""}`}
                    onClick={() => setLocale("zh")}
                  >
                    {t("langZh")}
                  </button>
                  <button
                    type="button"
                    className={`langBtn${locale === "en" ? " langBtnActive" : ""}`}
                    onClick={() => setLocale("en")}
                  >
                    {t("langEn")}
                  </button>
                </div>
                <div className="helpToggleRow">
                  <label className="helpToggleLabel">
                    <input type="checkbox" checked={helpMode} onChange={(e) => setHelpMode(e.target.checked)} />
                    <span>
                      <span className="helpToggleStrong">{t("helpModeToggle")}</span>
                      <div className="workflowMuted" style={{ marginTop: 4 }}>
                        {t("helpModeToggleHint")}
                      </div>
                    </span>
                  </label>
                </div>
                <FeatureHelp show={helpMode} text={t("helpHintSettings")} />
              </div>

              <SidebarSection sectionKey="import" defaultOpen title={t("stepImportExport")}>
                <div className="row">
                  <label className="btn btnPrimary">
                    {t("importJson")}
                    <input
                      style={{ display: "none" }}
                      type="file"
                      accept="application/json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onImportJson(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button className="btn" onClick={onExportJson} disabled={!project}>
                    {t("exportJson")}
                  </button>
                  <button className="btn" type="button" onClick={onNewBlankProject} title={t("newBlankProjectHint")}>
                    {t("newBlankProject")}
                  </button>
                  <button className="btn btnDanger" onClick={onReset}>
                    {t("clearProject")}
                  </button>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn" type="button" onClick={() => void onImportFromClipboard()} title={t("importClipboardHint")}>
                    {t("importFromClipboard")}
                  </button>
                </div>
                <FeatureHelp show={helpMode} text={t("helpHintImportExport")} />
              </SidebarSection>

              {importError ? (
                <div className="card" style={{ borderColor: "rgba(255,77,77,0.45)" }}>
                  <div className="cardTitle">{t("importFailed")}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,180,180,0.95)", wordBreak: "break-word" }}>{importError}</div>
                  <FeatureHelp show={helpMode} text={t("helpHintImportError")} />
                </div>
              ) : null}

              <SidebarSection sectionKey="view" defaultOpen title={t("stepViewSnap")}>
                <div className="row">
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{t("scale")}</span>
                  <input
                    className="input mono"
                    type="number"
                    min={ZOOM_PX_MIN}
                    max={ZOOM_PX_MAX}
                    step={10}
                    value={pxPerSec}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setPxPerSec(Math.max(ZOOM_PX_MIN, Math.min(ZOOM_PX_MAX, Math.round(n))));
                    }}
                    title={t("pxPerSecTitle")}
                    style={{ width: 110 }}
                  />
                </div>
                <div className="row">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.75)"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={zoomKeepPlayheadVisible}
                      onChange={(e) => setZoomKeepPlayheadVisible(e.target.checked)}
                    />
                    {t("zoomKeepPlayheadVisible")}
                  </label>
                </div>
                <div className="row">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.75)"
                    }}
                  >
                    <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
                    {t("snapCut")}
                  </label>
                </div>
                <div className="row">
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{t("thresholdSec")}</span>
                  <input
                    className="input mono"
                    type="number"
                    min={0.0}
                    max={0.5}
                    step={0.01}
                    value={snapThresholdSec}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setSnapThresholdSec(n);
                    }}
                    style={{ width: 110 }}
                  />
                </div>
                <div className="row">
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{t("cpsThreshold")}</span>
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={cpsThreshold}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setCpsThreshold(n);
                    }}
                    style={{ width: 110 }}
                    title={t("cpsTooltip")}
                  />
                </div>
                <FeatureHelp show={helpMode} text={t("helpHintViewSnap")} />
              </SidebarSection>

              <SidebarSection sectionKey="tracks" defaultOpen title={t("stepTrackVisibility")}>
                {!timelineState ? (
                  <div className="workflowMuted">{t("tidyNeedsProject")}</div>
                ) : (
                  <>
                    <div className="workflowMuted" style={{ marginBottom: 10 }}>
                      {t("trackVisibilityHint")}
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{ marginBottom: 10 }}
                      onClick={() => {
                        setTrackStates((prev) => {
                          const next = { ...prev };
                          for (const tt of timelineState!.trackOrder) {
                            const cur = next[tt] ?? {};
                            next[tt] = { ...cur, hidden: false };
                          }
                          return next;
                        });
                      }}
                    >
                      {t("showAllTracks")}
                    </button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {timelineState.trackOrder.map((tt) => (
                        <label
                          key={tt}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                            color: "rgba(255,255,255,0.8)"
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!trackStates[tt]?.hidden}
                            onChange={(e) => {
                              const show = e.target.checked;
                              setTrackStates((prev) => ({
                                ...prev,
                                [tt]: { ...prev[tt], hidden: !show }
                              }));
                            }}
                          />
                          {trackTypeLabel(tt, t)}
                        </label>
                      ))}
                    </div>
                    <FeatureHelp show={helpMode} text={t("helpHintTrackVisibility")} />
                  </>
                )}
              </SidebarSection>

              <SidebarSection sectionKey="tidy" defaultOpen={false} title={t("stepTidyTimeline")}>
                {!timelineState ? (
                  <>
                    <div className="workflowMuted">{t("tidyNeedsProject")}</div>
                    <FeatureHelp show={helpMode} text={t("helpHintTidyLocked")} />
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 14 }}>
                      <div className="cardTitle" style={{ marginBottom: 8 }}>
                        {t("resolveSpeechTitle")}
                      </div>
                      <button className="btn btnPrimary" onClick={onResolveSpeechOverlaps}>
                        {t("resolveSpeechBtn")}
                      </button>
                      <div className="workflowMuted" style={{ marginTop: 8 }}>
                        {t("resolveSpeechHint")}
                      </div>
                      <FeatureHelp show={helpMode} text={t("helpHintTidySpeech")} />
                    </div>
                    <div>
                      <div className="cardTitle" style={{ marginBottom: 8 }}>
                        {t("autoCutsTitle")}
                      </div>
                      <div className="row" style={{ marginBottom: 8 }}>
                        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{t("rangeSec")}</span>
                        <input
                          className="input mono"
                          type="number"
                          min={0.2}
                          step={0.1}
                          value={autoMinSegSec}
                          onChange={(e) => setAutoMinSegSec(Number(e.target.value))}
                          style={{ width: 90 }}
                          title={t("minSegLenTitle")}
                        />
                        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{t("rangeTilde")}</span>
                        <input
                          className="input mono"
                          type="number"
                          min={0.2}
                          step={0.1}
                          value={autoMaxSegSec}
                          onChange={(e) => setAutoMaxSegSec(Number(e.target.value))}
                          style={{ width: 90 }}
                          title={t("maxSegLenTitle")}
                        />
                      </div>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.75)",
                          marginBottom: 8
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={autoKeepExistingCuts}
                          onChange={(e) => setAutoKeepExistingCuts(e.target.checked)}
                        />
                        {t("keepExistingCuts")}
                      </label>
                      <button className="btn btnPrimary" onClick={onAutoCuts}>
                        {t("autoCutsBtn")}
                      </button>
                      <FeatureHelp show={helpMode} text={t("helpHintTidyCuts")} />
                    </div>
                  </>
                )}
              </SidebarSection>

              <SidebarSection sectionKey="shortcuts" defaultOpen={false} title={t("stepShortcuts")}>
                <div className="workflowMuted">{t("shortcutsHint")}</div>
                <FeatureHelp show={helpMode} text={t("helpHintShortcuts")} />
              </SidebarSection>
            </div>
          </div>

          <div
            className="layoutGutter layoutGutterLeft"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("layoutResizeLeft")}
            onPointerDown={onResizeLeftGutter}
          />

          <div className="timelineWrap" tabIndex={-1}>
            {timelineState && <FeatureHelp show={helpMode} text={t("helpHintTimeline")} />}
            {!timelineState ? (
              <div className="panel">
                <div className="content" style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 8 }}>{t("emptyIntro")}</div>
                  <div style={{ marginBottom: 8 }}>
                    {t("emptyHowTo")}：
                    <ul style={{ margin: "6px 0 0 18px" }}>
                      <li>{t("emptyDragMove")}</li>
                      <li>{t("emptyDragResize")}</li>
                      <li>{t("emptySnap")}</li>
                      <li>{t("emptyKeys")}</li>
                      <li>{t("emptyRipple")}</li>
                      <li>{t("emptyGapDelete")}</li>
                    </ul>
                  </div>
                  <div>{t("emptyVisualHint")}</div>
                  <FeatureHelp show={helpMode} text={t("helpHintEmptyCenter")} />
                </div>
              </div>
            ) : (
              <>
                <div className="timelineToolbar">
                  <span className="mono" style={{ color: "var(--accent)" }}>
                    {fmtTime(playheadSec)}
                  </span>
                  <div className="toolbarZoomCluster" role="group" aria-label={t("toolbarZoomGroupAria")}>
                    <button
                      type="button"
                      className="toolbarBtn"
                      onClick={() => onToolbarZoomStep(-1)}
                      title={t("toolbarZoomOutHint")}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="toolbarBtn mono"
                      onClick={onToolbarZoomReset}
                      title={t("toolbarZoomResetHint")}
                      style={{ minWidth: 52 }}
                    >
                      {Math.max(1, Math.round((pxPerSec / ZOOM_PX_DEFAULT) * 100))}%
                    </button>
                    <button
                      type="button"
                      className="toolbarBtn"
                      onClick={() => onToolbarZoomStep(1)}
                      title={t("toolbarZoomInHint")}
                    >
                      +
                    </button>
                    <button type="button" className="toolbarBtn" onClick={onFitTimelineAll} title={t("toolbarFitAllHint")}>
                      {t("toolbarFitAll")}
                    </button>
                    <button
                      type="button"
                      className="toolbarBtn"
                      onClick={onFitTimelineSelection}
                      disabled={selectedIds.length === 0}
                      title={t("toolbarFitSelectionHint")}
                    >
                      {t("toolbarFitSelection")}
                    </button>
                    <input
                      type="range"
                      className="toolbarZoomSlider"
                      min={ZOOM_PX_MIN}
                      max={ZOOM_PX_MAX}
                      step={1}
                      value={pxPerSec}
                      aria-label={t("toolbarZoomSliderAria")}
                      title={t("toolbarZoomSliderHint")}
                      onPointerDown={() => timelineHandleRef.current?.anchorZoomAtTimeSec(playheadSecRef.current)}
                      onChange={(e) => setPxPerSecClamped(Number(e.target.value))}
                    />
                  </div>
                  <span className="toolbarSep" aria-hidden />
                  <button
                    type="button"
                    className={`toolbarBtn${playing ? " toolbarBtnPrimary" : ""}`}
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? t("toolbarPause") : t("toolbarPlay")}
                  </button>
                  <button
                    type="button"
                    className="toolbarBtn"
                    onClick={() => setWorkInSec(playheadSec)}
                    title={t("toolbarWorkIn")}
                  >
                    I
                  </button>
                  <button
                    type="button"
                    className="toolbarBtn"
                    onClick={() => setWorkOutSec(playheadSec)}
                    title={t("toolbarWorkOut")}
                  >
                    O
                  </button>
                  <button
                    type="button"
                    className="toolbarBtn"
                    onClick={() => {
                      setWorkInSec(null);
                      setWorkOutSec(null);
                    }}
                    title={t("toolbarWorkClear")}
                  >
                    {t("toolbarWorkClear")}
                  </button>
                  <button
                    type="button"
                    className="toolbarBtn"
                    onClick={onSplitAtPlayhead}
                    disabled={selectedIds.length === 0}
                    title={t("toolbarSplit")}
                  >
                    {t("toolbarSplit")}
                  </button>
                  <button
                    type="button"
                    className="toolbarBtn"
                    onClick={onSplitAllAtPlayhead}
                    disabled={splittableCountAtPlayhead === 0}
                    title={t("toolbarSplitAllAtPlayhead")}
                  >
                    {t("toolbarSplitAllAtPlayhead")}
                  </button>
                  <span className="toolbarSep" aria-hidden />
                  <div className="toolbarDropdownWrap" ref={newClipMenuRef}>
                    <button
                      type="button"
                      className="toolbarBtn"
                      onClick={() => setNewClipMenuOpen((o) => !o)}
                      title={t("toolbarNewMenuHint")}
                      aria-expanded={newClipMenuOpen}
                      aria-haspopup="menu"
                      aria-controls="toolbar-new-clip-menu"
                    >
                      {t("toolbarNewMenu")} <span aria-hidden>▾</span>
                    </button>
                    {newClipMenuOpen ? (
                      <div
                        id="toolbar-new-clip-menu"
                        className="toolbarDropdownPanel"
                        role="menu"
                        aria-label={t("newClipTrackLabel")}
                      >
                        {TIMELINE_TRACK_ORDER.map((tt) => (
                          <button
                            key={tt}
                            type="button"
                            className="toolbarDropdownItem"
                            role="menuitem"
                            onClick={() => onChooseNewAtPlayhead(tt)}
                          >
                            {trackTypeLabel(tt, t)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="toolbarSep" aria-hidden />
                  <button type="button" className="toolbarBtn" onClick={undo} title={t("toolbarUndo")}>
                    {t("toolbarUndo")}
                  </button>
                  <button type="button" className="toolbarBtn" onClick={redo} title={t("toolbarRedo")}>
                    {t("toolbarRedo")}
                  </button>
                </div>
                <Timeline
                  ref={timelineHandleRef}
                  items={timelineState.items}
                  trackOrder={timelineState.trackOrder}
                  cuts={cuts}
                  pxPerSec={pxPerSec}
                  onPxPerSecChange={setPxPerSecClamped}
                  zoomKeepPlayheadVisible={zoomKeepPlayheadVisible}
                  snapEnabled={snapEnabled}
                  snapThresholdSec={snapThresholdSec}
                  cpsThreshold={cpsThreshold}
                  onChangeItems={onChangeItems}
                  selectedIds={selectedIds}
                  onSelectIds={setSelectedIds}
                  playheadSec={playheadSec}
                  onPlayheadChange={setPlayheadSec}
                  playing={playing}
                  workInSec={workInSec}
                  workOutSec={workOutSec}
                  trackStates={trackStates}
                  trackHeights={trackHeights}
                  onTrackHeightChange={(type, h) => setTrackHeights((prev) => ({ ...prev, [type]: h }))}
                  onToggleTrackFlag={onToggleTrackFlag}
                  onGestureStart={beginGesture}
                  onGestureEnd={() => {}}
                  onBeforeGapClose={beginGesture}
                />
              </>
            )}
          </div>

          <div
            className="layoutGutter layoutGutterRight"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("layoutResizeRight")}
            onPointerDown={onResizeRightGutter}
          />

          <div className="rightBar">
            <div className="rightBarInner">
              {!timelineState ? null : (
                <>
                  <div className="card workflowMuted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {t("rightBarWelcome")}
                  </div>
                  <div className="card">
                    <div className="cardTitle">{t("inspectorProject")}</div>
                    <div className="kv">
                      <div className="k">{t("countVisualSegments")}</div>
                      <div className="v">{timelineState.project.visualSegments.length}</div>
                      <div className="k">{t("countClips")}</div>
                      <div className="v">{timelineState.project.clips.length}</div>
                      <div className="k">{t("countCuts")}</div>
                      <div className="v">{timelineState.project.cuts.length}</div>
                      <div className="k">{t("fieldTimelineEnd")}</div>
                      <div className="v">{timelineMaxT.toFixed(3)}</div>
                      <div className="k">{t("fieldTargetDurationMeta")}</div>
                      <div className="v">{timelineState.project.meta?.targetDurationSec ?? t("none")}</div>
                      <div className="k">{t("inputPath")}</div>
                      <div className="v">{timelineState.project.inputPath}</div>
                    </div>
                    <FeatureHelp show={helpMode} text={t("helpHintInspectorProject")} />
                  </div>

                  <div className="card">
                    <div className="cardTitle">{t("inspectorSelected")}</div>
                    {selectedIds.length === 0 ? (
                      <>
                        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>{t("clickClipDetail")}</div>
                        <FeatureHelp show={helpMode} text={t("helpHintInspectorSelect")} />
                      </>
                    ) : selectedIds.length > 1 ? (
                      <div style={{ fontSize: 13 }}>{t("multiSelectCount", { n: String(selectedIds.length) })}</div>
                    ) : selectedItem ? (
                      <>
                        <FeatureHelp show={helpMode} text={t("helpHintInspectorClip")} />
                        <div className="kv" style={{ marginBottom: 10 }}>
                          <div className="k">{t("fieldId")}</div>
                          <div className="v">{selectedItem.id}</div>
                          <div className="k">{t("fieldKind")}</div>
                          <div className="v">{kindLabel(selectedItem.kind, t)}</div>
                          <div className="k">{t("fieldTrack")}</div>
                          <div className="v">{trackTypeLabel(selectedItem.trackType, t)}</div>
                          <div className="k">{t("fieldTime")}</div>
                          <div className="v">
                            {fmtTime(selectedItem.start)} - {fmtTime(selectedItem.end)}
                          </div>
                          <div className="k">{t("fieldTitle")}</div>
                          <div className="v">{selectedItem.title}</div>
                          <div className="k">{t("fieldSummary")}</div>
                          <div className="v">{selectedItem.subtitle ?? t("none")}</div>
                          {selectedItem.kind !== "clip" ? (
                            <>
                              <div className="k">{t("fieldText")}</div>
                              <div className="v">{selectedItem.rawText?.slice(0, 260) ?? t("none")}</div>
                            </>
                          ) : null}
                        </div>

                        {/** 各类 clip：直接回写 JSON clips[]（含动作/音效/字幕等非口播轨） */}
                        {selectedItem.kind === "clip" && selectedClip && project ? (
                          <div className="kv" style={{ marginBottom: 10 }}>
                            <div
                              className="k"
                              style={{ gridColumn: "1 / -1", color: "var(--muted)", marginBottom: 4 }}
                            >
                              {t("clipEditBlockTitle")}
                            </div>
                            <div className="k">{t("fieldSpeaker")}</div>
                            <div className="v" style={{ gridColumn: "2 / -1" }}>
                              <input
                                key={`spk-${selectedClip.id}`}
                                className="inspectorSelect"
                                defaultValue={selectedClip.speaker ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  const cid = selectedClip.id;
                                  const next = v === "" ? undefined : v;
                                  if (next === (selectedClip.speaker ?? undefined)) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateClipFields(p, cid, { speaker: next }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldText")}</div>
                            <div className="v" style={{ gridColumn: "2 / -1" }}>
                              <textarea
                                key={`txt-${selectedClip.id}`}
                                className="inspectorTextarea"
                                defaultValue={selectedClip.text ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value;
                                  const cid = selectedClip.id;
                                  if (v === (selectedClip.text ?? "")) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateClipFields(p, cid, { text: v }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldClipMeta")}</div>
                            <div className="v" style={{ gridColumn: "2 / -1" }}>
                              <input
                                key={`meta-${selectedClip.id}`}
                                className="inspectorSelect"
                                defaultValue={selectedClip.meta ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  const cid = selectedClip.id;
                                  const next = v === "" ? undefined : v;
                                  if (next === (selectedClip.meta ?? undefined)) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateClipFields(p, cid, { meta: next }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldSource")}</div>
                            <div className="v" style={{ gridColumn: "2 / -1" }}>
                              <input
                                key={`src-${selectedClip.id}`}
                                className="inspectorSelect"
                                defaultValue={selectedClip.source ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  const cid = selectedClip.id;
                                  const next = v === "" ? undefined : v;
                                  if (next === (selectedClip.source ?? undefined)) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateClipFields(p, cid, { source: next }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldStart")}</div>
                            <div className="v">
                              <input
                                key={`in-${selectedClip.id}`}
                                className="inspectorSelect"
                                type="number"
                                step={0.01}
                                defaultValue={selectedClip.start}
                                onBlur={(e) => {
                                  const num = Number(e.target.value);
                                  const cid = selectedClip.id;
                                  if (!Number.isFinite(num)) return;
                                  if (Math.abs(num - selectedClip.start) < 1e-6) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateClipFields(p, cid, { start: num }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldEnd")}</div>
                            <div className="v">
                              <input
                                key={`out-${selectedClip.id}`}
                                className="inspectorSelect"
                                type="number"
                                step={0.01}
                                defaultValue={selectedClip.end}
                                onBlur={(e) => {
                                  const num = Number(e.target.value);
                                  const cid = selectedClip.id;
                                  if (!Number.isFinite(num)) return;
                                  if (Math.abs(num - selectedClip.end) < 1e-6) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateClipFields(p, cid, { end: num }) : null));
                                }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {selectedSegment && project && (
                          <div className="kv" style={{ marginBottom: 10 }}>
                            <div className="k" style={{ gridColumn: "1 / -1", color: "var(--muted)", marginBottom: 4 }}>
                              {t("segmentBlockTitle")}
                            </div>
                            <div className="k">{t("fieldSegmentLabel")}</div>
                            <div className="v" style={{ gridColumn: "2 / -1" }}>
                              <input
                                key={`seg-label-${selectedSegment.id}`}
                                className="inspectorSelect"
                                defaultValue={selectedSegment.label}
                                onBlur={(e) => {
                                  const sid = selectedSegment.id;
                                  const v = e.target.value;
                                  if (v === selectedSegment.label) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateVisualSegmentFields(p, sid, { label: v }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldFramingStart")}</div>
                            <div className="v">
                              <select
                                className="inspectorSelect"
                                value={selectedSegment.framingStart ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const sid = selectedSegment.id;
                                  beginGesture();
                                  /** 函数式更新，避免闭包里的 project 滞后导致时间轴不重算 */
                                  setProject((p) =>
                                    p ? updateVisualSegmentFields(p, sid, { framingStart: v ? (v as FramingCode) : undefined }) : null
                                  );
                                }}
                              >
                                <option value="">{t("selectNone")}</option>
                                {FRAMING_CODES.map((c) => (
                                  <option key={c} value={c}>
                                    {locale === "zh" ? `${FRAMING_LABELS_ZH[c]}（${c}）` : c}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="k">{t("fieldFramingEnd")}</div>
                            <div className="v">
                              <select
                                className="inspectorSelect"
                                value={selectedSegment.framingEnd ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const sid = selectedSegment.id;
                                  beginGesture();
                                  setProject((p) =>
                                    p ? updateVisualSegmentFields(p, sid, { framingEnd: v ? (v as FramingCode) : undefined }) : null
                                  );
                                }}
                              >
                                <option value="">{t("selectNone")}</option>
                                {FRAMING_CODES.map((c) => (
                                  <option key={c} value={c}>
                                    {locale === "zh" ? `${FRAMING_LABELS_ZH[c]}（${c}）` : c}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="k">{t("fieldCameraMove")}</div>
                            <div className="v">
                              <select
                                className="inspectorSelect"
                                value={selectedSegment.cameraMove ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const sid = selectedSegment.id;
                                  beginGesture();
                                  setProject((p) =>
                                    p ? updateVisualSegmentFields(p, sid, { cameraMove: v ? (v as CameraMoveCode) : undefined }) : null
                                  );
                                }}
                              >
                                <option value="">{t("selectNone")}</option>
                                {CAMERA_MOVE_CODES.map((c) => (
                                  <option key={c} value={c}>
                                    {locale === "zh" ? `${CAMERA_MOVE_LABELS_ZH[c]}（${c}）` : c}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="k">{t("fieldMoveAmplitude")}</div>
                            <div className="v">
                              <select
                                className="inspectorSelect"
                                value={selectedSegment.moveAmplitude ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const sid = selectedSegment.id;
                                  beginGesture();
                                  setProject((p) =>
                                    p ? updateVisualSegmentFields(p, sid, { moveAmplitude: v ? (v as MoveAmplitude) : undefined }) : null
                                  );
                                }}
                              >
                                <option value="">{t("selectNone")}</option>
                                {MOVE_AMPLITUDES.map((c) => (
                                  <option key={c} value={c}>
                                    {locale === "zh" ? `${MOVE_AMPLITUDE_LABELS_ZH[c]}（${c}）` : c}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="k">{t("fieldMoveDurationHint")}</div>
                            <div className="v">
                              <input
                                className="inspectorSelect"
                                type="number"
                                min={0}
                                step={0.1}
                                placeholder={t("selectNone")}
                                value={selectedSegment.moveDurationHint ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const sid = selectedSegment.id;
                                  beginGesture();
                                  setProject((p) =>
                                    p
                                      ? updateVisualSegmentFields(p, sid, {
                                          moveDurationHint: raw === "" ? undefined : Number(raw)
                                        })
                                      : null
                                  );
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldDescription")}</div>
                            <div className="v" style={{ gridColumn: "2 / -1" }}>
                              <textarea
                                key={selectedSegment.id}
                                className="inspectorTextarea"
                                defaultValue={selectedSegment.description ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value;
                                  const next = v.trim() === "" ? undefined : v;
                                  const sid = selectedSegment.id;
                                  if (next === (selectedSegment.description ?? undefined)) return;
                                  beginGesture();
                                  setProject((p) => (p ? updateVisualSegmentFields(p, sid, { description: next }) : null));
                                }}
                              />
                            </div>
                            <div className="k">{t("fieldFramingLegacy")}</div>
                            <div className="v">{selectedSegment.framing ?? t("none")}</div>
                            <div className="k">{t("fieldCameraLegacy")}</div>
                            <div className="v">{selectedSegment.camera ?? t("none")}</div>
                          </div>
                        )}
                        {selectedSegment ? (
                          <>
                            <FeatureHelp show={helpMode} text={t("helpHintInspectorSegment")} />
                            <FeatureHelp show={helpMode} text={t("helpHintInspectorSegmentEdit")} />
                          </>
                        ) : null}

                        {(selectedItem.trackType === "dialogue" || selectedItem.trackType === "narration") &&
                          selectedItem.kind === "clip" && (
                            <>
                              {(() => {
                                const text = selectedItem.rawText ?? "";
                                const est = estimateSpeech(text, DEFAULT_SPEECH_PARAMS);
                                const curDur = selectedItem.end - selectedItem.start;
                                const need = est.minDuration;
                                const overspeed = curDur < need;
                                return (
                                  <>
                                    <div className="kv" style={{ marginBottom: 10 }}>
                                      <div className="k">{t("speechSuggestMin")}</div>
                                      <div className="v">{need.toFixed(2)}</div>
                                      <div className="k">{t("speechCurrentDur")}</div>
                                      <div className="v">{curDur.toFixed(2)}</div>
                                      <div className="k">{t("speechConclusion")}</div>
                                      <div className="v">
                                        {overspeed ? `⚠ ${t("speechOverspeed")}` : t("speechOk")}
                                      </div>
                                    </div>
                                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                      <button
                                        className="btn btnPrimary"
                                        onClick={onFixOverspeedRipple}
                                        disabled={!overspeed}
                                      >
                                        {t("extendRipple")}
                                      </button>
                                      <button className="btn" onClick={onFixOverspeedNoRipple} disabled={!overspeed}>
                                        {t("extendNoRipple")}
                                      </button>
                                      <button className="btn" onClick={() => onSplitSelected(false)}>
                                        {t("splitByPunc")}
                                      </button>
                                      <button className="btn" onClick={() => onSplitSelected(true)}>
                                        {t("splitAlignCuts")}
                                      </button>
                                    </div>
                                    <FeatureHelp show={helpMode} text={t("helpHintInspectorSpeech")} />
                                  </>
                                );
                              })()}
                            </>
                          )}
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

    {newVsModal && project ? (
      <div
        className="modalBackdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-vs-modal-title"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setNewVsModal(null);
        }}
      >
        <div className="modalPanel" onMouseDown={(e) => e.stopPropagation()}>
          <h2 id="new-vs-modal-title" className="modalTitle">
            {t("modalNewVisualTitle")}
          </h2>
          <div className="modalField">
            <label htmlFor="vs-start">{t("modalNewVisualStart")}</label>
            <input id="vs-start" readOnly value={String(newVsModal.startSec)} className="inspectorSelect" />
            <div className="workflowMuted" style={{ marginTop: 4, fontSize: 11 }}>
              ≈ {fmtTime(newVsModal.startSec)}
            </div>
          </div>
          <div className="modalField">
            <label htmlFor="vs-label">{t("modalNewVisualLabel")}</label>
            <input
              id="vs-label"
              value={vsFormLabel}
              onChange={(e) => setVsFormLabel(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="modalField">
            <label htmlFor="vs-dur">{t("modalNewVisualDuration")}</label>
            <input
              id="vs-dur"
              type="number"
              min={0.1}
              step={0.1}
              value={vsFormDuration}
              onChange={(e) => setVsFormDuration(e.target.value)}
            />
          </div>
          <div className="modalActions">
            <button type="button" className="btn" onClick={() => setNewVsModal(null)}>
              {t("modalCancel")}
            </button>
            <button type="button" className="btn btnPrimary" onClick={confirmNewVisualSegment}>
              {t("modalConfirm")}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
