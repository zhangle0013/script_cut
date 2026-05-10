/**
 * 界面文案与多语言
 *
 * - 默认使用中文（zh），满足「界面上都是中文」的需求；
 * - 同时提供英文（en），便于后续扩展或对照开发；
 * - 所有用户可见字符串集中在此文件，避免散落在组件里难以维护。
 *
 * 使用方式：在组件中通过 useI18n() 取得 t()，例如 t("importJson")。
 * 带占位符的文案：t("timelineTick", { sec: 5 }) → 「5 秒」或 「5s」
 */

import type { TrackType } from "../types.js";

/** 支持的语言代码 */
export type Locale = "zh" | "en";

/** 文案键：与 zh 对象字段一一对应，保证中英键集合一致 */
export type MessageKey = keyof typeof messagesZh;

/** 中文文案表（主语言，字段注释在旁说明用途） */
const messagesZh = {
  // —— 应用标题 ——
  appTitle: "ScriptCut",
  appTagline: "剪辑式时间轴",
  /** 浏览器标签页标题 */
  pageTitle: "ScriptCut 时间轴编辑器",

  // —— 左侧流程步骤标题（①②③④） ——
  stepImportExport: "① 导入与导出",
  stepViewSnap: "② 时间轴视图与吸附",
  stepTidyTimeline: "③ 口播与镜头整理",
  stepTrackVisibility: "②b 轨道显示",
  stepShortcuts: "④ 快捷操作",

  // —— 语言切换 ——
  languageLabel: "界面语言",
  langZh: "中文",
  langEn: "English",

  // —— 导入导出 ——
  importJson: "导入 JSON",
  exportJson: "导出 JSON",
  /** 创建规范轨道、默认切点与空时间线，无需先准备 JSON */
  newBlankProject: "新建空白工程",
  newBlankProjectHint: "生成可立即编辑的空工程（约 30s 默认片长）；与「清空」不同，会打开空白时间轴而非关闭界面。",
  clearProject: "清空工程",

  // —— 快捷说明 ——
  shortcutsHint:
    "空格：播放/暂停。i / o：工作区入点/出点。↑ / ↓：按时间顺序切换选中片段。← / →：平移选中片段（Shift 大步）。Delete / Backspace：单选时删除该片段。Ctrl/Cmd+C/V/D：复制/粘贴/重复。Ctrl/Cmd+Z / Shift+Ctrl+Z：撤销/重做。时间线：**Ctrl/Cmd+滚轮**以指针下时间为锚横向缩放（可关左侧「缩放后尽量保持播放头在可视区内」避免与指针锚点抢滚动）。工具栏：缩放 ±、百分比重置、适配全部/所选。工具栏「新建 ▾」按轨顺序可选画面段（弹窗）或各轨约 2s 空 clip。「播放头拆分全部」：无需选中即可在所有穿过播放头的片段上切开。片段：Ctrl/Cmd+点击开关多选；Shift+点击在**同一轨道**内按时间顺序扩选区间；Ctrl/Cmd+Shift+点击将区间并入当前多选。Alt 或 Shift + 空白拖动框选。轨高：拖左侧轨头底缘。点击标尺跳转播放头。滚轮默认横向平移；Shift+滚轮纵向。波纹：左右细条+Ctrl/⌘。全轨空白间隙（蓝条）：Delete 波纹左移全部轨。仅某一轨空白（黄条）：Delete 只波纹该轨后续片段。",

  importFailed: "导入失败",

  // —— 视图 / 吸附 ——
  scale: "缩放（像素/秒）",
  snapCut: "吸附到 cut 点",
  thresholdSec: "吸附阈值（秒）",
  cpsThreshold: "语速上限（字/秒）",
  pxPerSecTitle: "时间轴横向缩放：每秒对应多少像素",
  zoomKeepPlayheadVisible: "缩放后尽量保持播放头在可视区内",
  toolbarZoomGroupAria: "时间线缩放",
  toolbarZoomOutHint: "缩小时间线（以播放头为锚）",
  toolbarZoomInHint: "放大时间线（以播放头为锚）",
  toolbarZoomResetHint: "恢复默认缩放（100%，相对 140 px/s）",
  toolbarFitAll: "适配全部",
  toolbarFitAllHint: "调整缩放使整条时间线大致落在视口内，并滚到片头",
  toolbarFitSelection: "适配所选",
  toolbarFitSelectionHint: "将当前选中片段的时间范围适配进视口（需先选中）",
  toolbarZoomSliderAria: "时间线横向缩放滑块",
  toolbarZoomSliderHint: "拖动改变每秒像素数（与左侧「缩放」一致）；按住时以播放头为锚",
  layoutResizeLeft: "拖动调整左栏宽度",
  layoutResizeRight: "拖动调整右栏宽度",
  rightBarWelcome:
    "提示：在中间时间轴点击片段可在此查看详情并编辑；多选时显示条数。可用左侧折叠块收起不常用的整理/快捷键说明。",
  cpsTooltip: "对白、旁白超过该语速会标红提示",

  trackVisibilityHint: "点 H 隐藏的轨道可在此重新勾选「显示」，或使用「全部显示」。",
  showAllTracks: "全部显示轨道",
  selectNone: "（未指定）",

  // —— 对白整理 ——
  resolveSpeechTitle: "对白去重叠",
  resolveSpeechBtn: "口播排队 + 全时间线跟随",
  resolveSpeechHint:
    "同轨重叠会顺延；从冲突点起，画面段落与后续内容整体右移以保持对齐。",

  // —— 自动切镜 ——
  autoCutsTitle: "自动切镜头",
  rangeSec: "镜头时长范围（秒）",
  rangeTilde: "～",
  keepExistingCuts: "保留已有 cut",
  autoCutsBtn: "生成 cut 并重建画面段落",
  minSegLenTitle: "自动切镜时：单段最短时长",
  maxSegLenTitle: "自动切镜时：单段最长时长",

  // —— 未加载工程时的步骤 ③ 提示 ——
  tidyNeedsProject: "请先导入 JSON 或新建空白工程，再使用本步骤。",

  // —— 中间空状态 ——
  emptyIntro:
    "可点击左侧「导入 JSON」加载 CLI 生成的 out.json（或仅含 project 字段的 JSON）；也可点「新建空白工程」从零开始编辑。",
  emptyHowTo: "操作方式",
  emptyDragMove: "拖拽片段主体：移动（时长不变）",
  emptyDragResize: "拖拽左右细条：拉伸（改变起止时间）",
  emptySnap: "开启「吸附到 cut 点」后，在阈值内会吸附到画面段落边界",
  emptyKeys:
    "选中片段后可用键盘 ← → 微调位置（Shift 为大步）",
  emptyRipple: "左右细条：按住 Ctrl 或 ⌘（Mac）拖拽可波纹编辑，全轨道在原出点之后的片段会整体平移。",
  emptyGapDelete:
    "无刻度空白：若所有轨都无片段，单击或横向拖选为蓝色高亮，Delete / Backspace 全轨波纹左移。若只有当前轨无片段（其它轨同一时刻仍有内容），在同一条轨的空白上单击或拖选为黄色高亮，Delete 仅波纹当前轨。Esc 取消。框选片段：Alt 或 Shift + 空白拖动。",
  emptyVisualHint:
    "画面轨绿色条：上行可为景别/运镜代码摘要，下行为画面描述摘要。结构化 code 不合法时会红框提示（悬停看原因）。",

  // —— 右侧检查器 ——
  inspectorProject: "工程信息",
  inspectorSelected: "选中项",
  countVisualSegments: "画面段数量",
  countClips: "口播片段数",
  countCuts: "切镜点（cuts）",
  inputPath: "来源路径",
  fieldTimelineEnd: "时间线末端（秒）",
  fieldTargetDurationMeta: "片长 meta.targetDurationSec",
  clickClipDetail: "点击时间轴上任意片段查看详情",

  fieldId: "标识",
  fieldKind: "类型",
  fieldTrack: "轨道",
  fieldTime: "时间范围",
  fieldTitle: "标题",
  fieldSummary: "摘要",
  fieldText: "文本",

  kindClip: "口播片段",
  kindVisualSegment: "画面段落",

  segmentBlockTitle: "画面段落（结构化字段）",
  fieldFramingStart: "起幅景别",
  fieldFramingEnd: "落幅景别",
  fieldCameraMove: "运镜",
  fieldMoveAmplitude: "幅度",
  fieldMoveDurationHint: "运镜时长提示",
  fieldFramingLegacy: "景别（旧字段）",
  fieldCameraLegacy: "运镜（旧字段）",
  fieldDescription: "画面描述",
  fieldSegmentLabel: "镜位标签（label）",

  clipEditBlockTitle: "片段属性（可编辑）",
  fieldSpeaker: "说话人 / 主体",
  fieldClipMeta: "括号说明（clip.meta）",
  fieldSource: "来源（source）",
  fieldStart: "入点（秒）",
  fieldEnd: "出点（秒）",
  /** 工具栏「新建」菜单的无障碍标签 */
  newClipTrackLabel: "在播放头新建：按轨道顺序选择类型",
  /** 合并原「新建片段」与「新建画面段」为同一菜单 */
  toolbarNewMenu: "新建 ▾",
  toolbarNewMenuHint:
    "按时间轴轨顺序列出：选「画面段落」会打开表单（标签/时长）；其余轨在播放头插入约 2 秒空 clip。请先移动播放头到目标时间。",
  modalNewVisualTitle: "新建画面段",
  modalNewVisualStart: "插入起点（秒）",
  modalNewVisualLabel: "镜位标签（label）",
  modalNewVisualDuration: "时长（秒，最短 0.1）",
  modalConfirm: "确定",
  modalCancel: "取消",

  speechSuggestMin: "建议最短口播（秒）",
  speechCurrentDur: "当前时长（秒）",
  speechConclusion: "结论",
  speechOverspeed: "偏快（建议延长或拆分）",
  speechOk: "正常",
  extendRipple: "波纹 延长",
  extendNoRipple: "延长（无波纹）",
  splitByPunc: "按标点拆分",
  splitAlignCuts: "拆分并对齐 cut",

  none: "—",

  // —— 时间轴轨道名 ——
  trackVisual: "画面",
  trackDialogue: "对白",
  trackNarration: "旁白",
  trackAction: "动作/节拍",
  trackInfo: "信息/参考",
  trackEnvironment: "环境/场景",
  trackSubtitle: "字幕",
  trackSfx: "音效",

  /** 轨道 L/S/H */
  trackLock: "锁定：禁止拖动/修剪本轨片段",
  trackSolo: "独奏：压低其它轨显示（可多轨独奏）",
  trackHide: "隐藏本轨",
  rollEditHint: "滑动接点（roll）：拖动改变两片段接缝，总时长不变",
  trackResizeHint: "在左侧轨头底缘上下拖动，调整本轨高度",

  /** 时间轴工具栏 */
  toolbarPlay: "播放（空格）",
  toolbarPause: "暂停",
  toolbarWorkIn: "入点 I：将工作区起点设到播放头",
  toolbarWorkOut: "出点 O：将工作区终点设到播放头",
  toolbarWorkClear: "清除入出点",
  toolbarSplit: "在播放头拆分选中片段",
  toolbarSplitAllAtPlayhead: "播放头拆分全部",
  toolbarUndo: "撤销",
  toolbarRedo: "重做",
  multiSelectCount: "已选 {{n}} 项",

  // —— 时间轴刻度与提示 ——
  timelineTick: "{{sec}} 秒",
  tooltipCpsWarn: "语速 {{cps}} 字/秒，超过上限 {{max}}",
  /** 画面段结构化字段异常（与对白语速标红同一套 danger 样式） */
  visualStructInvalidFramingStart: "framingStart 不是规范景别 code（见 filmVocabulary）",
  visualStructInvalidFramingEnd: "framingEnd 不是规范景别 code",
  visualStructInvalidCameraMove: "cameraMove 不是规范运镜 code",
  visualStructInvalidMoveAmplitude: "moveAmplitude 须为 S / M / L",
  visualStructFramingOneSided: "景别只填了起点或终点一端，建议成对填写 framingStart / framingEnd",
  visualStructMoveHintInvalid: "moveDurationHint 须为正数（秒）",
  /** 片段角标：每秒字符数 */
  clipCpsLabel: "语速",
  /** 片段标题旁：仅 UI 展示时长（数据仍为 start/end）；tooltip 显示完整范围 */
  clipDurationDisplay: "{{sec}}秒",
  clipDurationTooltip: "范围 {{start}}–{{end}}",

  // —— 帮助模式（分散在各功能旁的简短说明，无整页文档浮层） ——
  helpModeToggle: "帮助模式",
  helpModeToggleHint: "开启后，各功能块旁会出现针对该块的说明；关闭即隐藏。",
  /** 顶栏：语言与开关 */
  helpHintSettings:
    "切换界面语言。帮助模式只增加提示文字，不会改动工程数据。排查问题可在地址栏加 ?debug=1 后刷新，打开控制台查看 [ScriptCut] 日志（详见代码 debugLog）。",
  helpHintImportExport:
    "导入 CLI 或 AI 生成的 JSON 工程；导出可下载当前时间轴编辑结果，文件名一般为「工程 inputPath 去扩展名 + _edited.json」。新建空白工程会打开规范轨道与空时间线（无需 JSON）。清空会关闭工程并清空选中。",
  helpHintImportError: "请对照报错修改 JSON；结构说明见项目内 docs/SCRIPT_CUT_AI_SPEC.md。",
  helpHintViewSnap:
    "缩放（像素/秒）决定时间轴疏密；左侧可勾选缩放后是否尽量把播放头滚进视口。时间线上 **Ctrl/Cmd+滚轮** 以指针位置为锚缩放。工具栏另有 ±、百分比（点按恢复默认）、适配全部/所选。吸附让拖动/拉伸更易对齐切镜点；语速上限用于对白、旁白标红。画面轨结构化字段不合法也会红框提示。",
  helpHintTrackVisibility: "若某轨被 H 隐藏，时间轴上不再显示该轨；在此勾选可恢复，无需在时间轴上点到隐藏轨的按钮。",
  helpHintTidyLocked: "导入工程后可：消除口播重叠并整体顺延时间线，或按口播节奏自动切镜并重算画面段。",
  helpHintTidySpeech: "处理同轨片段重叠；从冲突点起可连带画面段与后续内容右移，减少声画错位。",
  helpHintTidyCuts: "在设定的镜头时长区间内自动生成 cut，并重建画面段；可保留已有 cut，区间影响镜头疏密。",
  helpHintShortcuts: "与时间轴配合：选中片段后用 ← → 平移（Shift 加大步长）；焦点在输入框内时不触发，避免误改参数。",
  /** 中间未导入时的占位区 */
  helpHintEmptyCenter: "此处为无工程时的说明；导入 JSON 或新建空白工程后，同一区域变为可横向滚动的时间轴。",
  /** 时间轴区域（有工程时显示在轴上方） */
  helpHintTimeline:
    "竖线为切镜点；点击标尺跳转播放头（标尺不可选中文字）。空格播放/暂停：设好入点 I 与出点 O 后在该区间内循环，否则播到片尾停止。↑ / ↓ 按时间顺序切换选中片段；单选时 Delete 可删该片段（与删间隙不冲突：选中间隙时优先删间隙）。拖中间平移，拖两侧细条改入点/出点；按住 Ctrl 或 ⌘（Mac）拖细条为全轨道波纹编辑。Ctrl/Cmd 点片段开关多选；Shift+点片段在**当前轨**内按时间顺序扩选；Ctrl/Cmd+Shift+点将区间并入已选。Alt 或 Shift + 空白拖动框选片段（滑出时间线外仍有效；命中以片段实际像素为准）。时间轴不占用鼠标右键，避免与浏览器菜单冲突。工具栏「新建 ▾」按轨顺序在播放头插入各轨 clip 或打开画面段表单。同轨相邻片段接缝处可拖动黄色接点做 roll。L/S/H：轨锁定/独奏显示/隐藏；隐藏轨可在左侧「轨道显示」里勾回。同轨重叠片段会分层显示。轨高：在左侧轨头底缘上下拖动。无刻度空白：全轨无片段为蓝色间隙条 Delete 全轨波纹；仅当前轨无片段为黄色间隙条 Delete 只波纹该轨。滚轮横滑；Shift+滚轮纵滚。对白/旁白标红为语速提示。",
  /** 时间轴片段左右手柄的悬停说明 */
  timelineHandleRipple: "拖动：修剪入点/出点。按住 Ctrl 或 ⌘（Mac）拖动：全轨道波纹编辑（原出点之后的片段整体平移）。",
  /** 右侧检查器 */
  helpHintInspectorProject:
    "统计画面段数、片段数、切镜点数与来源路径。时间线末端与 meta.targetDurationSec 会在拖拽、拉伸、拆分及检查器改时长后自动同步（导出 JSON 可见）。",
  helpHintInspectorSelect: "在时间轴上点击一条片段，此处显示详情与可用操作。",
  helpHintInspectorClip:
    "核对类型与轨道。各类 clip 可在下方编辑文本、说话人、meta、时间与来源；画面段走结构化字段与描述。",
  helpHintInspectorSegment: "景别、运镜等为 JSON 结构化字段；括号内为中文释义（来自内置词典）。",
  helpHintInspectorSegmentEdit: "画面段落可在下方用下拉修改结构化字段（会写入工程，可撤销）；画面描述可在此编辑长文本。",
  helpHintInspectorSpeech:
    "按字数估算最短口播。「波纹延长」拉长末端后，会把整条时间线上起点不早于原出点的 clips、画面段一并右移（全局 ripple）并重算 cuts，便于声画对齐。「延长（无波纹）」只改本条出点，不推移后续内容（可能与后续片段重叠，需自行整理）。可按标点拆分（可选对齐切镜点）。",
} as const;

