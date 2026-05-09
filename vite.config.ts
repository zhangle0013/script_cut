import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite 配置（MVP）
 *
 * 目标：
 * - 本地快速起一个 UI，加载/编辑 out.json
 * - 不引入复杂构建约束
 */
export default defineConfig({
  plugins: [react()]
});

