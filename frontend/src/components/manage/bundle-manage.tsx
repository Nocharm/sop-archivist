// 개요의 묶음 관리 - 제목·설명 바로 고치기, 더보기 메뉴(묶음 삭제), 멤버 고치기, 작업 기록. 작성자이고 작업 중일 때만 고칠 수 있다.
"use client";

import { FlaskConical, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { EventIcon, EventModal, getEventLabel } from "@/components/manage/event-modal";
import { MembersModal } from "@/components/manage/members-modal";
import { RoleTag } from "@/components/status";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Truncate } from "@/components/ui/motion";
import { Menu } from "@/components/ui/menu";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { deleteBundle, listBundleEvents, putMembers, updateBundle, type BundleEvent } from "@/lib/api-manage";
import type { Bundle } from "@/lib/api-sop";
import { loadBundle, putBundle } from "@/lib/bundle-store";
import { formatKstShort } from "@/lib/datetime";
import { getEventGroup } from "@/lib/event-kinds";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { getStageHref } from "@/lib/stages";
import { useLoaded } from "@/lib/use-loaded";
import { getBundleLabel } from "@/lib/bundle-label";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
// 작업 기록에서 처음 보이는 줄 수 - 나머지는 "모두 보기"로 펼친다
const EVENTS_PREVIEW = 10;

export function canManageBundle(bundle: Bundle): boolean {
  return bundle.my_role === "author" && bundle.status === "in_progress";
}

/** 글 한 줄 바로 고치기 - 호버하면 연필이 나타나고, 누르면 입력이 된다. Enter 저장, Esc 취소 */
function EditableLine({
  value,
  placeholder,
  editable,
  maxLength,
  testId,
  className,
  multiline = false,
  onSave,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  maxLength: number;
  testId: string;
  className: string;
  multiline?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (draft === null || saving) return;
    const next = draft.trim();
    if (next === value.trim() || (!multiline && next === "")) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setDraft(null);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setDraft(null);
    } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit();
    }
  }

  if (draft !== null) {
    const shared = {
      className: `w-full rounded-md border border-accent bg-surface px-2 outline-none ${className}`,
      value: draft,
      maxLength,
      autoFocus: true,
      disabled: saving,
      "data-testid": `${testId}-input`,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      onBlur: () => void commit(),
      onKeyDown: handleKey,
    };
    // 설명 칸은 끌어서 높이를 바꿀 수 있지만 64~200px 사이에서만
    return multiline ? <textarea rows={2} {...shared} className={`${shared.className} min-h-16 max-h-[200px] resize-y py-1`} /> : <input {...shared} />;
  }

  return (
    <span className="hover-row inline-flex min-w-0 max-w-full items-center gap-1.5">
      {value ? (
        <span className={`min-w-0 ${className}`} data-testid={testId}>
          {value}
        </span>
      ) : (
        <span className={className} data-testid={testId}>
          {/* 빈 칸 안내는 바깥 글자색(className)과 상관없이 흐리지만 읽히는 ink-3 - 대비 4.5:1 */}
          <span className="text-ink-3">{editable ? placeholder : ""}</span>
        </span>
      )}
      {editable && (
        <span className="row-actions">
          <Tooltip label={t("common.edit")}>
            <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("common.edit")} data-testid={`${testId}-edit`} onClick={() => setDraft(value)}>
              <Pencil size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        </span>
      )}
    </span>
  );
}

export function BundleHeading({ bundle, children }: { bundle: Bundle; children?: ReactNode }) {
  const { t } = useI18n();
  const editable = canManageBundle(bundle);

  async function save(field: "title" | "description", next: string) {
    putBundle(await updateBundle(bundle.id, { revision: bundle.revision, [field]: next }));
    showToast(t("common.saved"));
  }

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="head-title flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span className="font-mono tracking-normal" data-testid="overview-code">
            {bundle.code}
          </span>
          <EditableLine value={bundle.title} placeholder={t("manage.addName")} editable={editable} maxLength={TITLE_MAX} testId="overview-title" className="text-[20px] leading-7 text-ink-2" onSave={(next) => save("title", next)} />
        </h1>
        {children}
        <BundleMenu bundle={bundle} />
      </div>
      <EditableLine
        value={bundle.description}
        placeholder={t("manage.addDescription")}
        editable={editable}
        maxLength={DESCRIPTION_MAX}
        multiline
        testId="overview-description"
        className="text-[13px] leading-5 text-ink-2"
        onSave={(next) => save("description", next)}
      />
    </div>
  );
}

