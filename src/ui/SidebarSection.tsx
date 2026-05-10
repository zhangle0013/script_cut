import React, { useState } from "react";
import { readSidebarSectionOpen, writeSidebarSectionOpen } from "./persistedLayout.js";

export interface SidebarSectionProps {
  /** localStorage 键后缀，须唯一 */
  sectionKey: string;
  /** 无存档时的默认是否展开 */
  defaultOpen: boolean;
  /** 可点击的标题（已含步骤文案） */
  title: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 左栏可折叠卡片：减少一屏信息密度，展开状态写入 localStorage。
 */
export function SidebarSection({ sectionKey, defaultOpen, title, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(() => readSidebarSectionOpen(sectionKey, defaultOpen));

  return (
    <div className="card sidebarSection">
      <button
        type="button"
        className="sidebarSectionHeader"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            writeSidebarSectionOpen(sectionKey, next);
            return next;
          });
        }}
      >
        <span className="sidebarSectionChevron" aria-hidden>
          {open ? "▼" : "▶"}
        </span>
        <span className="sidebarSectionTitle">{title}</span>
      </button>
      {open ? <div className="sidebarSectionBody">{children}</div> : null}
    </div>
  );
}
