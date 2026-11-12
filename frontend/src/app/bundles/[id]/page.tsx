// 묶음 개요 - 왼쪽은 제목·상태, 지금 할 일 하나, 언어별 배정 현황. 오른쪽 340px은 검토 요청 조건, AI 작업, 멤버(디자인 문서 8절).
"use client";

import {
  BadgeCheck,
  Check,
  CheckCheck,
  ChevronRight,
  FileUp,
  FileWarning,
  Hourglass,
  Info,
  ListTree,
  MessageSquareText,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Split,
  TriangleAlert,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ActivitySection, BundleHeading, MembersSection } from "@/components/manage/bundle-manage";
import { AiJobPanel } from "@/components/manage/ai-job-panel";
import { BundleLoadError } from "@/components/bundle-load-error";
import { Modal } from "@/components/modal";
import { ReviewReturnNote } from "@/components/review-return-note";
import { BundleStatusPill, RoleTag } from "@/components/status";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { WithdrawReviewButton } from "@/components/withdraw-review";
import { humanizeApiError } from "@/lib/api-errors";
import {
  getReadiness,
  requestReview,
  SEMANTIC_CHECK_KEYS,
  type Bundle,
  type RowProgress,
  type NextAction,
  type Readiness,
  type ReadinessIssue,
} from "@/lib/api-sop";
import { loadBundle, putBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { countPending, getConfirmedPercent } from "@/lib/progress-model";
import { getStageHref, NEXT_ACTION_STAGE, STAGES } from "@/lib/stages";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { GATE_STAGE, groupNotices, isNoticeGroup, splitGates, type GateKey } from "@/lib/review-gates";
import { useLoaded, type Loaded } from "@/lib/use-loaded";
import { getBundleLabel } from "@/lib/bundle-label";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

// 배정 현황 막대·표의 상태 순서와 채움 색 - 확정이 먼저, 미배정이 마지막
const COVER_STATES = [
  { key: "confirmed", fill: "var(--st-ok-fill)" },
  { key: "ai_suggested", fill: "var(--st-ai-fill)" },
  { key: "on_hold", fill: "var(--st-hold-fill)" },
  { key: "unassigned", fill: "var(--st-none-fill)" },
] as const;

// 다음 할 일 종류별 아이콘 - 화면이 열릴 때 한 번 움직이고 멈춘다(.next-badge)
const NEXT_ICONS: Record<NextAction, LucideIcon> = {
  upload_documents: FileUp,
  resolve_documents: FileWarning,
  check_boundaries: CheckCheck,
  fill_tobe: ListTree,
  decide_units: Split,
  ack_warnings: TriangleAlert,
  fill_reasons: MessageSquareText,
  semantic_checks: ShieldCheck,
  add_reviewer: UserPlus,
  request_review: Send,
  await_review: Hourglass,
  done: BadgeCheck,
};

// 검토 요청 조건 카드를 Fail·Pass 묶음마다 몇 개까지 먼저 보일지
const GATES_PREVIEW = 3;

function sumCounts(issues: ReadinessIssue[], prefix: string): number {
  return issues.filter((issue) => issue.code.startsWith(prefix)).reduce((total, issue) => total + (issue.count ?? 0), 0);
}

function findIssue(issues: ReadinessIssue[], code: string): ReadinessIssue | undefined {
  return issues.find((issue) => issue.code === code);
}

interface GateLine {
  key: GateKey;
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
  const boundaries = findIssue(blockers, "unchecked_boundaries");
  const semantic = findIssue(blockers, "semantic_checks_incomplete");
  const semanticMissing = semantic?.missing?.length ?? 0;
  const unresolvedCount = Array.isArray(unresolved?.document_ids) ? unresolved.document_ids.length : 0;
  return [
    {
      key: "documents",
      ok: !noDocs && !unresolved,
      label: noDocs ? t("gate.noDocuments") : unresolved ? t("gate.unresolvedDocuments", { n: unresolvedCount }) : t("gate.documentsOk"),
    },
    {
      key: "boundaries",
      ok: !boundaries,
      label: boundaries ? t("gate.boundaries", { n: boundaries.count ?? 0 }) : t("gate.boundariesOk"),
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

function CoverageBar({ progress }: { progress: RowProgress }) {
  return (
    <div className="flex h-2 min-w-0 gap-0.5" data-testid="overview-bar">
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
  );
}

function Coverage({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  // 문서가 없으면 0% 막대와 빈 표 대신 흐린 한 줄 - 아직 시작 전이라는 말만 한다
  if (bundle.document_count === 0) {
    return (
      <section className="rounded-lg border border-line px-4 py-2.5 text-ink-3" data-testid="overview-coverage" data-idle="">
        {t("overview.notStarted")}
      </section>
    );
  }
  const { progress } = bundle;
  const percent = getConfirmedPercent(progress);
  return (
    <section className="grid gap-2.5 rounded-lg border border-line bg-surface px-4 py-3.5" data-testid="overview-coverage">
      <h2 className="text-xs font-semibold text-ink-3">{t("overview.coverage")}</h2>
      <div className="grid gap-0.5" data-testid="overview-rate">
        <span className="text-xs text-ink-3">Confirmed</span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <span className="text-[30px] leading-[38px] text-ink">
            {percent ?? "–"}
            {percent !== null && <span className="text-xl">%</span>}
          </span>
          <span className="text-ink-3">{`${progress.confirmed} / ${progress.total}`}</span>
        </span>
      </div>
      <div className="pt-1">
        <CoverageBar progress={progress} />
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
          <tr className="border-t border-line">
            <td className="py-1">{t("overview.rows")}</td>
            {COVER_STATES.map((state) => (
              <td key={state.key} className="py-1 pl-3 text-right">
                {progress[state.key]}
              </td>
            ))}
            <td className="py-1 pl-3 text-right">{progress.total}</td>
          </tr>
        </tbody>
      </table>
      {progress.single_language > 0 && (
        <p className="text-xs text-ink-3" data-testid="overview-single-language">
          {t("overview.singleLanguage", { n: progress.single_language })}
        </p>
      )}
    </section>
  );
}

function NextActionCard({ bundle, onRequestReview, onAddReviewer }: { bundle: Bundle; onRequestReview: () => void; onAddReviewer: () => void }) {
  const { t } = useI18n();
  const action = bundle.next_action;
  const stageKey = NEXT_ACTION_STAGE[action];
  const stage = STAGES.find((item) => item.key === stageKey);
  const isAuthor = bundle.my_role === "author";
  const Icon = NEXT_ICONS[action];
  let button = null;
  if (action === "add_reviewer" && isAuthor && bundle.status === "in_progress") {
    button = (
      <button type="button" className="btn pri" data-testid="overview-next-go" onClick={onAddReviewer}>
        <UserPlus size={16} strokeWidth={1.5} aria-hidden />
        {t("overview.addReviewer")}
      </button>
    );
  } else if (action === "request_review" && isAuthor) {
    button = (
      <button type="button" className="btn pri" data-testid="overview-next-go" onClick={onRequestReview}>
        {t("overview.requestReview")}
      </button>
    );
  } else if (stage) {
    button = stage.ready ? (
      <Link href={getStageHref(bundle.id, stage.key)} className="btn pri start-btn" data-testid="overview-next-go">
        <span className="start-ico" aria-hidden>
          <Play size={15} strokeWidth={1.8} />
        </span>
        {t("overview.start")}
      </Link>
    ) : (
      // 화면이 아직 없는 단계 - 자리는 지키고 왜 못 가는지 보인다
      <Tooltip label={t("overview.stageNotReady")}>
        <button type="button" className="btn pri" data-testid="overview-next-go" disabled>
          {t("overview.start")}
        </button>
      </Tooltip>
    );
  }
  return (
    <section
      className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg border border-line-2 bg-surface px-4 py-3.5"
      data-testid="overview-next"
      data-action={action}
    >
      <span className="next-badge" key={action} aria-hidden>
        <Icon size={26} strokeWidth={1.5} />
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-xs text-ink-3">{t("overview.nextAction")}</span>
        <h2 className="head-title justify-self-start">{t(`next.${action}.title`, { n: countPending(bundle.progress) })}</h2>
        <p className="text-ink-2">{t(`next.${action}.body`)}</p>
      </div>
      <div>{button}</div>
    </section>
  );
}

/** 같은 안내가 여러 문서에 걸치면 한 줄로 접고, 누르면 문서 코드가 펼쳐진다 */
function NoticeGroupLine({ docs }: { docs: string[] }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="grid gap-1.5" data-testid="overview-notice-group-box">
      <button
        type="button"
        className="grid grid-cols-[16px_minmax(0,1fr)_14px] gap-2 text-left text-ink-2"
        aria-expanded={isOpen}
        data-testid="overview-notice-group"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Info size={16} strokeWidth={1.5} className="mt-[3px] text-ink-3" aria-hidden />
        <span>{t("notice.equipmentSlotsGroup", { n: docs.length })}</span>
        <ChevronRight size={14} strokeWidth={1.5} className={`mt-[3px] text-ink-3 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {isOpen && (
        <ul className="m-0 grid list-none gap-0.5 pl-6 font-mono text-[11px] text-ink-3" data-testid="overview-notice-group-docs">
          {docs.map((doc, index) => (
            <li key={`${doc}-${index}`} className="break-all">
              {doc}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ReviewGateProps {
  bundle: Bundle;
  readiness: Loaded<Readiness>;
  onRequestReview: () => void;
  onAddReviewer: () => void;
}

function ReviewGate({ bundle, readiness, onRequestReview, onAddReviewer }: ReviewGateProps) {
  const { t } = useI18n();
  const { data, error, isLoading, reload } = readiness;
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const tip = useDelegatedTip();
  // 저장된 확인 값은 처음에 비어 있을 수 있어 전체 수는 항목 목록에서 센다
  const semanticTotal = SEMANTIC_CHECK_KEYS.length;
  const isAuthor = bundle.my_role === "author";
  const canRequest = data?.ready === true && isAuthor && bundle.status === "in_progress";
  const [showAll, setShowAll] = useState(false);
  const isIdle = bundle.document_count === 0;
  const lines = data === null ? [] : buildGateLines(data, semanticTotal, t);
  const split = splitGates(lines, showAll ? Infinity : GATES_PREVIEW);
  const hidden = split.failHidden + split.passHidden;
  const passed = lines.filter((line) => line.ok).length;
  const groupedNotices = groupNotices(data?.notices ?? []);

  return (
    <section className="side-box grid gap-2.5" data-testid="overview-gate">
      <h2 className="side-box-title">
        {t("overview.reviewRequest")}
        {data !== null && !isIdle && <span className="font-mono text-[11px] font-normal text-ink-3">{`${passed} / ${lines.length}`}</span>}
      </h2>
      {error !== null && data === null ? (
        <div className="flex items-center gap-2 text-ink-2" data-testid="overview-gate-error">
          {humanizeApiError(error, t)}
          <Tooltip label={t("common.retry")}>
            <button type="button" className="btn ghost icon" aria-label={t("common.retry")} data-testid="overview-gate-retry" onClick={reload}>
              <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : isIdle && data !== null ? (
        // 문서가 없으면 조건 여덟 줄이 전부 빨개 보인다 - 중립 한 줄로 대신한다
        <p className="text-ink-3" data-testid="overview-gate-idle">
          {t("overview.notStarted")}
        </p>
      ) : (
        <div className="grid gap-2" data-testid="overview-gate-list" {...tip.handlers}>
          {data === null ? (
            Array.from({ length: 4 }, (_, index) => <span key={index} className="block h-[34px]">{showSkeleton && <span className="sk h-full w-full" />}</span>)
          ) : (
            <>
              {split.fail.length > 0 && (
                <div className="grid gap-1.5">
                  <span className="gate-group fail">{`Fail ${lines.length - passed}`}</span>
                  {split.fail.map((line) => {
                    // 막힌 조건은 푸는 곳으로 가는 길이다 - 화면이 있으면 그 단계로, 검토자 조건은 작성자에게 멤버 창을 연다
                    const stage = GATE_STAGE[line.key];
                    const body = (
                      <>
                        <X size={15} strokeWidth={1.8} aria-label={t("gate.blocked")} data-tip={t("gate.blocked")} />
                        <span>{line.label}</span>
                        <ChevronRight className="go-arrow" size={14} strokeWidth={1.5} aria-hidden />
                      </>
                    );
                    if (stage !== null) {
                      return (
                        <Link key={line.key} href={getStageHref(bundle.id, stage)} className="gate-card fail go" data-testid={`overview-gate-${line.key}`}>
                          {body}
                        </Link>
                      );
                    }
                    if (isAuthor) {
                      return (
                        <button key={line.key} type="button" className="gate-card fail go" data-testid={`overview-gate-${line.key}`} onClick={onAddReviewer}>
                          {body}
                        </button>
                      );
                    }
                    return (
                      <div key={line.key} className="gate-card fail" data-testid={`overview-gate-${line.key}`}>
                        <X size={15} strokeWidth={1.8} aria-label={t("gate.blocked")} data-tip={t("gate.blocked")} />
                        {line.label}
                      </div>
                    );
                  })}
                </div>
              )}
              {split.pass.length > 0 && (
                <div className="grid gap-1.5">
                  <span className="gate-group pass">{`Pass ${passed}`}</span>
                  {split.pass.map((line) => (
                    <div key={line.key} className="gate-card pass" data-testid={`overview-gate-${line.key}`} data-ok="">
                      <Check size={15} strokeWidth={1.8} aria-label={t("gate.passed")} data-tip={t("gate.passed")} />
                      {line.label}
                    </div>
                  ))}
                </div>
              )}
              {(hidden > 0 || showAll) && (
                <button type="button" className="text-link justify-self-start" data-testid="overview-gate-more" onClick={() => setShowAll((prev) => !prev)}>
                  {showAll ? t("overview.gatesLess") : t("overview.gatesMore", { n: hidden })}
                </button>
              )}
            </>
          )}
          {tip.node}
        </div>
      )}
      {bundle.status === "in_progress" && (
        <>
          <button type="button" className="btn wide" data-testid="overview-request-review" disabled={!canRequest} onClick={onRequestReview}>
            {t("overview.requestReview")}
          </button>
          {/* 꺼진 단추가 이유를 말한다 - 조건을 아직 못 읽었으면 비워 둔다 */}
          {!canRequest && data !== null && (
            <p className="text-xs text-ink-3" data-testid="overview-request-hint">
              {isAuthor ? t("overview.requestBlocked") : t("overview.requestAuthorOnly")}
            </p>
          )}
        </>
      )}
      {/* 요청한 자리에서 물린다 - 검토자가 보기 전에 고칠 것이 생긴 작성자의 길 */}
      {bundle.status === "in_review" && isAuthor && <WithdrawReviewButton bundle={bundle} className="btn wide" testId="overview-withdraw-review" />}
      {groupedNotices.map((notice) =>
        isNoticeGroup(notice) ? (
          <NoticeGroupLine key={notice.code} docs={notice.docs} />
        ) : (
          <p key={`${notice.code}-${notice.doc_code ?? ""}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-ink-2" data-testid={`overview-notice-${notice.code}`}>
            <Info size={16} strokeWidth={1.5} className="mt-[3px] text-ink-3" aria-hidden />
            {notice.code === "equipment_sop_empty_slots"
              ? t("notice.equipmentSlots", { doc: String(notice.doc_code ?? "") })
              : t("notice.sentenceWarnings", { n: notice.count ?? 0 })}
          </p>
        ),
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
      size="sm"
      testId="request-review"
      footer={
        <>
          <button type="button" className="btn" data-testid="request-review-cancel" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
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
        <span className="font-semibold text-ink">{getBundleLabel(bundle)}</span>
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
  const params = useParams<{ id: string }>();
  const bundleId = Number(params.id);
  const { bundle, error, reload } = useBundle(bundleId);
  const [requesting, setRequesting] = useState(false);
  const [editingMembers, setEditingMembers] = useState(false);
  const showSkeleton = useDelayedFlag(bundle === null && error === null);
  // 검토 요청 조건 - 오른쪽 조건 칸과 다음 행동 카드(남은 것이 새 문장뿐이면 짝 맞추기로)가 함께 쓴다
  const readiness = useLoaded(() => getReadiness(bundleId), `${bundleId}:${bundle?.revision ?? 0}`);

  if (bundle === null) {
    if (error !== null) return <BundleLoadError error={error} onRetry={reload} testId="overview" />;
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
        <ReviewReturnNote bundle={bundle} />
        <NextActionCard
          bundle={bundle}
          onRequestReview={() => setRequesting(true)}
          onAddReviewer={() => setEditingMembers(true)}
        />
        <Coverage bundle={bundle} />
      </div>
      <aside className="grid content-start gap-3 overflow-y-auto border-l border-line px-3 py-[18px]">
        <ReviewGate bundle={bundle} readiness={readiness} onRequestReview={() => setRequesting(true)} onAddReviewer={() => setEditingMembers(true)} />
        <div className="side-box">
          <AiJobPanel bundle={bundle} />
        </div>
        <div className="side-box">
          <MembersSection bundle={bundle} editing={editingMembers} onEditingChange={setEditingMembers} />
        </div>
        <div className="side-box">
          <ActivitySection bundle={bundle} />
        </div>
      </aside>
      {requesting && <RequestReviewModal bundle={bundle} onClose={() => setRequesting(false)} />}
    </div>
  );
}
