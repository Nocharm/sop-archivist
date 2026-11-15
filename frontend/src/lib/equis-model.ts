// EQUIS 표시의 글·모양과 다시 읽기 규칙 - 화면 규칙을 순수 함수로 두고 시험한다(설계 2026-11-13-equis-lookup-design §4.1·§9).
import type { EquisInfo, EquisVersion, SopDocument, TargetDoc } from "./api-sop";

/** quiet는 할 일 없음(회색), attention은 한 번 확인(경고색), muted는 EQUIS에 없음, neutral은 조회 실패 */
export type EquisTone = "quiet" | "attention" | "muted" | "neutral";
export type EquisIcon = "check" | "alert" | "dashed" | "failed" | "loading";

export interface EquisLabel {
  tone: EquisTone;
  icon: EquisIcon;
  text: string;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 조회 중일 때 목록을 다시 읽는 간격(ms)과 최대 횟수 - 30초가 지나면 멈춘다(서버가 그때쯤 조회 실패로 바꾼다) */
export const EQUIS_POLL_MS = 2000;
export const EQUIS_POLL_MAX = 15;

function join(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function describeVersion(version: EquisVersion): string {
  return join(version.status, version.version);
}

function describeReason(equis: EquisInfo, reason: string, t: Translate): string {
  if (reason === "retired" && equis.retired) return join(equis.retired.status, equis.retired.retired_date);
  if (reason === "version_mismatch" && equis.current) return t("equis.reason.version_mismatch", { version: equis.current.version, status: equis.current.status });
  if (reason === "newer_authorized") {
    const next = equis.in_progress.find((version) => version.status.toLowerCase() === "authorized");
    return t("equis.reason.newer_authorized", { version: next?.version ?? "" }).trim();
  }
  if (reason === "old_number") return t("equis.reason.old_number", { number: equis.number });
  if (reason === "no_current") return t("equis.reason.no_current");
  return reason;
}

/** 줄에 보일 표시 한 줄 - 판정보다 사실을 먼저 말한다. 상태 글자는 두 언어 모두 영어다(디자인 규칙) */
export function formatEquisLabel(equis: EquisInfo, t: Translate): EquisLabel {
  if (equis.state === "pending") return { tone: "muted", icon: "loading", text: t("equis.label.lookingUp") };
  if (equis.state === "not_found") return { tone: "muted", icon: "dashed", text: t("equis.label.notFound") };
  if (equis.verdict === "attention") {
    return { tone: "attention", icon: "alert", text: `${t("equis.label.check")} · ${describeReason(equis, equis.reasons[0] ?? "", t)}` };
  }
  // 조회에 실패했고 전에 받은 값도 없다 - 받은 값이 있으면 그 값을 계속 보인다
  if (equis.state === "unavailable" && equis.verdict === null) return { tone: "neutral", icon: "failed", text: t("equis.label.failed") };
  if (equis.verdict === "in_equis") {
    const shown = equis.current ?? equis.in_progress[equis.in_progress.length - 1] ?? null;
    return { tone: "quiet", icon: "check", text: join(t("equis.label.inEquis"), shown ? `· ${describeVersion(shown)}` : "") };
  }
  const note = equis.notes[0];
  const text = [t("equis.label.current"), equis.current ? describeVersion(equis.current) : "", note ? join(note.version, note.status) : ""].filter((part) => part !== "").join(" · ");
  return { tone: "quiet", icon: "check", text };
}

/** 펼친 정보 맨 위에 UI 언어로 풀어 쓰는 사유 문구의 키 - 모르는 사유는 건너뛴다 */
export function listEquisHintKeys(equis: EquisInfo): string[] {
  const known = ["old_number", "retired", "version_mismatch", "newer_authorized", "no_current"];
  return equis.reasons.filter((reason) => known.includes(reason)).map((reason) => `equis.hint.${reason}`);
}

/** To-Be 초안의 번호로 저장된 줄의 EQUIS 표시를 찾을 때 쓰는 열쇠 - 서버가 번호를 다듬는 규칙과 같다 */
export function normalizeDocNumber(code: string): string {
  return code.trim().toUpperCase();
}

/** 목록에 조회 중인 줄이 있는지 - 있는 동안만 다시 읽는다 */
export function hasRefreshingEquis(rows: ReadonlyArray<{ equis?: EquisInfo | null }> | null | undefined): boolean {
  return rows?.some((row) => row.equis?.refreshing === true) ?? false;
}

/**
 * 결과물 화면의 문서마다 붙일 EQUIS 표시 - 열쇠는 결과물 B의 노드 id("old:<옛 문서 id>" · "target:<새 문서 id>")다.
 * 문서 목록과 To-Be 응답이 이미 싣는 값을 잇기만 한다. 표시가 없는 문서(EQUIS 꺼짐·임시 번호)는 빠진다 - 그 자리에는 아무것도 그리지 않는다.
 */
export function mapOutputEquis(
  documents: ReadonlyArray<Pick<SopDocument, "id" | "side" | "equis">> | null | undefined,
  targetDocs: ReadonlyArray<Pick<TargetDoc, "id" | "equis">> | null | undefined,
): Map<string, EquisInfo> {
  const map = new Map<string, EquisInfo>();
  for (const doc of documents ?? []) if (doc.side === "old" && doc.equis) map.set(`old:${doc.id}`, doc.equis);
  for (const doc of targetDocs ?? []) if (doc.equis) map.set(`target:${doc.id}`, doc.equis);
  return map;
}
