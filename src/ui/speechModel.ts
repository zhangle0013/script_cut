/**
 * 口播/旁白“建议最短时长”模型（MVP）。
 *
 * 你关心的核心问题是：AI 生成脚本时长不稳，导致画面/对白节奏对不上。
 * 所以我们不只做 cps（字数/秒）报警，还要能给出“这句话至少需要多久才能念得像人”。
 *
 * 重要说明：
 * - 这不是 ASR/TTS 的真实发音时长，它是一个可解释的启发式估算模型。
 * - 好处是：可调参、可对比、可作为“自动修复”和“自动切镜头”的基础。
 *
 * 模型思想（尽量简单，但贴近口播感）：
 * 1) 基础发音速度：中文按 chars-per-second（cps）估算
 * 2) 标点停顿：逗号/句号/问号/感叹号/省略号/破折号等追加停顿秒数
 * 3) 数字与英文：额外加一点“读出来更慢”的惩罚项（可调）
 *
 * 你后续要更准，可以升级为：
 * - 中文按字，英文按词（word count），数字按“读法”拆分
 * - 根据角色/语气不同套不同参数（AI 骑手 vs 陈曦）
 */

export interface SpeechModelParams {
  /** 中文基础语速（每秒字符数）。常见口播 6~10。 */
  baseCps: number;
  /** 每个英文字符额外惩罚（秒）。用于让英文/缩写变慢一些。 */
  latinExtraPerChar: number;
  /** 每个数字字符额外惩罚（秒）。 */
  digitExtraPerChar: number;
  /** 标点停顿权重（秒）。 */
  pauses: {
    comma: number; // ， ,
    period: number; // 。 .
    question: number; // ？ ?
    exclamation: number; // ！ !
    ellipsis: number; // …… ...
    dash: number; // —— -
    colon: number; // ： :
    semicolon: number; // ； ;
  };
  /**
   * 最小发声时长（秒）
   * - 避免极短句被估算成 0.2s 这种 UI 不可编辑/听感不自然的时长
   */
  minDuration: number;
}

export interface SpeechEstimate {
  /** 建议最短时长（秒） */
  minDuration: number;
  /** 估算分解（用于 UI 展示/调参解释） */
  breakdown: {
    visibleChars: number;
    baseTime: number;
    pauseTime: number;
    latinExtra: number;
    digitExtra: number;
    punctuationCounts: Record<string, number>;
  };
}

export const DEFAULT_SPEECH_PARAMS: SpeechModelParams = {
  baseCps: 7.5,
  latinExtraPerChar: 0.015,
  digitExtraPerChar: 0.02,
  pauses: {
    comma: 0.18,
    period: 0.32,
    question: 0.36,
    exclamation: 0.36,
    ellipsis: 0.42,
    dash: 0.12,
    colon: 0.22,
    semicolon: 0.26
  },
  minDuration: 0.6
};

/**
 * 统计标点数量并换算成停顿时间。
 */
function calcPauseTime(text: string, p: SpeechModelParams): { pauseTime: number; counts: Record<string, number> } {
  const counts: Record<string, number> = {
    comma: 0,
    period: 0,
    question: 0,
    exclamation: 0,
    ellipsis: 0,
    dash: 0,
    colon: 0,
    semicolon: 0
  };

  // 逗号：中英文逗号都算
  counts.comma = (text.match(/[，,]/g) ?? []).length;
  // 句号：中文句号 + 英文句号（注意：小数点也会被算进去，MVP 先接受；你后续可以排除数字小数点）
  counts.period = (text.match(/[。\.]/g) ?? []).length;
  // 问号感叹号
  counts.question = (text.match(/[？?]/g) ?? []).length;
  counts.exclamation = (text.match(/[！!]/g) ?? []).length;
  // 省略号：中文“……”或英文“...”
  counts.ellipsis = (text.match(/……/g) ?? []).length + (text.match(/\.{3,}/g) ?? []).length;
  // 破折号：中文“——”或英文“-”连续（这里把单个 - 也算一点停顿）
  counts.dash = (text.match(/——/g) ?? []).length + (text.match(/-/g) ?? []).length;
  // 冒号、分号
  counts.colon = (text.match(/[：:]/g) ?? []).length;
  counts.semicolon = (text.match(/[；;]/g) ?? []).length;

  const pauseTime =
    counts.comma * p.pauses.comma +
    counts.period * p.pauses.period +
    counts.question * p.pauses.question +
    counts.exclamation * p.pauses.exclamation +
    counts.ellipsis * p.pauses.ellipsis +
    counts.dash * p.pauses.dash +
    counts.colon * p.pauses.colon +
    counts.semicolon * p.pauses.semicolon;

  return { pauseTime, counts };
}

/**
 * 估算一段文本的“建议最短口播时长”。
 */
export function estimateSpeech(textRaw: string, params: SpeechModelParams = DEFAULT_SPEECH_PARAMS): SpeechEstimate {
  const text = (textRaw ?? "").trim();
  const visible = text.replace(/\s+/g, "");
  const visibleChars = visible.length;

  // 基础发声时间：按 baseCps 换算
  const baseTime = visibleChars / Math.max(0.000_001, params.baseCps);

  // 标点停顿
  const { pauseTime, counts } = calcPauseTime(text, params);

  // 数字与英文额外惩罚
  const latinCount = (visible.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (visible.match(/[0-9]/g) ?? []).length;
  const latinExtra = latinCount * params.latinExtraPerChar;
  const digitExtra = digitCount * params.digitExtraPerChar;

  const minDuration = Math.max(params.minDuration, baseTime + pauseTime + latinExtra + digitExtra);

  return {
    minDuration,
    breakdown: {
      visibleChars,
      baseTime,
      pauseTime,
      latinExtra,
      digitExtra,
      punctuationCounts: counts
    }
  };
}

/**
 * 按标点拆分台词（用于生成多个 clip）。
 *
 * 设计目标：
 * - 拆分后的每段尽量自然（保留标点在段尾）
 * - 不把括号/引号等复杂语法考虑进来（MVP 先够用）
 */
export function splitByPunctuation(textRaw: string): string[] {
  const text = (textRaw ?? "").trim();
  if (!text) return [];

  // 用“句子终止符 + 逗号 + 破折号 + 分号”作为切分点
  // 注意：这里会把标点保留在片段里（通过捕获组实现）。
  const parts: string[] = [];
  const re = /([^，,。\.？?！!；;：:—\-…]*)([，,。\.？?！!；;：:—\-…]+)?/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = (m[1] ?? "").trim();
    const punc = (m[2] ?? "").trim();
    const seg = `${body}${punc}`.trim();
    if (seg) parts.push(seg);
    if (re.lastIndex >= text.length) break;
  }

  // 再做一次清洗：去掉空片段
  return parts.map((s) => s.trim()).filter(Boolean);
}

