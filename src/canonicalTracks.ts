import type { Track, TrackType } from "./types.js";

/**
 * 工程 `tracks[]` 的规范定义：解析 Markdown、补全旧 JSON、与 UI 轨顺序约定共用。
 *
 * - `environment`：故事发生的场景/空间/时段/氛围等（与「信息/参考」和「画面段落」区分）
 * - 若旧工程缺少某类型，读入时通过 `mergeMissingTracks` 追加默认条目，避免 UI 与类型不完整
 */
export function buildCanonicalTracks(): Track[] {
  return [
    { id: "trk_info", type: "info", name: "信息/参考" },
    { id: "trk_environment", type: "environment", name: "环境/场景" },
    { id: "trk_visual", type: "visual", name: "画面段落" },
    { id: "trk_dialogue", type: "dialogue", name: "对白" },
    { id: "trk_narration", type: "narration", name: "旁白" },
    { id: "trk_action", type: "action", name: "动作/节拍" },
    { id: "trk_sfx", type: "sfx", name: "音效" },
    { id: "trk_subtitle", type: "subtitle", name: "字幕" }
  ];
}

/**
 * 为缺少的 `TrackType` 追加默认轨道，保留已有 `id`（避免已有 clip 的 `trackId` 失效）。
 */
export function mergeMissingTracks(existing: Track[]): Track[] {
  const byType = new Map<TrackType, Track>();
  for (const t of existing) {
    byType.set(t.type, t);
  }
  const out = [...existing];
  for (const def of buildCanonicalTracks()) {
    if (!byType.has(def.type)) {
      out.push({ id: def.id, type: def.type, name: def.name });
      byType.set(def.type, def);
    }
  }
  return out;
}
