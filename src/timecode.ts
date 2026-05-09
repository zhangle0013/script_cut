/**
 * 时间码解析工具。
 *
 * 你的脚本里主要有两种时间写法：
 * - Shot: 0:04-0:05.5
 * - Seedance对白: [0:05.5-0:08]
 *
 * 目标：
 * - 将它们统一解析为秒数（number）
 * - 保留一定的容错（空格、方括号）
 *
 * 注意：
 * - MVP 阶段只支持 mm:ss(.ms?) 或 m:ss(.ms?) 形式，不支持 hh:mm:ss。
 * - 小数点后按秒的小数处理（例如 0:05.5 = 5.5 秒）。
 */

/**
 * 将形如 "0:05.5" 或 "12:34" 的时间码转换为秒。
 */
export function parseTimeToSeconds(raw: string): number {
  const s = raw.trim();
  const m = s.match(/^(\d+)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) {
    throw new Error(`无法解析时间码: "${raw}"`);
  }
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    throw new Error(`时间码含非数字: "${raw}"`);
  }
  return minutes * 60 + seconds;
}

/**
 * 解析范围时间码，例如：
 * - "0:04-0:05.5"
 * - "[0:05.5-0:08]"
 */
export function parseRangeToSeconds(rawRange: string): { start: number; end: number } {
  const cleaned = rawRange.trim().replace(/^\[/, "").replace(/\]$/, "");
  const parts = cleaned.split("-");
  if (parts.length !== 2) {
    throw new Error(`无法解析时间范围: "${rawRange}"`);
  }
  const start = parseTimeToSeconds(parts[0]);
  const end = parseTimeToSeconds(parts[1]);
  if (end < start) {
    throw new Error(`时间范围结束小于开始: "${rawRange}"`);
  }
  return { start, end };
}

/**
 * 将秒数格式化为 "m:ss.mmm"（主要用于报告输出）。
 */
export function formatSeconds(t: number): string {
  const minutes = Math.floor(t / 60);
  const seconds = t - minutes * 60;
  // 统一保留 3 位小数，便于对齐与排查；UI 层可做更美观的格式化。
  const secStr = seconds.toFixed(3).padStart(6, "0"); // e.g. "05.500"
  return `${minutes}:${secStr}`;
}

