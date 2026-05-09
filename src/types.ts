import type { CameraMoveCode, FramingCode, MoveAmplitude } from "./filmVocabulary.js";

/**
 * 这个文件定义“剧本文字剪辑”的最小数据模型（MVP）。
 *
 * 设计目标：
 * - Cut 只是“时间点/分界事件”，不承载景别/对白等语义。
 * - VisualSegment 是两个 cut 之间的画面段落（可切分/可拉伸/可重排的容器）。
 * - Clip 是任意轨道上的时间片段（对白/旁白/动作/信息），天然允许跨 segment/cut 重叠。
 *
 * 备注：
 * - 这里的 “Shot” 仅作为输入脚本里的命名；在输出里我们用 VisualSegment + label 来承接它。
 * - 所有时间单位统一为“秒”（number）。
 */

export type TrackType =
  | "visual"
  | "dialogue"
  | "narration"
  | "action"
  /** 音效 / 环境声 / 拟音（Foley），与对白轨分离，便于混音与时间线对齐 */
  | "sfx"
  | "info"
  /** 故事场景：地点、时段、空间、氛围等（与 info 的说明/参考、visual 的镜内画面描述区分） */
  | "environment"
  | "subtitle";

export interface Track {
  /** 轨道 ID，用于 clips 引用 */
  id: string;
  /** 轨道类型 */
  type: TrackType;
  /** 轨道显示名称（可选，用于 UI） */
  name?: string;
}

export interface Cut {
  /** cut ID */
  id: string;
  /** cut 时间点（秒） */
  t: number;
  /**
   * cut 类型（硬切/淡入淡出/叠化等）
   * MVP 不做复杂枚举，先留字符串位，便于未来扩展。
   */
  kind?: string;
  /** 备注/标记说明 */
  note?: string;
}

export interface VisualSegment {
  id: string;
  /** 段落起始时间（秒） */
  start: number;
  /** 段落结束时间（秒） */
  end: number;
  /** 输入脚本中的标签，例如 "Shot 01" */
  label: string;
  /**
   * 段落开始时的景别（结构化，优先于自由文本 `framing`）
   * 取值见 `filmVocabulary.FRAMING_CODES`，与 film-production / 专业景别体系一致
   */
  framingStart?: FramingCode;
  /**
   * 段落结束时的景别；若与 `framingStart` 相同则本段内景别不变（常配 Fixed）
   * 渐变景别时配合 SlowPush / SlowPull / Dolly 类运镜
   */
  framingEnd?: FramingCode;
  /**
   * 镜头运动类型（结构化，优先于自由文本 `camera`）
   * 取值见 `filmVocabulary.CAMERA_MOVE_CODES`
   */
  cameraMove?: CameraMoveCode;
  /**
   * 运动幅度 S/M/L，与 Timing Spec 中各运镜时长带对应
   */
  moveAmplitude?: MoveAmplitude;
  /** 运动建议最短时长（秒），用于 AI 自检或与 `end-start` 取 max */
  moveDurationHint?: number;
  /** 输入脚本中的景别字段（兼容旧数据；可与 framingStart/End 并存，AI 可写英文摘要） */
  framing?: string;
  /** 输入脚本中的运镜字段（兼容旧数据；Combo 或复杂运动时建议写清组合） */
  camera?: string;
  /** 画面描述（通常来自英文文字节点或 Seedance 可用 prompt） */
  description?: string;
  /** 可选：属于哪个段/页/场景等层级信息 */
  group?: string;
}

/** 重新导出专业词汇类型，便于外部 `import { FramingCode } from "./types.js"` */
export type { CameraMoveCode, FramingCode, MoveAmplitude } from "./filmVocabulary.js";

export interface Clip {
  id: string;
  trackId: string;
  start: number;
  end: number;
  /** 谁在说/谁在做（对白/旁白/动作可用） */
  speaker?: string;
  /**
   * 内容文本（对白/旁白/动作/音效/信息/字幕）
   * - 对于对白/旁白：台词正文
   * - 对于动作：动作描述
   * - 对于音效：声音内容简述（如「电动车急刹」「风沙」），供时间线与检索
   * - 对于信息：参考说明/策略（通常不占主时长）
   * - 对于环境：场景/时空/氛围描述（可与画面段落同时间段并存）
   */
  text: string;
  /** 括号里的表演/语气/说明，例如 “旁白，平淡，画外音” */
  meta?: string;
  /** 内容来源（比如 "seedance.segment1" / "subtitle.table"），便于追溯 */
  source?: string;
}

export interface ScriptCutProject {
  /** 工程版本 */
  version: string;
  /** 输入文件路径（便于追溯） */
  inputPath: string;
  /** 项目级元信息（从 md 的“选题元信息”里提取到的 key-value，MVP 可为空） */
  meta: Record<string, string>;

  tracks: Track[];
  cuts: Cut[];
  visualSegments: VisualSegment[];
  clips: Clip[];
}

export interface DensityWarning {
  clipId: string;
  trackType: TrackType;
  speaker?: string;
  start: number;
  end: number;
  duration: number;
  /** 文本长度（按“可见字符”计，MVP 先不区分中英文） */
  chars: number;
  /** chars per second */
  cps: number;
  /** 阈值 */
  threshold: number;
  text: string;
  reason: string;
}

