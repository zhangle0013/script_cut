/**
 * 侧栏宽度与左侧折叠区块的 localStorage 持久化，
 * 刷新后保持用户自定义布局。
 */

const LAYOUT_KEY = "scriptcut.layout.v1";
const SIDEBAR_SECTIONS_KEY = "scriptcut.sidebar.sections.v1";

export type LayoutWidths = { left: number; right: number };

export const DEFAULT_LAYOUT_WIDTHS: LayoutWidths = { left: 288, right: 320 };

const LEFT_MIN = 220;
const LEFT_MAX = 440;
const RIGHT_MIN = 240;
const RIGHT_MAX = 560;

/** 读取三栏左右宽度（像素），异常或缺失时用默认值并夹在合理区间 */
export function readLayoutWidths(): LayoutWidths {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT_WIDTHS };
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return { ...DEFAULT_LAYOUT_WIDTHS };
    const left = Math.round(Number((p as LayoutWidths).left));
    const right = Math.round(Number((p as LayoutWidths).right));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return { ...DEFAULT_LAYOUT_WIDTHS };
    return {
      left: Math.max(LEFT_MIN, Math.min(LEFT_MAX, left)),
      right: Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, right))
    };
  } catch {
    return { ...DEFAULT_LAYOUT_WIDTHS };
  }
}

export function writeLayoutWidths(w: LayoutWidths): void {
  try {
    const left = Math.max(LEFT_MIN, Math.min(LEFT_MAX, Math.round(w.left)));
    const right = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, Math.round(w.right)));
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left, right }));
  } catch {
    /* ignore quota / private mode */
  }
}

/** 某折叠区块是否展开；无记录时返回 defaultOpen */
export function readSidebarSectionOpen(key: string, defaultOpen: boolean): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
    if (!raw) return defaultOpen;
    const o = JSON.parse(raw) as Record<string, boolean>;
    if (o && typeof o[key] === "boolean") return o[key]!;
    return defaultOpen;
  } catch {
    return defaultOpen;
  }
}

export function writeSidebarSectionOpen(key: string, open: boolean): void {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
    const o = (raw ? (JSON.parse(raw) as Record<string, boolean>) : {}) ?? {};
    o[key] = open;
    localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