/** 英文文案（与中文键一致） */
const messagesEn: Record<MessageKey, string> = {
  appTitle: "ScriptCut",
  appTagline: "Edit-style timeline",
  pageTitle: "ScriptCut timeline editor",

  stepImportExport: "① Import & export",
  stepViewSnap: "② View & snapping",
  stepTidyTimeline: "③ Speech & cuts",
  stepTrackVisibility: "②b Track visibility",
  stepShortcuts: "④ Shortcuts",

  languageLabel: "Language",
  langZh: "中文",
  langEn: "English",

  importJson: "Import JSON",
  exportJson: "Export JSON",
  newBlankProject: "New blank project",
  newBlankProjectHint:
    "Creates an editable empty timeline with canonical tracks (~30s default span); unlike Clear, it opens a project instead of closing the editor.",
  clearProject: "Clear",

  shortcutsHint:
    "Space: play/pause. i / o: work area In/Out. ↑ / ↓: move selection along time order. ← / →: nudge selection (Shift: larger). Delete/Backspace: delete one selected item. Ctrl/Cmd+C/V/D: copy/paste/duplicate. Ctrl/Cmd+Z / Shift+Ctrl+Z: undo/redo. Timeline: **Ctrl/Cmd+wheel** zooms horizontally around the pointer (disable “keep playhead visible” in the left panel if it fights the pointer anchor). Toolbar: zoom − / +, percent (click = reset), fit all / fit selection. 「New ▾」: visual form or ~2s clip by track order. 「Split all at playhead」: razor every crossed item. Clips: Ctrl/Cmd+click toggles; Shift+click range **on the same track**; Ctrl/Cmd+Shift+click unions range. Alt or Shift + drag: marquee. Wheel pans horizontally; Shift+wheel: vertical. Track height: drag track header bottom. Ruler: seek. Handles + Ctrl/⌘: ripple. Global gap (blue) / track gap (amber): Delete ripple rules as before.",

  importFailed: "Import failed",

  scale: "Scale (px/s)",
  snapCut: "Snap to cuts",
  thresholdSec: "Snap threshold (s)",
  cpsThreshold: "Max chars/s",
  pxPerSecTitle: "Horizontal zoom: pixels per second",
  zoomKeepPlayheadVisible: "After zoom, keep playhead in view when possible",
  toolbarZoomGroupAria: "Timeline zoom",
  toolbarZoomOutHint: "Zoom out (anchored at playhead)",
  toolbarZoomInHint: "Zoom in (anchored at playhead)",
  toolbarZoomResetHint: "Reset zoom to 100% (140 px/s default)",
  toolbarFitAll: "Fit all",
  toolbarFitAllHint: "Fit the whole timeline in the viewport and scroll to start",
  toolbarFitSelection: "Fit selection",
  toolbarFitSelectionHint: "Fit the time range of selected clips (select clips first)",
  toolbarZoomSliderAria: "Timeline horizontal zoom slider",
  toolbarZoomSliderHint: "Drag to change pixels per second (same as left panel). Uses playhead as anchor while dragging.",
  layoutResizeLeft: "Drag to resize left sidebar",
  layoutResizeRight: "Drag to resize right sidebar",
  rightBarWelcome:
    "Tip: click a clip on the timeline to inspect and edit here; multi-select shows a count. Collapse left sections you don’t need.",
  cpsTooltip: "Dialogue/narration above this rate is highlighted",

  trackVisibilityHint: "Tracks hidden with H can be shown again here, or use Show all.",
  showAllTracks: "Show all tracks",
  selectNone: "(Unset)",

  resolveSpeechTitle: "Resolve speech overlap",
  resolveSpeechBtn: "Queue speech + ripple timeline",
  resolveSpeechHint:
    "Overlaps shift right; from the conflict, visuals and following content move together.",

  autoCutsTitle: "Auto cuts",
  rangeSec: "Shot length (s)",
  rangeTilde: "–",
  keepExistingCuts: "Keep existing cuts",
  autoCutsBtn: "Generate cuts & rebuild visuals",
  minSegLenTitle: "Minimum shot length",
  maxSegLenTitle: "Maximum shot length",

  tidyNeedsProject: "Import JSON or create a blank project before using this section.",

  emptyIntro:
    'Use 「Import JSON」 for out.json from the CLI (or JSON with a "project" field), or 「New blank project」 for an empty timeline.',
  emptyHowTo: "How to edit",
  emptyDragMove: "Drag clip body: move (same duration)",
  emptyDragResize: "Drag side handles: trim start/end",
  emptySnap: 'With 「Snap to cuts」, edges snap within the threshold',
  emptyKeys: "Select a clip, then ← → to nudge (Shift: larger step)",
  emptyRipple: "Side handles: hold Ctrl or ⌘ (Mac) while dragging to ripple all tracks—clips after the original out-point shift together.",
  emptyGapDelete:
    "Gaps: if no track has a clip there, click or drag for a blue band—Delete/Backspace ripple-left on every track. If only this track is empty (others still have clips), click/drag on that lane’s blank for an amber band—Delete ripple-left on that track only. Esc clears. Marquee clips: Alt or Shift + drag on empty space.",
  emptyVisualHint:
    "Visual track: top line = framing/camera codes, bottom = description summary. Invalid structured codes get a red outline (hover for why).",

  inspectorProject: "Project",
  inspectorSelected: "Selection",
  countVisualSegments: "Visual segments",
  countClips: "Clips",
  countCuts: "Cuts",
  inputPath: "Source path",
  fieldTimelineEnd: "Timeline end (s)",
  fieldTargetDurationMeta: "meta.targetDurationSec",
  clickClipDetail: "Click any clip on the timeline for details",

  fieldId: "ID",
  fieldKind: "Kind",
  fieldTrack: "Track",
  fieldTime: "Time",
  fieldTitle: "Title",
  fieldSummary: "Summary",
  fieldText: "Text",

  kindClip: "Clip",
  kindVisualSegment: "Visual segment",

  segmentBlockTitle: "Visual segment (structured)",
  fieldFramingStart: "Framing start",
  fieldFramingEnd: "Framing end",
  fieldCameraMove: "Camera move",
  fieldMoveAmplitude: "Amplitude",
  fieldMoveDurationHint: "Move duration hint",
  fieldFramingLegacy: "Framing (legacy)",
  fieldCameraLegacy: "Camera (legacy)",
  fieldDescription: "Description",
  fieldSegmentLabel: "Shot label",

  clipEditBlockTitle: "Clip (editable)",
  fieldSpeaker: "Speaker / subject",
  fieldClipMeta: "Performance note (clip.meta)",
  fieldSource: "Source",
  fieldStart: "In (s)",
  fieldEnd: "Out (s)",
  newClipTrackLabel: "New at playhead: pick a track (menu order matches the timeline)",
  toolbarNewMenu: "New ▾",
  toolbarNewMenuHint:
    "Lists tracks in timeline order: Visual opens a form (label/duration); other tracks add ~2s empty clip at playhead. Move the playhead first.",
  modalNewVisualTitle: "New visual segment",
  modalNewVisualStart: "Insert at (seconds)",
  modalNewVisualLabel: "Shot label",
  modalNewVisualDuration: "Duration (s, min 0.1)",
  modalConfirm: "OK",
  modalCancel: "Cancel",

  speechSuggestMin: "Min speech (s)",
  speechCurrentDur: "Duration (s)",
  speechConclusion: "Verdict",
  speechOverspeed: "Too fast (extend or split)",
  speechOk: "OK",
  extendRipple: "Ripple extend",
  extendNoRipple: "Extend (no ripple)",
  splitByPunc: "Split on punctuation",
  splitAlignCuts: "Split & align to cuts",

  none: "—",

  trackVisual: "Visual",
  trackDialogue: "Dialogue",
  trackNarration: "Narration",
  trackAction: "Action",
  trackInfo: "Info",
  trackEnvironment: "Environment",
  trackSubtitle: "Subtitle",
  trackSfx: "SFX",

  trackLock: "Lock track: disable drag/trim",
  trackSolo: "Solo: dim other tracks (multiple allowed)",
  trackHide: "Hide track",
  rollEditHint: "Roll edit: drag the junction; total duration unchanged",
  trackResizeHint: "Drag the bottom edge of the left track header to resize height",

  toolbarPlay: "Play (Space)",
  toolbarPause: "Pause",
  toolbarWorkIn: "Mark In (work area start at playhead)",
  toolbarWorkOut: "Mark Out (work area end at playhead)",
  toolbarWorkClear: "Clear In/Out",
  toolbarSplit: "Split selected at playhead",
  toolbarSplitAllAtPlayhead: "Split all at playhead",
  toolbarUndo: "Undo",
  toolbarRedo: "Redo",
  multiSelectCount: "{{n}} items selected",

  timelineTick: "{{sec}}s",
  tooltipCpsWarn: "Rate {{cps}} chars/s exceeds {{max}}",
  visualStructInvalidFramingStart: "framingStart is not a valid framing code (see filmVocabulary)",
  visualStructInvalidFramingEnd: "framingEnd is not a valid framing code",
  visualStructInvalidCameraMove: "cameraMove is not a valid camera-move code",
  visualStructInvalidMoveAmplitude: "moveAmplitude must be S, M, or L",
  visualStructFramingOneSided: "Only one of framingStart / framingEnd is set; prefer both",
  visualStructMoveHintInvalid: "moveDurationHint must be a positive number (seconds)",
  clipCpsLabel: "cps",
  clipDurationDisplay: "{{sec}} s",
  clipDurationTooltip: "{{start}}–{{end}}",

  helpModeToggle: "Help mode",
  helpModeToggleHint: "Shows short hints next to each control group. Turn off to hide them.",
  helpHintSettings:
    "Change UI language. Help mode only adds notes; it does not change project data. For troubleshooting, add ?debug=1 to the URL, reload, and watch the console for [ScriptCut] logs (see debugLog in code).",
  helpHintImportExport:
    "Import JSON from the CLI or AI; export downloads your edited timeline as `{input basename}_edited.json`. New blank project opens canonical tracks and an empty timeline without a JSON file. Clear closes the project.",
  helpHintImportError: "Fix the JSON using the error text; see docs/SCRIPT_CUT_AI_SPEC.md for the schema.",
  helpHintViewSnap:
    "Zoom (px/s) sets timeline density; you can opt to keep the playhead in view after zoom. On the timeline, **Ctrl/Cmd+wheel** zooms around the pointer. The toolbar adds − / +, percent (click to reset default), and fit-all / fit-selection. Snap aligns trims to cuts; max chars/s warns on fast dialogue/narration. Invalid structured fields on visuals show a red outline.",
  helpHintTrackVisibility: "If a track was hidden with H, it no longer appears on the timeline; re-enable it here.",
  helpHintTidyLocked: "After import: resolve speech overlaps with ripple, or auto-generate cuts and rebuild visual segments.",
  helpHintTidySpeech: "Fix same-track overlaps; optionally ripple visuals and everything after the conflict to the right.",
  helpHintTidyCuts: "Generate cuts within min/max shot length and rebuild segments; optionally keep existing cuts.",
  helpHintShortcuts: "With a clip selected, ← → nudge (Shift = larger step). Disabled while an input is focused.",
  helpHintEmptyCenter:
    "Placeholder when no project is open; after import or New blank project, this area becomes the scrollable timeline.",
  helpHintTimeline:
    "Cuts are vertical; click ruler to move playhead (ruler text is not selectable). Space plays: loops work area if In/Out set, else stops at end. ↑ / ↓ walk selection; Delete removes one item (gap selection uses Delete to close gap). Drag clips; Ctrl/⌘+handles ripple. Ctrl/Cmd+click toggles selection; Shift+click extends range **on the same track**; Ctrl/Cmd+Shift+click unions range. Alt or Shift + drag on empty space for marquee (clip pixel bounds). The timeline does not bind the right mouse button (avoids browser context menus). Toolbar 「New ▾」adds clips or opens the visual-segment form at the playhead, in track order. Yellow junction: roll. L/S/H: lock/solo/hide. Overlapping clips stack in rows. Resize track height by dragging the bottom of the left track header. Global gap (blue): Delete ripple all tracks. Single-track gap (amber): ripple that track only. Wheel pans horizontally; Shift+wheel vertical. Red = speech rate warning.",
  timelineHandleRipple: "Drag: trim in/out. Hold Ctrl or ⌘ (Mac) and drag: ripple all tracks (shift every clip that starts at or after the original out-point).",
  helpHintInspectorProject:
    "Counts segments, clips, cuts, and the source path. Timeline end and meta.targetDurationSec stay in sync when you drag, trim, split, or edit durations (visible in exported JSON).",
  helpHintInspectorSelect: "Click a clip on the timeline to see details and actions here.",
  helpHintInspectorClip:
    "Check type and track. All clip kinds can edit text, speaker, meta, time, and source below; visual segments use structured fields and description.",
  helpHintInspectorSegment: "Framing/camera codes come from JSON; parentheses show dictionary labels.",
  helpHintInspectorSegmentEdit:
    "For visual segments, edit structured fields with dropdowns (saved to project, undoable); use the text area for description.",
  helpHintInspectorSpeech:
    "Estimates min speech from text. \"Ripple extend\" lengthens the out-point, then shifts every clip and visual segment starting at or after the original out-point (full-timeline ripple) and rebuilds cuts. \"Extend (no ripple)\" only lengthens this clip (may overlap the next clip—edit manually). Split on punctuation optionally snaps to cuts.",
};

