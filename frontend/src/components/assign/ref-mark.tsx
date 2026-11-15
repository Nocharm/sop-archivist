// New 원문의 참조 줄에 붙는 작은 표시 - 번호나 이름이 EQUIS와 다르거나, EQUIS가 모르는 번호이거나, 폐기된 문서일 때만 뜬다.
// 이미 쓴 문서의 글은 이 화면에서 고치지 않아 알리기만 한다: 누르면 그 번호의 EQUIS 정보(지금 번호·정식 이름)가 펼쳐지고 고치는 단추는 없다.
// 문제없는 줄과 조회 중인 줄에는 아무것도 그리지 않는다(lib/ref-model readWrittenRefMark).
"use client";

import { Ban, CircleDashed, TriangleAlert, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";

import { EquisPopover } from "@/components/equis/equis-status";
import type { WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { readWrittenRefMark, type WrittenRefMark } from "@/lib/ref-model";

// 경고색은 한 번 볼 줄(어긋남·폐기), 회색은 EQUIS에 없음·조회 실패 - 새로 만드는 문서를 가리키는 줄은 EQUIS에 없는 것이 정상이다
const MARKS: Record<WrittenRefMark, { label: string; icon: LucideIcon; tone: "is-warn" | "is-note" }> = {
  number: { label: "assign.ref.adviceNumber", icon: TriangleAlert, tone: "is-warn" },
  title: { label: "assign.ref.adviceTitle", icon: TriangleAlert, tone: "is-warn" },
  retired: { label: "assign.ref.adviceRetired", icon: TriangleAlert, tone: "is-warn" },
  not_found: { label: "assign.ref.adviceNotFound", icon: CircleDashed, tone: "is-note" },
  failed: { label: "assign.ref.adviceFailed", icon: Ban, tone: "is-note" },
};

export function RefMark({ row }: { row: WrittenSentence }) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const mark = readWrittenRefMark(row);
  if (mark === null) return null;
  const { label, icon: Icon, tone } = MARKS[mark];
  const equis = row.ref?.equis ?? null;
  const testId = `assign-new-ref-issue-${row.target_id}`;
  const body = (
    <>
      <Icon size={10} strokeWidth={2.25} className="mr-0.5 inline-block align-[-1px]" aria-hidden />
      {t(label)}
    </>
  );
  if (equis === null) {
    return (
      <span className={`new-src ${tone}`} data-kind={mark} data-testid={testId}>
        {body}
      </span>
    );
  }
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`new-src ${tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-kind={mark}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
      >
        {body}
      </button>
      {/* 참조 번호는 Bundle의 문서 번호가 아니라 다시 조회·번호 바꾸기가 없다 */}
      {open && <EquisPopover equis={equis} anchorRef={anchorRef} testId={testId} canEdit={false} onClose={() => setOpen(false)} />}
    </>
  );
}
