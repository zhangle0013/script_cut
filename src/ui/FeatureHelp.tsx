import React from "react";

export interface FeatureHelpProps {
  /** 是否与「帮助模式」开关联动：为 false 时不渲染 */
  show: boolean;
  /** 来自 i18n 的 t("helpHint…") 文案 */
  text: string;
}

/**
 * 分散式帮助：紧挨某个功能块出现的一小段说明（非弹窗、非整页文档）
 *
 * - 使用 role="note" 便于读屏识别为补充说明；
 * - 样式由全局 .featureHelp 控制，与主界面区分但不抢眼。
 */
export function FeatureHelp({ show, text }: FeatureHelpProps) {
  if (!show || !text) return null;
  return (
    <div className="featureHelp" role="note">
      {text}
    </div>
  );
}
