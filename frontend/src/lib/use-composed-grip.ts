// Assign 빈 템플릿(엮은 New 문서) 기본 보기의 손잡이 끌기(시안 2 D6) - 고른 박스 왼쪽 손잡이(data-drag-handle)로 줄을 칸 안에서 옮기거나 다른 칸으로 보낸다.
// 규칙은 Order 화면과 같은 c-drop-model(덩어리 · 놓을 칸 · 자리 · 깊이 · 들어갈 수 있는지), 모양은 시안 1 끌기(흐린 원래 박스 · 한 줄 카드 · 점 달린 선, 빈 칸은 자리 박스 테두리).
// New 칸이 그리는 것을 읽기만 한다: 줄 상자 .new-item[data-csec][data-row], 칸 머리 줄 [data-csec][data-chead], 빈 칸 자리 .new-slot-empty[data-slot], 손잡이 [data-composed-grip].
"use client";

import type { RefObject } from "react";

import type { ComposedDoc, OutputCDoc } from "@/lib/api-sop";
import type { BoxDragConfig, DragHover, DragPoint } from "@/lib/box-drag";
import { previewEdit, type PlaceEdit } from "@/lib/c-edit-model";
import { findDragBlock, findDropSectionByKey, findEnterRefusal, findLeaveRefusal, findLiveBlock, listDropRows, planCrossDrop, planDrop, type DragBlock, type EnterRefusal, type LeaveRefusal, type RowBox } from "@/lib/c-drop-model";
import { readSectionHead, toOutputCDoc } from "@/lib/composed-model";
import { getSectionDepths } from "@/lib/section-number";
import { useBoxDrag } from "@/lib/use-box-drag";

type Section = OutputCDoc["sections"][number];

export interface ComposedGrip {
  /** 화면 문서(기다리는 편집을 얹은 것) */
  doc: ComposedDoc;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** 놓은 자리의 편집 - note는 저장 뒤 알림 글("→ 칸") */
  onPlace: (edit: PlaceEdit, note: string) => void;
}

interface GripSource {
  targetId: number;
  locationKey: string;
  blockIds: number[];
  text: string;
}

/** 지금 문서의 그 칸과 덩어리 - 누른 줄이나 덩어리 줄이 그때와 다르면 null(그 끌기는 놓지 않는다) */
function readLive(cdoc: OutputCDoc, source: GripSource): { section: Section; depths: number[]; block: DragBlock } | null {
  const section = cdoc.sections.find((item) => item.location_key === source.locationKey);
  if (!section) return null;
  const depths = getSectionDepths(section);
  const block = findLiveBlock(section.items, depths, source.targetId, source.blockIds, cdoc.entrance);
  return block && { section, depths, block };
}

function readRefusalKey(refusal: EnterRefusal | LeaveRefusal): string {
  if (refusal === "na") return "rule.na_slot";
  if (refusal === "notAssignable") return "rule.slot_not_assignable";
  if (refusal === "translation") return "order.drag.keepTranslation";
  if (refusal === "written") return "rule.slot_not_allowed";
  if (refusal === "otherPart") return "order.drag.otherPart";
  return "order.drag.otherDoc";
}

/** 그 칸의 그려진 줄 상자(화면 순서, 빠지는 줄 빼고) */
function listRowEls(sheet: HTMLElement, key: string): HTMLElement[] {
  return [...sheet.querySelectorAll<HTMLElement>(`.new-item[data-csec="${CSS.escape(key)}"][data-row^="t:"]:not([data-leave])`)];
}

function measureRows(els: readonly HTMLElement[]): RowBox[] {
  return els.map((el) => {
    const box = el.getBoundingClientRect();
    return { targetId: Number((el.dataset.row ?? "").slice("t:".length)), top: box.top, bottom: box.bottom };
  });
}

/** 줄의 박스(문장 상자 · 표 · 그림) - 선의 왼쪽 끝 · 폭 */
function findBox(item: Element | null | undefined): Element | null {
  return item?.querySelector(".new-line, .new-bundle, .new-block") ?? null;
}

/** 손잡이를 쥔 박스 · 덩어리 줄을 흐리게(data-drag-src) - 놓기 · 취소 뒤 걷는다 */
function markSource(sheet: HTMLElement, ids: readonly number[], on: boolean) {
  for (const id of ids) findBox(sheet.querySelector(`.new-item[data-row="t:${id}"]`))?.toggleAttribute("data-drag-src", on);
}

