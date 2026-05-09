import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App.js";
import { initDebugLogFromUrl } from "./ui/debugLog.js";
import { I18nProvider } from "./ui/I18nProvider.js";
import "./ui/styles.css";

/** 解析 ?debug=1 等，便于用户自行打开控制台排查交互/数据问题 */
initDebugLogFromUrl();

/**
 * UI 入口
 * - React 19 + Vite
 * - I18nProvider 包裹应用，提供界面语言与 t() 文案函数
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);

