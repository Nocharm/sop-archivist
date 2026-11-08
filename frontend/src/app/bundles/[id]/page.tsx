// 묶음 개요 - 왼쪽은 제목·상태, 지금 할 일 하나, 언어별 배정 현황. 오른쪽 340px은 검토 요청 조건, AI 작업, 멤버(디자인 문서 8절).
"use client";

import { ArrowRight, Check, Info, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ActivitySection, BundleHeading, MembersSection } from "@/components/manage/bundle-manage";
import { AiJobPanel } from "@/components/manage/ai-job-panel";
import { Modal } from "@/components/modal";
import { BundleStatusPill, RoleTag } from "@/components/status";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import {
  getReadiness,
  requestReview,
  SEMANTIC_CHECK_KEYS,
  type Bundle,
  type LangProgress,
  type Readiness,
  type ReadinessIssue,
} from "@/lib/api-sop";
import { loadBundle, putBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { getStageHref, pickNextStage, STAGES } from "@/lib/stages";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded, type Loaded } from "@/lib/use-loaded";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

// 배정 현황 막대·표의 상태 순서와 채움 색 - 확정이 먼저, 미배정이 마지막
const COVER_STATES = [
  { key: "confirmed", fill: "var(--st-ok-fill)" },
  { key: "ai_suggested", fill: "var(--st-ai-fill)" },
  { key: "on_hold", fill: "var(--st-hold-fill)" },
  { key: "unassigned", fill: "var(--st-none-fill)" },
] as const;

const PROGRESS_LANGS = ["ko", "en"] as const;

function sumCounts(issues: ReadinessIssue[], prefix: string): number {
  return issues.filter((issue) => issue.code.startsWith(prefix)).reduce((total, issue) => total + (issue.count ?? 0), 0);
}

function findIssue(issues: ReadinessIssue[], code: string): ReadinessIssue | undefined {
  return issues.find((issue) => issue.code === code);
}

interface GateLine {
  key: string;
  ok: boolean;
  label: string;
}

/** 검토 요청 조건을 해야 하는 순서(다음 행동 순서)대로 줄로 편다. 통과한 줄도 남겨 무엇이 끝났는지 보인다. */
function buildGateLines(readiness: Readiness, semanticTotal: number, t: TFunc): GateLine[] {
  const { blockers } = readiness;
  const noDocs = findIssue(blockers, "no_documents");
  const unresolved = findIssue(blockers, "unresolved_documents");
  const units = sumCounts(blockers, "units_");
  const targets = sumCounts(blockers, "targets_");
  const reasons = sumCounts(blockers, "duplicate_without_reason") + sumCounts(blockers, "missing_reason");
  const warnings = findIssue(blockers, "unacked_missing_text");
  const semantic = findIssue(blockers, "semantic_checks_incomplete");
  const semanticMissing = semantic?.missing?.length ?? 0;
  const unresolvedCount = Array.isArray(unresolved?.document_ids) ? unresolved.document_ids.length : 0;
  return [
    {
      key: "documents",
      ok: !noDocs && !unresolved,
      label: noDocs ? t("gate.noDocuments") : unresolved ? t("gate.unresolvedDocuments", { n: unresolvedCount }) : t("gate.documentsOk"),
    },
    { key: "units", ok: units === 0, label: units ? t("gate.units", { n: units }) : t("gate.unitsOk") },
    { key: "targets", ok: targets === 0, label: targets ? t("gate.targets", { n: targets }) : t("gate.targetsOk") },
    {
      key: "warnings",
      ok: !warnings,
      label: warnings ? t("gate.warnings", { n: warnings.count ?? 0 }) : t("gate.warningsOk"),
    },
    { key: "reasons", ok: reasons === 0, label: reasons ? t("gate.reasons", { n: reasons }) : t("gate.reasonsOk") },
    {
      key: "semantic",
      ok: !semantic,
      label: semantic ? t("gate.semantic", { done: semanticTotal - semanticMissing, total: semanticTotal }) : t("gate.semanticOk"),
    },
    { key: "reviewer", ok: !findIssue(blockers, "no_reviewer"), label: findIssue(blockers, "no_reviewer") ? t("gate.noReviewer") : t("gate.reviewerOk") },
  ];
}

