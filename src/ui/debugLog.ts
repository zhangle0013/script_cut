/**
 * 可选调试日志（纯前端，无「后台服务」）
 *
 * 启用方式（任选其一）：
 * - 地址栏加参数 `?debug=1`（会自动写入 localStorage，刷新后仍生效）
 * - 在控制台执行：`localStorage.setItem('scriptcut-debug','1')` 后刷新
 *
 * 关闭：`localStorage.removeItem('scriptcut-debug')` 后刷新
 *
 * 日志会 `console.log` 输出，并在内存中保留最近若干条，便于复制排查：
 * `(window as any).__SCRIPT_CUT_DEBUG__.exportLogs()`
 */

const STORAGE_KEY = "scriptcut-debug";
const RING_MAX = 300;
const ring: string[] = [];

let enabled = false;

function pushRing(level: string, args: unknown[]): void {
  const msg = args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  ring.push(line);
  if (ring.length > RING_MAX) ring.shift();
}

/** 在应用入口最早调用一次，解析 URL 并读 localStorage */
export function initDebugLogFromUrl(): void {
  try {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("debug")) {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    enabled = localStorage.getItem(STORAGE_KEY) === "1";
    if (enabled) {
      const w = window as unknown as {
        __SCRIPT_CUT_DEBUG__?: { ring: string[]; exportLogs: () => string };
      };
      w.__SCRIPT_CUT_DEBUG__ = {
        ring,
        exportLogs: () => ring.join("\n")
      };
      console.info("[ScriptCut] 调试日志已开启；关闭请移除 localStorage scriptcut-debug");
    }
  } catch {
    /* 存储不可用等 */
  }
}

/** 是否已开启调试（仅初始化时读取；改 localStorage 需刷新） */
export function isDebugLogEnabled(): boolean {
  return enabled;
}

/** 调试信息（生产环境默认无输出到 ring，除非已启用） */
export function debugLog(...args: unknown[]): void {
  if (!enabled) return;
  pushRing("log", args);
  console.log("[ScriptCut]", ...args);
}

/** 警告：始终 console.warn；启用调试时写入 ring */
export function debugWarn(...args: unknown[]): void {
  if (enabled) pushRing("warn", args);
  console.warn("[ScriptCut]", ...args);
}