function BundleMenu({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!canManageBundle(bundle)) return null;

  async function toggleSynthetic() {
    setOpen(false);
    try {
      putBundle(await updateBundle(bundle.id, { revision: bundle.revision, is_synthetic: !bundle.is_synthetic }));
      showToast(t("common.saved"));
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteBundle(bundle.id, bundle.revision);
      showToast(t("manage.deleted", { title: getBundleLabel(bundle) }));
      navigate("/", { immediate: true });
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      setBusy(false);
      setDeleting(false);
      void loadBundle(bundle.id);
    }
  }

  return (
    <>
      <Tooltip label={t("manage.more")}>
        <button ref={anchorRef} type="button" className="btn ghost icon" aria-label={t("manage.more")} aria-expanded={open} data-testid="overview-menu" onClick={() => setOpen((prev) => !prev)}>
          <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
      {open && (
        <Menu anchorRef={anchorRef} onClose={() => setOpen(false)} testId="overview-menu-list" align="start">
          <button type="button" role="menuitem" className="menu-item" data-testid="overview-menu-synthetic" onClick={() => void toggleSynthetic()}>
            <FlaskConical size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden />
            {bundle.is_synthetic ? t("manage.unmarkSynthetic") : t("manage.markSynthetic")}
          </button>
          <div className="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item danger"
            data-testid="overview-menu-delete"
            onClick={() => {
              setOpen(false);
              setDeleting(true);
            }}
          >
            <Trash2 size={14} strokeWidth={1.5} aria-hidden />
            {t("manage.deleteBundle")}
          </button>
        </Menu>
      )}
      {deleting && (
        <ConfirmModal
          title={t("manage.deleteTitle")}
          target={getBundleLabel(bundle)}
          summary={<span>{t("manage.deleteBody")}</span>}
          confirmLabel={t("manage.deleteBundle")}
          danger
          confirmIcon={Trash2}
          busy={busy}
          testId="overview-delete"
          onConfirm={() => void handleDelete()}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

interface MembersSectionProps {
  bundle: Bundle;
  /** 개요의 다음 할 일(검토자 추가)이 모달을 열 수 있게 밖에서 쥘 수 있다 */
  editing?: boolean;
  onEditingChange?: (next: boolean) => void;
}

export function MembersSection({ bundle, editing: editingProp, onEditingChange }: MembersSectionProps) {
  const { t, lang } = useI18n();
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = onEditingChange ?? setEditingState;
  const editable = canManageBundle(bundle);
  return (
    <section className="grid gap-2.5" data-testid="overview-members">
      <div className="flex h-6 items-center justify-between">
        <h2 className="text-xs font-semibold text-ink-3">{t("overview.members")}</h2>
        {editable && (
          <button type="button" className="btn ghost h-6 px-1.5 text-xs" data-testid="overview-members-manage" onClick={() => setEditing(true)}>
            <Users size={14} strokeWidth={1.5} aria-hidden />
            {t("members.manage")}
          </button>
        )}
      </div>
      <ul className="grid gap-2">
        {bundle.members.map((member) => (
          <li key={member.login_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" data-testid={`overview-member-${member.login_id}`}>
            <span className="min-w-0">
              <Truncate text={getDisplayName(member, lang)} />
              <small className="block font-mono text-[11px] leading-4 text-ink-3">{member.login_id}</small>
            </span>
            <span className="flex items-center gap-1">
              {!member.active && <span className="pill danger">{t("overview.noAccess")}</span>}
              <RoleTag role={member.role} />
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <MembersModal
          title={t("members.title")}
          members={bundle.members}
          testId="overview-members-modal"
          onClose={() => setEditing(false)}
          onSave={async (members) => {
            putBundle(await putMembers(bundle.id, bundle.revision, members));
            showToast(t("common.saved"));
          }}
        />
      )}
    </section>
  );
}

function EventLine({ event, onOpen }: { event: BundleEvent; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <li>
      <button type="button" className="event-line" data-testid={`overview-event-${event.id}`} data-group={getEventGroup(event.action)} onClick={onOpen}>
        <span className="event-ic" aria-hidden>
          <EventIcon action={event.action} />
        </span>
        <span className="grid min-w-0 text-left">
          <span className="truncate text-[13px] leading-5">{getEventLabel(event.action, t)}</span>
          <span className="truncate font-mono text-[11px] leading-4 text-ink-3">{event.actor}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-ink-4">{formatKstShort(event.occurred_at)}</span>
      </button>
    </li>
  );
}

export function ActivitySection({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState<BundleEvent | null>(null);
  // 최근 몇 개만 - 나머지는 History 화면(레일 맨 아래)에서 본다
  const events = useLoaded(() => listBundleEvents(bundle.id, EVENTS_PREVIEW), `${bundle.id}:${bundle.revision}`);
  const list = events.data ?? [];
  const historyHref = getStageHref(bundle.id, "history");
  return (
    <section className="grid gap-1.5" data-testid="overview-activity">
      <div className="flex h-6 items-center justify-between">
        <h2 className="side-box-title">{t("manage.activity")}</h2>
        <Link href={historyHref} className="btn ghost h-6 px-1.5 text-xs" data-testid="overview-activity-all">
          {t("manage.viewAll")}
        </Link>
      </div>
      {events.error !== null && events.data === null ? (
        <p className="text-ink-3">{humanizeApiError(events.error, t)}</p>
      ) : events.data === null ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((row) => (
            <span key={row} className="sk h-8 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="text-ink-3">–</p>
      ) : (
        <ul className="grid">
          {list.map((event) => (
            <EventLine key={event.id} event={event} onOpen={() => setOpened(event)} />
          ))}
        </ul>
      )}
      {opened && <EventModal event={opened} historyHref={historyHref} onClose={() => setOpened(null)} />}
    </section>
  );
}