function countPending(progress: Bundle["progress"]): number {
  return PROGRESS_LANGS.reduce((total, lang) => {
    const item = progress[lang];
    return total + item.unassigned + item.ai_suggested + item.on_hold;
  }, 0);
}

function CoverageBar({ progress, lang }: { progress: LangProgress; lang: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
      <span className="lg">{lang.toUpperCase()}</span>
      <div className="flex h-2 min-w-0 gap-0.5" data-testid={`overview-bar-${lang}`}>
        {progress.total === 0 ? (
          <span className="block h-full flex-1 rounded bg-line" />
        ) : (
          COVER_STATES.filter((state) => progress[state.key] > 0).map((state) => (
            <span
              key={state.key}
              className="block h-full min-w-0.5 first:rounded-l last:rounded-r"
              style={{ flexGrow: progress[state.key], flexBasis: 0, background: state.fill }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Coverage({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  return (
    <section className="grid gap-2.5 rounded-lg border border-line bg-surface px-4 py-3.5" data-testid="overview-coverage">
      <h2 className="text-xs font-semibold text-ink-3">{t("overview.coverage")}</h2>
      <div className="flex flex-wrap gap-x-12 gap-y-2">
        {PROGRESS_LANGS.map((lang) => {
          const item = bundle.progress[lang];
          const percent = item.total === 0 ? null : Math.round((item.confirmed / item.total) * 100);
          return (
            <div key={lang} className="grid gap-0.5" data-testid={`overview-rate-${lang}`}>
              <span className="flex items-center gap-1.5 text-xs text-ink-3">
                <span className="lg">{lang.toUpperCase()}</span>
                Confirmed
              </span>
              <span className="flex items-baseline gap-2 tabular-nums">
                <span className="text-[30px] leading-[38px] text-ink">
                  {percent ?? "–"}
                  {percent !== null && <span className="text-xl">%</span>}
                </span>
                <span className="text-ink-3">{`${item.confirmed} / ${item.total}`}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 pt-1">
        {PROGRESS_LANGS.map((lang) => (
          <CoverageBar key={lang} progress={bundle.progress[lang]} lang={lang} />
        ))}
      </div>
      <table className="w-full border-collapse tabular-nums" data-testid="overview-counts">
        <thead>
          <tr className="text-xs text-ink-3">
            <th className="py-1 text-left font-normal" />
            {COVER_STATES.map((state) => (
              <th key={state.key} className="py-1 pl-3 text-right font-normal">
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block size-2 rounded-sm" style={{ background: state.fill }} aria-hidden />
                  {t(`status.unit.${state.key}`)}
                </span>
              </th>
            ))}
            <th className="py-1 pl-3 text-right font-normal">{t("overview.total")}</th>
          </tr>
        </thead>
        <tbody>
          {PROGRESS_LANGS.map((lang) => (
            <tr key={lang} className="border-t border-line">
              <td className="py-1">
                <span className="lg">{lang.toUpperCase()}</span>
              </td>
              {COVER_STATES.map((state) => (
                <td key={state.key} className="py-1 pl-3 text-right">
                  {bundle.progress[lang][state.key]}
                </td>
              ))}
              <td className="py-1 pl-3 text-right">{bundle.progress[lang].total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NextActionCard({ bundle, blockerCodes, onRequestReview }: { bundle: Bundle; blockerCodes: string[] | null; onRequestReview: () => void }) {
  const { t } = useI18n();
  const action = bundle.next_action;
  const stageKey = pickNextStage(action, blockerCodes);
  const stage = STAGES.find((item) => item.key === stageKey);
  const isAuthor = bundle.my_role === "author";
  let button = null;
  if (action === "request_review" && isAuthor) {
    button = (
      <button type="button" className="btn pri" data-testid="overview-next-go" onClick={onRequestReview}>
        {t("overview.requestReview")}
      </button>
    );
  } else if (stage) {
    button = stage.ready ? (
      <Link href={getStageHref(bundle.id, stage.key)} className="btn pri" data-testid="overview-next-go">
        {t("overview.start")}
        <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
      </Link>
    ) : (
      // 화면이 아직 없는 단계 - 자리는 지키고 왜 못 가는지 보인다
      <Tooltip label={t("overview.stageNotReady")}>
        <button type="button" className="btn pri" data-testid="overview-next-go" disabled>
          {t("overview.start")}
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
    );
  }
  return (
    <section
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-lg border border-line-2 bg-surface px-4 py-3.5"
      data-testid="overview-next"
      data-action={action}
    >
      <span className="text-xs text-ink-3">{t("overview.nextAction")}</span>
      <div className="col-start-2 row-span-3 row-start-1">{button}</div>
      <h2 className="head-title justify-self-start">
        <span className="ul">{t(`next.${action}.title`, { n: countPending(bundle.progress) })}</span>
      </h2>
      <p className="text-ink-2">{t(`next.${action}.body`)}</p>
    </section>
  );
}

function ReviewGate({ bundle, readiness, onRequestReview }: { bundle: Bundle; readiness: Loaded<Readiness>; onRequestReview: () => void }) {
  const { t } = useI18n();
  const { data, error, isLoading, reload } = readiness;
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  // 저장된 확인 값은 처음에 비어 있을 수 있어 전체 수는 항목 목록에서 센다
  const semanticTotal = SEMANTIC_CHECK_KEYS.length;
  const canRequest = data?.ready === true && bundle.my_role === "author" && bundle.status === "in_progress";

  return (
    <section className="grid gap-2.5" data-testid="overview-gate">
      <h2 className="text-xs font-semibold text-ink-3">{t("overview.reviewRequest")}</h2>
      {error !== null && data === null ? (
        <div className="flex items-center gap-2 text-ink-2" data-testid="overview-gate-error">
          {humanizeApiError(error, t)}
          <button type="button" className="btn ghost icon" aria-label={t("common.retry")} data-testid="overview-gate-retry" onClick={reload}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ) : (
        <ul className="grid gap-1.5" data-testid="overview-gate-list">
          {data === null
            ? Array.from({ length: 7 }, (_, index) => (
                <li key={index} className="h-[22px]">
                  {showSkeleton && <span className="sk h-4 w-48" />}
                </li>
              ))
            : buildGateLines(data, semanticTotal, t).map((line) => (
                <li
                  key={line.key}
                  className={`grid grid-cols-[16px_minmax(0,1fr)] gap-2 ${line.ok ? "text-ink-2" : "text-ink"}`}
                  data-testid={`overview-gate-${line.key}`}
                  data-ok={line.ok ? "" : undefined}
                >
                  {line.ok ? (
                    <Check size={16} strokeWidth={1.5} className="mt-[3px] text-accent" aria-label={t("gate.passed")} />
                  ) : (
                    <X size={16} strokeWidth={1.5} className="mt-[3px] text-danger" aria-label={t("gate.blocked")} />
                  )}
                  {line.label}
                </li>
              ))}
        </ul>
      )}
      {data?.notices.map((notice, index) => (
        <p key={`${notice.code}-${index}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-ink-2" data-testid={`overview-notice-${notice.code}`}>
          <Info size={16} strokeWidth={1.5} className="mt-[3px] text-ink-3" aria-hidden />
          {notice.code === "equipment_sop_empty_slots"
            ? t("notice.equipmentSlots", { doc: String(notice.doc_code ?? "") })
            : t("notice.sentenceWarnings", { n: notice.count ?? 0 })}
        </p>
      ))}
      {bundle.status === "in_progress" && (
        <button type="button" className="btn wide" data-testid="overview-request-review" disabled={!canRequest} onClick={onRequestReview}>
          {t("overview.requestReview")}
        </button>
      )}
    </section>
  );
}

function RequestReviewModal({ bundle, onClose }: { bundle: Bundle; onClose: () => void }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      putBundle(await requestReview(bundle.id, bundle.revision));
      onClose();
    } catch (err) {
      setError(err);
      setSaving(false);
      // revision·상태가 바뀌어 409일 수 있다 - 새 묶음으로 다시 시도할 수 있게 불러온다
      void loadBundle(bundle.id);
    }
  }

  const reviewers = bundle.members.filter((member) => member.role === "reviewer").map((member) => member.login_id);
  return (
    <Modal
      title={t("overview.requestReviewTitle")}
      onClose={onClose}
      isBusy={saving}
      testId="request-review"
      footer={
        <>
          <button type="button" className="btn" data-testid="request-review-cancel" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn pri" data-testid="request-review-confirm" disabled={saving} onClick={handleConfirm}>
            {t("overview.requestReview")}
          </button>
        </>
      }
    >
      <p className="text-ink-2">{t("overview.requestReviewBody")}</p>
      <div className="grid gap-1.5 rounded-md bg-sunken px-3 py-2.5 text-ink-2">
        <span className="font-semibold text-ink">{bundle.title}</span>
        <span>{t("overview.reviewers", { names: reviewers.join(", ") })}</span>
      </div>
      {error !== null && (
        <p className="text-danger" data-testid="request-review-error">
          {humanizeApiError(error, t)}
        </p>
      )}
    </Modal>
  );
}

export default function BundleOverviewPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const bundleId = Number(params.id);
  const { bundle, error, reload } = useBundle(bundleId);
  const [requesting, setRequesting] = useState(false);
  const showSkeleton = useDelayedFlag(bundle === null && error === null);
  // 검토 요청 조건 - 오른쪽 조건 칸과 다음 행동 카드(남은 것이 새 문장뿐이면 짝 맞추기로)가 함께 쓴다
  const readiness = useLoaded(() => getReadiness(bundleId), `${bundleId}:${bundle?.revision ?? 0}`);

  if (bundle === null) {
    if (error !== null) {
      return (
        <div data-testid="overview-error" className="flex items-center gap-3 px-6 py-6 text-ink-2">
          {humanizeApiError(error, t)}
          <button type="button" className="btn" data-testid="overview-retry" onClick={reload}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      );
    }
    return (
      <div className="grid gap-4 px-[22px] py-[18px]" data-testid="overview-loading">
        {showSkeleton && (
          <>
            <span className="sk h-7 w-80" />
            <span className="sk h-[98px] w-full" />
            <span className="sk h-[272px] w-full" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px]" data-testid="overview">
      <div className="grid content-start gap-4 overflow-y-auto px-[22px] py-[18px]">
        <BundleHeading bundle={bundle}>
          <BundleStatusPill status={bundle.status} testId="overview-status" />
          {bundle.my_role && <RoleTag role={bundle.my_role} testId="overview-role" />}
        </BundleHeading>
        <NextActionCard bundle={bundle} blockerCodes={readiness.data?.blockers.map((item) => item.code) ?? null} onRequestReview={() => setRequesting(true)} />
        <Coverage bundle={bundle} />
      </div>
      <aside className="grid content-start gap-4 overflow-y-auto border-l border-line bg-surface px-[var(--pad)] py-[18px]">
        <ReviewGate bundle={bundle} readiness={readiness} onRequestReview={() => setRequesting(true)} />
        <AiJobPanel bundle={bundle} />
        <MembersSection bundle={bundle} />
        <ActivitySection bundle={bundle} />
      </aside>
      {requesting && <RequestReviewModal bundle={bundle} onClose={() => setRequesting(false)} />}
    </div>
  );
}
