// 설명서 왼쪽 칸 - 제목·찾기·읽은 양·목차·단축키. 목차 줄은 조각의 읽음 상태를 같이 보이고, 지금 조각 아래에만 작은 제목이 펼쳐진다.
"use client";

import { FileText, Search, X } from "lucide-react";
import { Fragment, useEffect, useRef, type MouseEvent, type RefObject } from "react";

import { ReadStateIcon } from "@/components/manual/read-state";
import { Collapse } from "@/components/ui/motion";
import { useI18n } from "@/lib/i18n";
import { getReadState, MANUAL_LANG, MANUAL_SOURCE_URL, type ManualDoc, type ManualSection, type ReadMarks } from "@/lib/manual";

interface ManualTocProps {
  doc: ManualDoc;
  /** 찾기에 남은 조각 - 목차는 이것만 보인다 */
  visible: ManualSection[];
  marks: ReadMarks;
  currentId: string | null;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  /** 조각이나 작은 제목의 자리로 간다 */
  onOpen: (id: string) => void;
}

// 글쇠 표시는 어느 화면 언어에서나 같다
const KEY_ROWS = [
  { keys: ["J", "K"], label: "manual.key.move" },
  { keys: ["↵"], label: "manual.markRead" },
  { keys: ["U"], label: "manual.unmark" },
  { keys: ["/"], label: "manual.key.find" },
] as const;

export function ManualToc({ doc, visible, marks, currentId, query, searchRef, onQueryChange, onOpen }: ManualTocProps) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const done = doc.sections.filter((section) => getReadState(section, marks) === "read").length;

  // 글을 내려 읽는 동안 지금 조각의 줄이 목차 밖으로 나가지 않게 한다
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  function handleOpen(event: MouseEvent<HTMLAnchorElement>, id: string) {
    // 새 탭·새 창으로 여는 클릭은 브라우저에 맡긴다
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id);
  }

  return (
    <aside className="manual-side" data-testid="manual-side">
      <div className="manual-side-head">
        <div>
          <h1 className="page-title" lang={MANUAL_LANG}>
            <span className="ul">{doc.title}</span>
          </h1>
          <p className="manual-meta" data-testid="manual-meta">
            v{doc.version} · {doc.updated}
          </p>
        </div>
        <label className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-line-2 bg-surface px-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
          <input
            ref={searchRef}
            type="text"
            className="manual-search-input min-w-0 flex-1 bg-transparent text-[13px]"
            placeholder={t("manual.search")}
            aria-label={t("manual.search")}
            value={query}
            data-testid="manual-search"
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query !== "" && (
            <button
              type="button"
              className="manual-search-clear"
              aria-label={t("manual.searchClear")}
              data-testid="manual-search-clear"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </label>
        <div className="manual-progress">
          <span data-testid="manual-progress">{t("manual.progress", { done, total: doc.sections.length })}</span>
          {/* 조각마다 한 칸 - 읽지 않은 칸은 점선, 읽은 칸은 잉크. 숫자는 위 글이 말한다 */}
          <span className="manual-ticks" aria-hidden>
            {doc.sections.map((section) => (
              <span key={section.id} className="manual-tick" data-state={getReadState(section, marks)} />
            ))}
          </span>
        </div>
      </div>

      <nav ref={navRef} className="manual-toc" aria-label={t("manual.toc")} data-testid="manual-toc">
        {visible.map((section) => {
          const current = section.id === currentId;
          return (
            <Fragment key={section.id}>
              <a
                href={`#${section.id}`}
                className="manual-toc-item"
                aria-current={current ? "true" : undefined}
                data-state={getReadState(section, marks)}
                data-testid={`manual-toc-${section.id}`}
                onClick={(event) => handleOpen(event, section.id)}
              >
                <span className="manual-toc-tag">{section.tag}</span>
                <span lang={MANUAL_LANG}>{section.title}</span>
                <ReadStateIcon state={getReadState(section, marks)} />
              </a>
              <Collapse open={current && section.headings.length > 0}>
                <div className="manual-toc-subs" lang={MANUAL_LANG}>
                  {section.headings.map((heading) => (
                    <a key={heading.id} href={`#${heading.id}`} className="manual-toc-sub" data-testid={`manual-toc-sub-${heading.id}`} onClick={(event) => handleOpen(event, heading.id)}>
                      {heading.title}
                    </a>
                  ))}
                </div>
              </Collapse>
            </Fragment>
          );
        })}
      </nav>

      <div className="manual-side-foot">
        <dl className="manual-keys" aria-label={t("manual.keys")} data-testid="manual-keys">
          {KEY_ROWS.map((row) => (
            <div key={row.label}>
              <dt>
                {row.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{t(row.label)}</dd>
            </div>
          ))}
        </dl>
        <a href={MANUAL_SOURCE_URL} target="_blank" rel="noreferrer" className="manual-source" data-testid="manual-source">
          <FileText size={14} strokeWidth={1.5} aria-hidden />
          {t("manual.source")}
        </a>
      </div>
    </aside>
  );
}
