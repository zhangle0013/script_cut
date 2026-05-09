import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  type Locale,
  createTranslator,
  readStoredLocale,
  writeStoredLocale,
  type MessageKey,
} from "./i18n.js";

/**
 * React 上下文：向整棵组件树提供当前语言与 t()。
 * 切换语言时写入 localStorage，刷新页面后保持用户选择。
 */

export type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window !== "undefined" ? readStoredLocale() : "zh"
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  /** 同步 <html lang>，利于无障碍与翻译插件识别页面语言 */
  useEffect(() => {
    try {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    } catch {
      /* ignore */
    }
  }, [locale]);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 必须在 I18nProvider 内使用 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
