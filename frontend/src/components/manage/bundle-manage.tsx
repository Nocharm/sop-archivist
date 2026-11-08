// 개요의 묶음 관리 - 제목·설명 바로 고치기, 더보기 메뉴(묶음 삭제), 멤버 고치기, 작업 기록. 작성자이고 작업 중일 때만 고칠 수 있다.
"use client";

import { MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { MembersModal } from "@/components/manage/members-modal";
import { RoleTag } from "@/components/status";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { LoadMoreBlock } from "@/components/ui/load-more";
import { Collapse, MorphWidth, Truncate } from "@/components/ui/motion";
import { Menu } from "@/components/ui/menu";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { deleteBundle, listBundleEvents, putMembers, updateBundle, type BundleEvent } from "@/lib/api-manage";
import type { Bundle } from "@/lib/api-sop";
import { loadBundle, putBundle } from "@/lib/bundle-store";
import { formatKst } from "@/lib/datetime";
import { getDisplayName } from "@/lib/display-name";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
// 작업 기록에서 처음 보이는 줄 수 - 나머지는 "모두 보기"로 펼친다
const EVENTS_PREVIEW = 6;

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
    return multiline ? <textarea rows={2} {...shared} className={`${shared.className} py-1`} /> : <input {...shared} />;
  }

  return (
    <span className="hover-row inline-flex min-w-0 max-w-full items-center gap-1.5">
      {value ? (
        <span className={`min-w-0 ${className}`} data-testid={testId}>
          {value}
        </span>
      ) : (
        <span className={`text-ink-4 ${className}`} data-testid={testId}>
          {editable ? placeholder : ""}
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
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="head-title min-w-0">
          <EditableLine value={bundle.title} placeholder="" editable={editable} maxLength={TITLE_MAX} testId="overview-title" className="head-title" onSave={(next) => save("title", next)} />
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

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteBundle(bundle.id, bundle.revision);
      showToast(t("manage.deleted", { title: bundle.title }));
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
          <button
            type="button"
            role="menuitem"
            className="menu-item text-danger"
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
          target={bundle.title}
          summary={<span>{t("manage.deleteBody")}</span>}
          confirmLabel={t("manage.deleteBundle")}
          danger
          busy={busy}
          testId="overview-delete"
          onConfirm={() => void handleDelete()}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

export function MembersSection({ bundle }: { bundle: Bundle }) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false);
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

function EventLine({ event }: { event: BundleEvent }) {
  const { t } = useI18n();
  const key = `event.${event.action}`;
  const label = t(key) === key ? event.action : t(key);
  return (
    <li className="grid gap-0.5 border-b border-line py-1.5 last:border-b-0" data-testid={`overview-event-${event.id}`}>
      <span className="flex items-baseline gap-2 text-[13px] leading-5">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-xs text-ink-3">{formatKst(event.occurred_at)}</span>
      </span>
      <span className="flex min-w-0 items-baseline gap-2 text-xs text-ink-3">
        <span className="shrink-0 font-mono">{event.actor}</span>
        {event.reason && <Truncate className="min-w-0 flex-1" text={event.reason} />}
      </span>
    </li>
  );
}

export function ActivitySection({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const events = useLoaded(() => listBundleEvents(bundle.id), `${bundle.id}:${bundle.revision}`);
  const list = events.data ?? [];
  const rest = useProgressiveList(list.slice(EVENTS_PREVIEW), `${bundle.id}:${showAll}`, { pageSize: 40 });

  return (
    <section className="grid gap-1.5" data-testid="overview-activity">
      <div className="flex h-6 items-center justify-between">
        <h2 className="text-xs font-semibold text-ink-3">{t("manage.activity")}</h2>
        {list.length > EVENTS_PREVIEW && (
          <button type="button" className="btn ghost h-6 px-1.5 text-xs" data-testid="overview-activity-toggle" aria-expanded={showAll} onClick={() => setShowAll((prev) => !prev)}>
            <MorphWidth>{showAll ? t("manage.showLess") : t("manage.showAll", { n: list.length })}</MorphWidth>
          </button>
        )}
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
        <>
          <ul className="grid">
            {list.slice(0, EVENTS_PREVIEW).map((event) => (
              <EventLine key={event.id} event={event} />
            ))}
          </ul>
          <Collapse open={showAll}>
            <ul className="grid">
              {rest.visible.map((event) => (
                <EventLine key={event.id} event={event} />
              ))}
            </ul>
            {rest.hasMore && <LoadMoreBlock sentinelRef={rest.sentinelRef} rowHeight={48} testId="overview-activity-more" />}
          </Collapse>
        </>
      )}
    </section>
  );
}
