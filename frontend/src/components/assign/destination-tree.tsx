// ③ 전체 - 이미 쓴 문서(문서 → 절 → 문장)와 아직 안 쓴 문서(문서 → 칸·단계)를 한 단계씩 펼친다. N/A 칸은 보이되 고를 수 없다.
"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { WrittenSentence } from "@/lib/api-sop";
import type { Destination, DestinationOption } from "@/lib/classify-model";
import { useI18n } from "@/lib/i18n";

interface DestinationTreeProps {
  written: WrittenSentence[];
  options: DestinationOption[];
  /** 보낼 곳이 하나도 없을 때 안내가 가리키는 To-Be 화면 */
  tobeHref: string;
  onPickLink: (targetId: number, additive: boolean) => void;
  onPickPlace: (destination: Destination) => void;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups.entries()];
}

export function DestinationTree({ written, options, tobeHref, onPickLink, onPickPlace }: DestinationTreeProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((prev) => (prev.has(key) ? new Set([...prev].filter((item) => item !== key)) : new Set([...prev, key])));

  function renderNode(key: string, label: string, sub: string) {
    return (
      <button type="button" className="tree-node" aria-expanded={open.has(key)} data-testid={`assign-tree-${key}`} onClick={() => toggle(key)}>
        <ChevronRight size={13} strokeWidth={1.6} className="tree-chev" aria-hidden />
        <b>{label}</b>
        <span className="tree-sub">{sub}</span>
      </button>
    );
  }

  const writtenDocs = groupBy(
    written.filter((row) => row.kind === "sentence"),
    (row) => String(row.target_doc_id),
  );
  const placeDocs = groupBy(options, (option) => option.docCode);
  if (writtenDocs.length === 0 && placeDocs.length === 0) {
    return (
      <div className="grid gap-1.5 px-3 py-4 text-[13px] leading-5 text-ink-2" data-testid="assign-tree-empty">
        <p>{t("assign.tree.empty")}</p>
        <Link href={tobeHref} className="text-link" data-testid="assign-tree-open-tobe">
          {t("assign.openTobe")}
        </Link>
      </div>
    );
  }
  return (
    <div className="dest-tree">
      {writtenDocs.length > 0 && <p className="tree-group">{t("assign.tree.written")}</p>}
      {writtenDocs.map(([docId, rows]) => (
        <div key={docId}>
          {renderNode(`w${docId}`, rows[0].doc_code, t("assign.tree.count", { n: rows.length }))}
          {open.has(`w${docId}`) && (
            <div className="tree-kids">
              {groupBy(rows, (row) => row.section_path).map(([section, items]) => (
                <div key={section || "-"}>
                  {section && <p className="tree-section">{section}</p>}
                  {items.map((row) => (
                    <button key={row.target_id} type="button" className="tree-leaf" data-testid={`assign-tree-sentence-${row.target_id}`} onClick={(event) => onPickLink(row.target_id, event.ctrlKey || event.metaKey)}>
                      <span className={`ptag ${row.lang}`}>{row.lang.toUpperCase()}</span>
                      {row.text}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {placeDocs.length > 0 && <p className="tree-group">{t("assign.tree.unwritten")}</p>}
      {placeDocs.map(([code, items]) => (
        <div key={code}>
          {renderNode(`p${code}`, code, t("assign.tree.count", { n: items.length }))}
          {open.has(`p${code}`) && (
            <div className="tree-kids">
              {items.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="tree-leaf"
                  disabled={option.disabled}
                  style={{ paddingLeft: 8 + option.depth * 14 }}
                  data-testid={`assign-tree-place-${option.id}`}
                  onClick={() => onPickPlace(option.destination)}
                >
                  {option.label}
                  {option.disabled && <span className="tree-sub"> · N/A</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
