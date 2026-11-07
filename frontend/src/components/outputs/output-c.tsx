// 결과물 C - 새 문서를 칸·단계 순서로 미리 본다. 결과물 화면과 검토 화면이 같이 쓴다. 확정 전 새 문장은 점선.
"use client";

import type { OutputC, OutputCItem, OutputLang } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

function CItemView({ item }: { item: OutputCItem }) {
  if (item.kind === "table") {
    const rows = new Map<number, OutputCItem[]>();
    for (const cell of item.children) rows.set(cell.cell_row ?? 0, [...(rows.get(cell.cell_row ?? 0) ?? []), cell]);
    return (
      <table className="ptbl my-1">
        <tbody>
          {[...rows.entries()].sort((a, b) => a[0] - b[0]).map(([index, cells]) => (
            <tr key={index}>
              {cells.sort((a, b) => (a.cell_col ?? 0) - (b.cell_col ?? 0)).map((cell) => (
                <td key={cell.target_id}>{cell.text}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <p className={`${item.status === "confirmed" ? "" : "rounded-sm border border-dashed border-line-2 px-1"}`} data-testid={`output-c-item-${item.target_id}`}>
      {item.kind === "figure" ? "[Figure]" : item.text || item.ai_text}
    </p>
  );
}

export function OutputCView({ data, lang }: { data: OutputC; lang: OutputLang }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-6 p-[var(--pad)]" data-testid="output-c">
      {data.docs.map((doc) => (
        <article key={doc.target_doc_id} className="sheet mx-0 max-w-[760px]">
          <div className="pg" lang={lang}>
            <header className="flex items-baseline gap-2 border-b border-line pb-2" style={{ fontFamily: "var(--font-ui)" }}>
              <span className="font-mono text-[13px] font-semibold">{doc.code}</span>
              <span className="font-semibold">{doc.title}</span>
              <span className="tag ml-auto">{doc.doc_type.toUpperCase()}</span>
            </header>
            {doc.sections.map((section) => (
              <section key={section.location_key} className="grid gap-1">
                <h3 className="text-[13px] font-semibold text-ink-2" style={{ fontFamily: "var(--font-ui)" }}>
                  {section.label}
                </h3>
                {section.na_reason !== null ? (
                  <p className="text-ink-3">N/A · {section.na_reason}</p>
                ) : section.items.length === 0 ? (
                  <p className="text-ink-4">–</p>
                ) : (
                  section.items.map((item) => <CItemView key={item.target_id} item={item} />)
                )}
              </section>
            ))}
          </div>
        </article>
      ))}
      {(data.deleted.length > 0 || data.moved.length > 0) && (
        <section className="grid max-w-[760px] gap-2">
          <h2 className="text-xs font-semibold text-ink-3">{t("outputs.deletedMoved")}</h2>
          <ul className="grid gap-1 text-[13px]">
            {data.deleted.map((item) => (
              <li key={`d${item.display_id}`} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                <span className="font-mono text-[11px] text-ink-3">{item.display_id}</span>
                <span>
                  <span className="text-ink-3 line-through decoration-[var(--danger-ink)]">{item.source_text}</span>
                  <span className="block text-xs text-ink-3">{item.reason}</span>
                </span>
              </li>
            ))}
            {data.moved.map((item) => (
              <li key={`m${item.display_id}`} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                <span className="font-mono text-[11px] text-ink-3">{item.display_id}</span>
                <span>
                  {item.source_text}
                  <span className="block text-xs text-ink-3">
                    → <span className="font-mono">{item.move_target_code}</span> · {item.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
