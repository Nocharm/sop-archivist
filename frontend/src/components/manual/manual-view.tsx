// 설명서 화면 - 왼쪽에 목차·찾기·읽은 양, 오른쪽 책상에 조각(종이)들. 읽지 않은 조각은 점선(연필), 읽음 표시를 하면 실선(잉크)이 된다.
// 글은 Markdown 한 벌(public/manual/user-manual.md)이고 이 화면은 나눠 보이기만 한다. 읽음 표시는 이 브라우저에만 남는다(lib/manual-read.ts).
"use client";

import { SearchX } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { ManualToc } from "@/components/manual/manual-toc";
import { ManualUnit } from "@/components/manual/manual-unit";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkdownView, type MarkdownImageSize } from "@/components/ui/markdown-view";
import { useI18n } from "@/lib/i18n";
import { findSections, getReadState, MANUAL_LANG, parseManual } from "@/lib/manual";
import { getManualKeyAction } from "@/lib/manual-keys";
import { setManualMark, useManualMarks } from "@/lib/manual-read";
import { BUTTON_SECONDARY } from "@/lib/ui-classes";

interface ManualViewProps {
  source: string;
  imageSizes: Record<string, MarkdownImageSize>;
}

/** 책상 위에서 이 높이(px) 안에 머리가 들어온 조각을 지금 조각으로 본다 - 붙는 머리(44px)의 두 배쯤 */
const SPY_LINE = 96;
/** 글쇠·목차로 옮긴 직후의 스크롤이 지금 조각을 다시 고르지 않게 막는 시간(ms). 짧으면 끝의 짧은 조각으로 못 간다 */
const SPY_LOCK_MS = 200;

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

// 지금 조각 = 머리가 기준선을 지난 마지막 조각. 끝까지 내리면 맨 아래 조각이다(짧아서 기준선에 닿지 못한다)
function findSpyTarget(desk: HTMLElement): string | null {
  const units = desk.querySelectorAll<HTMLElement>(".manual-unit");
  if (units.length === 0) return null;
  if (desk.scrollTop + desk.clientHeight >= desk.scrollHeight - 2) return units[units.length - 1].id;
  const line = desk.getBoundingClientRect().top + SPY_LINE;
  let found = units[0].id;
  for (const unit of units) {
    if (unit.getBoundingClientRect().top > line) break;
    found = unit.id;
  }
  return found;
}

