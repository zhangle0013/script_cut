import React, { startTransition, useEffect, useMemo, useRef, useState } from "react";
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
import type { TimelineHandle, TrackUiState } from "./Timeline.js";
import { Timeline } from "./Timeline.js";
import {
  buildClipboardPayload,
  cloneProject,
  duplicateTimelineItems,
  pasteClipboardAtTime,
  splitTimelineItemAtTime,
  TIMELINE_SPLIT_EDGE_PAD_SEC
} from "./editOps.js";
import {
  applyItemsToProject,
  autoGenerateCutsAndRebuildVisualSegments,
  deleteTimelineItemsFromProject,
  extendClipToMinSpeechDurationNoRipple,
  extendClipToMinSpeechDurationWithRipple,
  resolveSpeechOverlapsWithGlobalRipple,
  readProjectFromJsonText,
  sortedTimelineItemIds,
  splitClipByPunctuationIntoClips,
  toTimelineState,
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

export function App() {
  const { t, locale, setLocale } = useI18n();

  const [project, setProject] = useState<ScriptCutProject | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const [pxPerSec, setPxPerSec] = useState(140);
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

  const onImportJson = async (file: File) => {
    try {
      setImportError(null);
      const text = await file.text();
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
  };

  const onExportJson = () => {
    if (!timelineState) return;
    const nextProject = applyItemsToProject(timelineState.project, timelineState.items);
    const content = JSON.stringify({ project: nextProject }, null, 2);
    downloadText(editedExportFilename(nextProject.inputPath), content, "application/json");
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

  return (
    <div className="container">
      <div className="appShell">
        <div className="workArea">
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

              <div className="card">
                <div className="workflowStepTitle">{t("stepImportExport")}</div>
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
                  <button className="btn btnDanger" onClick={onReset}>
                    {t("clearProject")}
                  </button>
                </div>
                <FeatureHelp show={helpMode} text={t("helpHintImportExport")} />
              </div>

              {importError ? (
                <div className="card" style={{ borderColor: "rgba(255,77,77,0.45)" }}>
                  <div className="cardTitle">{t("importFailed")}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,180,180,0.95)", wordBreak: "break-word" }}>{importError}</div>
                  <FeatureHelp show={helpMode} text={t("helpHintImportError")} />
                </div>
              ) : null}

              <div className="card">
                <div className="workflowStepTitle">{t("stepViewSnap")}</div>
                <div className="row">
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{t("scale")}</span>
                  <input
                    className="input mono"
                    type="number"
                    min={40}
                    max={420}
                    step={10}
                    value={pxPerSec}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setPxPerSec(Number.isFinite(n) ? n : pxPerSec);
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
              </div>

              <div className="card">
                <div className="workflowStepTitle">{t("stepTrackVisibility")}</div>
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
              </div>

              <div className="card">
                <div className="workflowStepTitle">{t("stepTidyTimeline")}</div>
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
              </div>

              <div className="card">
                <div className="workflowStepTitle">{t("stepShortcuts")}</div>
                <div className="workflowMuted">{t("shortcutsHint")}</div>
                <FeatureHelp show={helpMode} text={t("helpHintShortcuts")} />
              </div>
            </div>
          </div>

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
                  snapEnabled={snapEnabled}
                  snapThresholdSec={snapThresholdSec}
                  cpsThreshold={cpsThreshold}
                  onChangeItems={onChangeItems}
                  selectedIds={selectedIds}
                  onSelectIds={setSelectedIds}
                  onSelectItem={(id) => {
                    if (id) setSelectedIds([id]);
                    else setSelectedIds([]);
                  }}
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

          <div className="rightBar">
            <div className="rightBarInner">
              {!timelineState ? null : (
                <>
                  <div className="card">
                    <div className="cardTitle">{t("inspectorProject")}</div>
                    <div className="kv">
                      <div className="k">{t("countVisualSegments")}</div>
                      <div className="v">{timelineState.project.visualSegments.length}</div>
                      <div className="k">{t("countClips")}</div>
                      <div className="v">{timelineState.project.clips.length}</div>
                      <div className="k">{t("countCuts")}</div>
                      <div className="v">{timelineState.project.cuts.length}</div>
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
                          <div className="k">{t("fieldText")}</div>
                          <div className="v">{selectedItem.rawText?.slice(0, 260) ?? t("none")}</div>
                        </div>

                        {selectedSegment && project && (
                          <div className="kv" style={{ marginBottom: 10 }}>
                            <div className="k" style={{ gridColumn: "1 / -1", color: "var(--muted)", marginBottom: 4 }}>
                              {t("segmentBlockTitle")}
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
  );
}