const STORAGE_KEY = "scriptcut-locale";

/** 从 localStorage 读取语言，缺省或非法时返回 zh */
export function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* 忽略隐私模式等导致的存储异常 */
  }
  return "zh";
}

/** 持久化语言选择 */
export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* 同上 */
  }
}

function pickMessages(locale: Locale): Record<MessageKey, string> {
  return locale === "en" ? messagesEn : messagesZh;
}

/**
 * 创建翻译函数
 * @param locale 当前语言
 * @returns t(key, vars?) 替换 {{name}} 形式的占位符
 */
export function createTranslator(locale: Locale) {
  const table = pickMessages(locale);
  return function t(key: MessageKey, vars?: Record<string, string | number>): string {
    let s = table[key];
    if (vars) {
      for (const [k, val] of Object.entries(vars)) {
        s = s.replaceAll(`{{${k}}}`, String(val));
      }
    }
    return s;
  };
}

/** 根据 kind 显示本地化类型名 */
export function kindLabel(kind: "clip" | "visualSegment", t: ReturnType<typeof createTranslator>): string {
  return kind === "clip" ? t("kindClip") : t("kindVisualSegment");
}

/** 轨道类型 → 界面显示名（时间轴与检查器共用） */
export function trackTypeLabel(type: TrackType, t: ReturnType<typeof createTranslator>): string {
  switch (type) {
    case "visual":
      return t("trackVisual");
    case "dialogue":
      return t("trackDialogue");
    case "narration":
      return t("trackNarration");
    case "action":
      return t("trackAction");
    case "info":
      return t("trackInfo");
    case "environment":
      return t("trackEnvironment");
    case "subtitle":
      return t("trackSubtitle");
    case "sfx":
      return t("trackSfx");
    default:
      return type;
  }
}
