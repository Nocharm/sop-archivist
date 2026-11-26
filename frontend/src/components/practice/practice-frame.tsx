// 연습 화면의 틀(설계 2026-11-26-practice-page D14) - 왼쪽은 실제 Assign(연습 Bundle -1), 오른쪽은 과제 칸. 과제 칸의 접힘은 이 화면 한 번의 일이라 useState 하나(기억하지 않는다).
// 이 스텝의 과제 칸은 머리와 접기뿐이다(과제 목록은 다음 스텝).
"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

export function PracticeFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [folded, setFolded] = useState(false);
  const foldLabel = folded ? t("practice.tasksUnfold") : t("practice.tasksFold");
  return (
    <div className="practice-grid" data-folded={folded ? "" : undefined}>
      <div className="practice-main">{children}</div>
      <aside className="practice-tasks" data-testid="practice-tasks" data-folded={folded ? "" : undefined} aria-label={t("practice.tasks")}>
        <div className="practice-tasks-head">
          {!folded && <h2 className="practice-tasks-title">{t("practice.tasks")}</h2>}
          <Tooltip label={foldLabel} align="end">
            <button type="button" className="btn ghost icon" data-testid="practice-tasks-fold" aria-label={foldLabel} aria-expanded={!folded} onClick={() => setFolded((value) => !value)}>
              {folded ? <ChevronsLeft size={14} strokeWidth={1.5} aria-hidden /> : <ChevronsRight size={14} strokeWidth={1.5} aria-hidden />}
            </button>
          </Tooltip>
        </div>
      </aside>
    </div>
  );
}
