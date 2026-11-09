// Assign 보낼 곳 - 우선순위 순서로 한 단계씩 펼치는 아코디언(① 추천 ② 가까운 곳 ③ 전체 ④ 삭제·외부 이동). 내용은 화면이 만든다.
"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface AccordionSection {
  key: string;
  title: string;
  count?: number;
  body: ReactNode;
}

export function DestinationAccordion({ sections, open, onToggle }: { sections: AccordionSection[]; open: ReadonlySet<string>; onToggle: (key: string) => void }) {
  return (
    <div className="dest-acc">
      {sections.map((section) => {
        const isOpen = open.has(section.key);
        return (
          <div key={section.key} className="dest-acc-item">
            <button type="button" className="dest-acc-head" aria-expanded={isOpen} data-testid={`assign-acc-${section.key}`} onClick={() => onToggle(section.key)}>
              {section.title}
              {section.count !== undefined && <span className="dest-acc-count">{section.count}</span>}
              <ChevronRight size={14} strokeWidth={1.6} className="dest-acc-chev" aria-hidden />
            </button>
            {isOpen && <div className="dest-acc-body">{section.body}</div>}
          </div>
        );
      })}
    </div>
  );
}