export function ManualView({ source, imageSizes }: ManualViewProps) {
  const { t, lang } = useI18n();
  const doc = useMemo(() => parseManual(source), [source]);
  const marks = useManualMarks();
  const [query, setQuery] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const visible = useMemo(() => findSections(doc.sections, query), [doc.sections, query]);
  // 찾기가 지금 조각을 걸러 내면 남은 첫 조각이 지금 조각이다
  const current = visible.find((section) => section.id === currentId) ?? visible[0] ?? null;
  const searching = query.trim() !== "";

  const deskRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** 조각이 다시 그려진 뒤에 갈 자리 - 찾기를 지운 직후에는 아직 화면에 없다 */
  const pendingRef = useRef<string | null>(null);
  const spyLockRef = useRef(0);
  const spyFrameRef = useRef(0);

  function scrollToTarget(id: string) {
    // 앱 틀의 다른 id와 섞이지 않게 책상 안에서만 찾는다
    const target = deskRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    spyLockRef.current = performance.now() + SPY_LOCK_MS;
    target.scrollIntoView({ block: "start" });
  }

  /** 조각이나 작은 제목(###)의 자리로 간다 - 목차·본문 안 링크·주소의 #자리가 모두 이 길로 온다 */
  function openTarget(id: string) {
    const section = doc.sections.find((item) => item.id === id || item.headings.some((heading) => heading.id === id));
    if (!section) return;
    setCurrentId(section.id);
    if (visible.includes(section)) {
      scrollToTarget(id);
      return;
    }
    // 찾기에 걸러진 조각 - 찾기를 지우고, 그려진 뒤에 간다
    pendingRef.current = id;
    setQuery("");
  }

  function changeQuery(next: string) {
    setQuery(next);
    if (next.trim() !== "") {
      // 찾는 동안에는 남은 첫 조각부터 본다. 남은 것이 없으면 보던 조각을 기억해 둔다
      setCurrentId(findSections(doc.sections, next)[0]?.id ?? currentId);
      if (deskRef.current) deskRef.current.scrollTop = 0;
      return;
    }
    // 찾기를 지우면 보던 조각에 그대로 머문다
    const keep = current?.id ?? currentId;
    if (keep === null) return;
    setCurrentId(keep);
    pendingRef.current = keep;
  }

  function moveCurrent(delta: 1 | -1) {
    const next = visible[(current ? visible.indexOf(current) : -1) + delta];
    if (next) {
      setCurrentId(next.id);
      scrollToTarget(next.id);
    } else if (delta === -1 && deskRef.current) {
      // 첫 조각에서 더 올라가면 머리말
      deskRef.current.scrollTop = 0;
    }
  }

  function handleDeskScroll() {
    if (spyFrameRef.current !== 0) return;
    spyFrameRef.current = requestAnimationFrame(() => {
      spyFrameRef.current = 0;
      const desk = deskRef.current;
      if (!desk || performance.now() < spyLockRef.current) return;
      const id = findSpyTarget(desk);
      if (id !== null) setCurrentId(id);
    });
  }

  const flushPending = useEffectEvent(() => {
    const id = pendingRef.current;
    if (id === null) return;
    pendingRef.current = null;
    scrollToTarget(id);
  });

  useEffect(() => {
    flushPending();
  }, [visible]);

  const handleHash = useEffectEvent(() => {
    const id = window.location.hash.slice(1);
    if (id) openTarget(id);
  });

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const action = getManualKeyAction(event, {
      typing: isTypingTarget(event.target),
      onControl: event.target instanceof HTMLElement && event.target.closest("button, a, [role='option']") !== null,
      layerOpen: document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]') !== null,
      hasQuery: query !== "",
      state: current ? getReadState(current, marks) : null,
    });
    if (action === null) return;
    event.preventDefault();
    if (action === "next" || action === "prev") moveCurrent(action === "next" ? 1 : -1);
    else if (action === "find") {
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (action === "escape") {
      if (query !== "") changeQuery("");
      deskRef.current?.focus({ preventScroll: true });
    } else if (!current) return;
    else if (action === "mark") setManualMark(current.id, current.hash);
    else setManualMark(current.id, null);
  });

  useEffect(() => {
    // 책상에 포커스를 두어 ↑↓·Space·PgDn이 바로 글을 내린다
    deskRef.current?.focus({ preventScroll: true });
    // 본문은 로그인 확인 뒤에 그려져 브라우저가 주소의 #자리로 가지 못한다 - 그려진 다음 프레임에 간다
    const frame = requestAnimationFrame(handleHash);
    window.addEventListener("hashchange", handleHash);
    window.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", handleHash);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <div className="manual" data-testid="manual">
      <ManualToc
        doc={doc}
        visible={visible}
        marks={marks}
        currentId={current?.id ?? null}
        query={query}
        searchRef={searchRef}
        onQueryChange={changeQuery}
        onOpen={(id) => {
          openTarget(id);
          // 주소에 자리를 남겨 그대로 건넬 수 있게 한다(뒤로 가기 기록은 쌓지 않는다)
          window.history.replaceState(null, "", `#${id}`);
        }}
      />
      <div ref={deskRef} className="desk manual-desk" tabIndex={-1} data-testid="manual-desk" onScroll={handleDeskScroll}>
        {lang === "en" && (
          <p className="manual-note" data-testid="manual-korean-only">
            {t("manual.koreanOnly")}
          </p>
        )}
        {!searching && doc.lead !== "" && <MarkdownView source={doc.lead} className="manual-lead" lang={MANUAL_LANG} testId="manual-lead" />}
        {visible.map((section) => (
          <ManualUnit
            key={section.id}
            section={section}
            state={getReadState(section, marks)}
            current={section.id === current?.id}
            imageSizes={imageSizes}
            onMark={() => setManualMark(section.id, section.hash)}
            onUnmark={() => setManualMark(section.id, null)}
          />
        ))}
        {visible.length === 0 && (
          <EmptyState
            icon={SearchX}
            title={t("manual.noMatch")}
            body={t("manual.noMatchBody")}
            testId="manual-empty"
            action={
              <button
                type="button"
                className={BUTTON_SECONDARY}
                data-testid="manual-empty-clear"
                onClick={() => {
                  changeQuery("");
                  searchRef.current?.focus();
                }}
              >
                {t("manual.searchClear")}
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
