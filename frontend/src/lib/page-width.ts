// 경로별 본문 폭 상한 - tokens.css --page-max(default 1280)·--page-max-wide(1600)·--page-max-desk(1920, Assign만). 표·카드 목록과 칸 셋 화면은 넓게, 읽는 글(개요·계정·설명서)은 1280
import { parseBundlePath, type StageKey } from "@/lib/stages";

export type PageWidth = "default" | "wide" | "desk";

const WIDE_STAGES: ReadonlySet<StageKey> = new Set(["documents", "split", "tobe", "history"]);

export function getPageWidth(pathname: string): PageWidth {
  if (pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/")) return "wide";
  const inBundle = parseBundlePath(pathname);
  if (inBundle?.stage === "assign") return "desk";
  if (inBundle?.stage && WIDE_STAGES.has(inBundle.stage)) return "wide";
  return "default";
}