/** 고른 박스의 손잡이로 줄을 옮긴다 - grip이 null이면(읽기 전용 · 이미 쓴 문서) 붙이지 않는다 */
export function useComposedGrip(paneRef: RefObject<HTMLElement | null>, grip: ComposedGrip | null): void {
  function findSheet(): HTMLElement | null {
    return paneRef.current?.querySelector<HTMLElement>(".pg.new-sheet") ?? null;
  }

  /** 포인터 자리의 놓을 자리 - 출발 칸이면 칸 안 자리, 다른 칸이면 그 칸의 자리나 못 놓는 까닭, 용지 · 칸 밖은 표시 없음 */
  function planAt(input: ComposedGrip, source: GripSource, point: DragPoint, start: DragPoint): { edit: PlaceEdit; hover: DragHover; note: string } | { hover: DragHover } {
    const cdoc = toOutputCDoc(input.doc);
    const live = readLive(cdoc, source);
    if (!live) return { hover: { state: "refused", note: input.t("order.drag.changed") } };
    const sheet = findSheet();
    if (!sheet) return { hover: { state: "none" } };
    // 칸마다 세로 띠 - 그 칸 머리 줄부터 마지막 줄 상자까지
    const bands = new Map<string, { top: number; bottom: number }>();
    for (const el of sheet.querySelectorAll<HTMLElement>("[data-csec]:not([data-leave])")) {
      const key = el.dataset.csec ?? "";
      const box = el.getBoundingClientRect();
      const band = bands.get(key);
      bands.set(key, band ? { top: Math.min(band.top, box.top), bottom: Math.max(band.bottom, box.bottom) } : { top: box.top, bottom: box.bottom });
    }
    const sections = [...bands].map(([key, band]) => ({ key, band }));
    const found = findDropSectionByKey(point, sheet.getBoundingClientRect(), sections, live.section.location_key);
    if (found === null) return { hover: { state: "none" } };
    const key = sections[found.index].key;
    const dest = cdoc.sections.find((section) => section.location_key === key);
    if (!dest) return { hover: { state: "none" } };
    const rowEls = listRowEls(sheet, key);
    const slot = sheet.querySelector<HTMLElement>(`.new-slot-empty[data-slot="${CSS.escape(key)}"]`);
    const dx = point.x - start.x;
    let plan;
    if (found.isHome) {
      const firstTop = sheet.querySelector(`.new-item[data-row="t:${source.blockIds[0]}"]`)?.getBoundingClientRect().top ?? point.y;
      plan = planDrop({ locationKey: key, countsLines: live.section.counts_lines, items: live.section.items, depths: live.depths, block: live.block, rows: listDropRows(live.section.items, live.block, measureRows(rowEls)), pointerY: point.y, dx, homeTop: firstTop - 1 });
    } else {
      // 떠날 수 있는지 먼저(AI 번역은 원문과 함께만), 그다음 그 칸이 받는지(N/A · 묶음 · 앱이 채우는 목록 · 다른 WI 부분)
      const refusal = findLeaveRefusal(cdoc.entrance, live.section.items, live.block) ?? findEnterRefusal(live.section.location_key, dest, true);
      const head = sheet.querySelector<HTMLElement>(`[data-csec="${CSS.escape(key)}"][data-chead] .strip`);
      if (refusal) return { hover: { state: "refused", note: input.t(readRefusalKey(refusal)), target: slot ?? head } };
      const emptyTop = slot ? slot.getBoundingClientRect().top : (head?.getBoundingClientRect().bottom ?? point.y) + 1;
      plan = planCrossDrop({
        fromKey: live.section.location_key,
        toKey: key,
        source: { countsLines: live.section.counts_lines, items: live.section.items, depths: live.depths, block: live.block },
        dest: { countsLines: dest.counts_lines, items: dest.items, depths: getSectionDepths(dest), defaultStyle: dest.default_style },
        rows: listDropRows(dest.items, null, measureRows(rowEls)),
        pointerY: point.y,
        dx,
        emptyTop,
      });
    }
    // 제자리이거나 지금 문서에 얹을 수 없는 자리는 놓을 자리 밖
    const shown = plan.edit ? previewEdit(cdoc, plan.edit) : null;
    if (!plan.edit || !shown) return { hover: { state: "none" } };
    const firstId = live.section.items[live.block.start].target_id;
    const number = shown.sections.find((section) => section.location_key === key)?.items.find((item) => item.target_id === firstId)?.number ?? null;
    const note = `→ ${number ?? readSectionHead(dest)}`;
    // 빈 칸은 그 자리 박스에 테두리, 줄이 있는 칸은 두 줄 사이 점 달린 선(그 칸 박스의 왼쪽 끝 · 폭)
    if (rowEls.length === 0 || (!found.isHome && dest.items.length === 0)) return { edit: plan.edit, note, hover: { state: "ok", note, dest: note, target: slot } };
    const box = (findBox(rowEls.find((el) => !source.blockIds.includes(Number((el.dataset.row ?? "").slice("t:".length))))) ?? findBox(rowEls[0]))?.getBoundingClientRect();
    // lineY는 줄 상자 위 변에서 선 두께의 반을 뺀 자리다(c-drop-model)
    const line = box ? { left: box.left, top: plan.lineY, width: box.width } : null;
    return { edit: plan.edit, note, hover: { state: "ok", note, dest: note, line } };
  }

  const config: BoxDragConfig<GripSource> | null = grip && {
    handleOnly: true,
    pick: (event) => {
      const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pane="new"] [data-composed-grip]') : null;
      if (!handle) return null;
      const targetId = Number(handle.dataset.composedGrip);
      const cdoc = toOutputCDoc(grip.doc);
      for (const section of cdoc.sections) {
        const index = section.items.findIndex((item) => item.target_id === targetId);
        if (index < 0) continue;
        const block = findDragBlock(section.items, getSectionDepths(section), index, cdoc.entrance);
        const item = section.items[index];
        return { targetId, locationKey: section.location_key, blockIds: section.items.slice(block.start, block.end + 1).map((line) => line.target_id), text: item.text || item.caption || "" };
      }
      return null;
    },
    getCard: (source) => ({ id: "", text: source.text, count: source.blockIds.length > 1 ? grip.t("order.drag.lines", { count: source.blockIds.length }) : null }),
    getScrollers: () => {
      const body = paneRef.current?.querySelector<HTMLElement>(".pane-body");
      return body ? [body] : [];
    },
    onStart: (source) => {
      const sheet = findSheet();
      if (sheet) markSource(sheet, source.blockIds, true);
    },
    onMove: (source, point, start) => planAt(grip, source, point, start).hover,
    onDrop: (source, point, start) => {
      const result = planAt(grip, source, point, start);
      if ("edit" in result) grip.onPlace(result.edit, result.note);
    },
    onEnd: (source) => {
      const sheet = findSheet();
      if (sheet) markSource(sheet, source.blockIds, false);
    },
  };
  useBoxDrag(paneRef, config);
}
