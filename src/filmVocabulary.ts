/**
 * 电影摄影专业词汇（与 film-production 技能包 / 行业标准对齐）
 *
 * 用途：
 * - AI 生成 JSON 时 `framingStart` / `framingEnd` / `cameraMove` 必须使用下列 **code**（稳定、可校验）
 * - `framing` / `camera` 自由文本仍可作兼容或补充说明（如 Seedance 英文 prompt 整句）
 *
 * 说明：景别与运镜的中文释义见 docs/SCRIPT_CUT_AI_SPEC.md 完整表。
 */

/** 景别 code：与 camera.md 中景别体系对应 */
export const FRAMING_CODES = [
  "EWS", // Extreme Wide Shot — 极远景
  "WS", // Wide / Long Shot — 远景
  "FS", // Full Shot — 全景（全身+环境）
  "MS", // Medium Shot — 中景（常用膝上/腰上）
  "MCU", // Medium Close-Up — 中近景
  "CU", // Close-up — 特写
  "ECU" // Extreme Close-up — 极特写
] as const;

export type FramingCode = (typeof FRAMING_CODES)[number];

/** 镜头运动 code：与 cinematography.md / SKILL.md 运镜体系对应 */
export const CAMERA_MOVE_CODES = [
  "Fixed", // Static — 固定机位
  "SlowPush", // 慢推 / Dolly in slow
  "FastPush", // 急推 / 快速推向主体
  "SlowPull", // 慢拉 / Dolly out slow
  "FastPull", // 快拉 / 快速远离主体
  "Pan", // 水平摇
  "Tilt", // 垂直摇
  "CraneUp", // 升 / Boom up
  "CraneDown", // 降 / Boom down
  "Truck", // 横移 / 轨道侧移（与主体平行移动）
  "Follow", // 跟拍 / Tracking / 稳定器跟拍（语义合并）
  "Orbit", // 环绕主体
  "Handheld", // 手持
  "WhipPan", // 甩镜 / 急摇转场
  "Combo" // 组合运镜（需在 `camera` 或 `description` 中写清组合方式）
] as const;

export type CameraMoveCode = (typeof CAMERA_MOVE_CODES)[number];

/** 运动幅度：与 Timing Spec 中 S/M/L 时长带一致 */
export const MOVE_AMPLITUDES = ["S", "M", "L"] as const;
export type MoveAmplitude = (typeof MOVE_AMPLITUDES)[number];

/** 幅度 code → 中文（画面结构化字段摘要 / 检查器） */
export const MOVE_AMPLITUDE_LABELS_ZH: Record<MoveAmplitude, string> = {
  S: "小",
  M: "中",
  L: "大"
};

/** 景别 code → 中文简称（供 UI / 日志） */
export const FRAMING_LABELS_ZH: Record<FramingCode, string> = {
  EWS: "极远景",
  WS: "远景",
  FS: "全景",
  MS: "中景",
  MCU: "中近景",
  CU: "特写",
  ECU: "极特写"
};

/** 运镜 code → 中文简称 */
export const CAMERA_MOVE_LABELS_ZH: Record<CameraMoveCode, string> = {
  Fixed: "固定",
  SlowPush: "慢推",
  FastPush: "急推",
  SlowPull: "慢拉",
  FastPull: "快拉",
  Pan: "摇（水平）",
  Tilt: "摇（垂直）",
  CraneUp: "升降-升",
  CraneDown: "升降-降",
  Truck: "横移",
  Follow: "跟拍",
  Orbit: "环绕",
  Handheld: "手持",
  WhipPan: "甩镜",
  Combo: "组合运镜"
};

/**
 * 校验字符串是否为合法景别 code（导入 JSON 时可用）
 */
export function isFramingCode(s: string): s is FramingCode {
  return (FRAMING_CODES as readonly string[]).includes(s);
}

/**
 * 校验字符串是否为合法运镜 code
 */
export function isCameraMoveCode(s: string): s is CameraMoveCode {
  return (CAMERA_MOVE_CODES as readonly string[]).includes(s);
}
