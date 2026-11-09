// 관리 화면 - AI 지침·프롬프트 버전. 왼쪽은 지침 종류(rules·prompt.*)와 활성 버전, 오른쪽은 버전 이력·내용 보기·새 버전 쓰기·활성화.
// 내용은 Markdown이라 보기는 읽기 보기(MarkdownView)로 그리고, 고칠 때만 원문을 쓴다(쓰기·미리 보기 전환).
// 버전은 지우지 않고 쌓인다. 새 버전은 만든 뒤 따로 활성화해야 AI 작업이 쓴다(백엔드 sop_guidelines.py).
"use client";

import { Check, FilePlus2, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { MarkdownView } from "@/components/ui/markdown-view";
import { BusyLabel, Collapse, Refresh } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { activateGuidelineVersion, createGuidelineVersion, getGuidelineVersion, listGuidelines, type Guideline, type GuidelineVersionMeta } from "@/lib/api-manage";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";

const LIST_KEY = "admin-guideline-versions";
// 백엔드 GuidelineContent·GuidelineNote 상한과 같은 값이어야 한다 - 넘기면 422로 돌아온다
const CONTENT_MAX = 200_000;
const NOTE_MAX = 2000;

function VersionViewer({ guideline, version, onEdit }: { guideline: Guideline; version: number; onEdit: (content: string) => void }) {
  const { t } = useI18n();
  const loaded = useLoaded(() => getGuidelineVersion(guideline.key, version), `${guideline.key}:${version}`);
  return (
    <Refresh token={`${guideline.key}:${version}`} className="grid gap-2">
      {loaded.error !== null ? (
        <p className="text-ink-2">{humanizeApiError(loaded.error, t)}</p>
      ) : loaded.data === null ? (
        <span className="sk h-[280px] w-full" />
      ) : (
        <>
          <div className="max-h-[560px] overflow-auto rounded-md border border-line bg-surface px-5 py-4">
            <MarkdownView source={loaded.data.content} testId="guideline-content" />
          </div>
          <div>
            <button type="button" className="btn" data-testid="guideline-edit" onClick={() => loaded.data && onEdit(loaded.data.content)}>
              <FilePlus2 size={14} strokeWidth={1.5} aria-hidden />
              {t("guidelines.editAsNew")}
            </button>
          </div>
        </>
      )}
    </Refresh>
  );
}

export function GuidelinesPanel() {
  const { t } = useI18n();
  const { data, error, isLoading, reload } = useLoaded(listGuidelines);
  const showSkeleton = useDelayedFlag(isLoading && data === null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ content: string; note: string } | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const guideline = data?.find((item) => item.key === selectedKey) ?? data?.[0] ?? null;
  const shownVersion = viewVersion ?? guideline?.active_version ?? guideline?.versions[0]?.version ?? null;
  const view = useListView(LIST_KEY);
  const versionColumns: DataColumn<GuidelineVersionMeta>[] = [
    {
      key: "version",
      header: t("guidelines.version"),
      card: "title",
      nowrap: true,
      className: "w-[150px]",
      cell: (version) => (
        <span className="font-mono">
          v{version.version}
          {version.is_active && (
            <span className="pill ok ml-2 font-sans">
              <Check size={12} strokeWidth={1.5} aria-hidden />
              {t("guidelines.active")}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "note",
      header: t("guidelines.note"),
      card: "body",
      grow: true,
      minWidth: 160,
      cell: (version) => <span className="text-ink-2">{version.note || <span className="text-ink-4">–</span>}</span>,
    },
    {
      key: "createdBy",
      header: t("guidelines.createdBy"),
      nowrap: true,
      cell: (version) => (
        <span className="text-ink-2">
          <span className="font-mono text-xs">{version.created_by}</span> · <span className="tabular-nums">{formatKst(version.created_at)}</span>
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("manage.rowActions")}</span>,
      card: "actions",
      className: "w-[180px] text-right",
      cell: (version) =>
        !version.is_active && (
          <span className="row-actions">
            <button
              type="button"
              className="btn h-7"
              data-testid={`guideline-activate-${version.version}`}
              disabled={activating !== null}
              onClick={(event) => {
                event.stopPropagation();
                setConfirming(version.version);
              }}
            >
              <BusyLabel busy={activating === version.version} label={t("guidelines.activate")} />
            </button>
          </span>
        ),
    },
  ];

  function selectKey(key: string) {
    setSelectedKey(key);
    setViewVersion(null);
    setDraft(null);
  }

  async function saveDraft() {
    if (!guideline || !draft) return;
    setSaving(true);
    try {
      const created = await createGuidelineVersion(guideline.key, draft.content, draft.note.trim());
      showToast(t("guidelines.created", { version: created.version }));
      setDraft(null);
      setViewVersion(created.version);
      reload();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
    }
  }

  async function activate(version: number) {
    if (!guideline) return;
    setActivating(version);
    try {
      await activateGuidelineVersion(guideline.key, version);
      showToast(t("guidelines.activated", { version }));
      reload();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setActivating(null);
      setConfirming(null);
    }
  }

  if (error !== null && data === null) {
    return (
      <p className="flex items-center gap-2 text-ink-2" data-testid="admin-guidelines-error">
        {humanizeApiError(error, t)}
        <button type="button" className="btn" onClick={reload}>
          <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
          {t("common.retry")}
        </button>
      </p>
    );
  }

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-5" data-testid="admin-guidelines">
      <nav className="grid content-start gap-0.5" aria-label={t("guidelines.keys")}>
        {data === null
          ? showSkeleton && [0, 1, 2, 3, 4].map((index) => <span key={index} className="sk h-12 w-full" />)
          : data.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={guideline?.key === item.key ? "true" : undefined}
                className={`grid gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover ${guideline?.key === item.key ? "bg-sel" : ""}`}
                data-testid={`guideline-key-${item.key}`}
                onClick={() => selectKey(item.key)}
              >
                <span className="font-mono text-[13px] font-semibold">{item.key}</span>
                <span className="text-xs text-ink-3">{item.active_version === null ? "–" : t("guidelines.activeVersion", { version: item.active_version })}</span>
              </button>
            ))}
      </nav>
      {guideline && (
        <section className="grid content-start gap-4" data-testid="guideline-detail">
          <div className="grid gap-2">
            <div className="flex justify-end">
              <ListViewToggle listKey={LIST_KEY} view={view} testId="guideline-versions-view" />
            </div>
            <DataList
              view={view}
              rows={guideline.versions}
              columns={versionColumns}
              getRowKey={(version) => version.version}
              testId="guideline-versions"
              rowTestId={(version) => `guideline-version-${version.version}`}
              onRowClick={(version) => {
                setViewVersion(version.version);
                setDraft(null);
              }}
              isRowSelected={(version) => shownVersion === version.version}
              cardMinWidth={260}
              framed
            />
          </div>
          <Collapse open={draft === null && shownVersion !== null}>
            {shownVersion !== null && (
              <VersionViewer
                guideline={guideline}
                version={shownVersion}
                onEdit={(content) => {
                  setDraft({ content, note: "" });
                  setIsPreview(false);
                }}
              />
            )}
          </Collapse>
          <Collapse open={draft !== null}>
            <div className="grid gap-2 rounded-lg border border-accent-line bg-surface p-3" data-testid="guideline-editor">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-3">{t("guidelines.newVersion", { key: guideline.key })}</span>
                <span className="flex-1" />
                <div className="flex gap-0.5 rounded-md bg-sunken p-0.5" role="group" aria-label={t("guidelines.editorMode")}>
                  {([false, true] as const).map((item) => (
                    <button
                      key={String(item)}
                      type="button"
                      aria-pressed={isPreview === item}
                      className={`h-[26px] rounded px-2.5 text-xs ${isPreview === item ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
                      data-testid={item ? "guideline-editor-preview" : "guideline-editor-write"}
                      onClick={() => setIsPreview(item)}
                    >
                      {t(item ? "guidelines.preview" : "guidelines.write")}
                    </button>
                  ))}
                </div>
              </div>
              {isPreview ? (
                <div className="h-[360px] overflow-auto rounded-md border border-line-2 bg-surface px-5 py-4 fade-in">
                  <MarkdownView source={draft?.content ?? ""} testId="guideline-editor-rendered" />
                </div>
              ) : (
                <textarea
                  className="h-[360px] w-full resize-y rounded-md border border-line-2 bg-surface p-2 font-mono text-xs leading-5 text-ink focus:border-accent focus:outline-none"
                  value={draft?.content ?? ""}
                  maxLength={CONTENT_MAX}
                  data-testid="guideline-editor-content"
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, content: event.target.value } : prev))}
                />
              )}
              <input
                className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none"
                placeholder={t("guidelines.notePlaceholder")}
                value={draft?.note ?? ""}
                maxLength={NOTE_MAX}
                data-testid="guideline-editor-note"
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, note: event.target.value } : prev))}
              />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => setDraft(null)}>
                  <X size={16} strokeWidth={1.5} aria-hidden />
                  {t("common.cancel")}
                </button>
                <button type="button" className="btn pri" data-testid="guideline-editor-save" disabled={saving || !draft?.content.trim()} onClick={() => void saveDraft()}>
                  <BusyLabel busy={saving} label={t("guidelines.saveVersion")} busyLabel={t("common.saving")} />
                </button>
              </div>
              <p className="text-xs text-ink-3">{t("guidelines.activateHint")}</p>
            </div>
          </Collapse>
        </section>
      )}
      {confirming !== null && guideline && (
        <ConfirmModal
          title={t("guidelines.activateTitle")}
          target={`${guideline.key} v${confirming}`}
          summary={<span>{t("guidelines.activateBody")}</span>}
          confirmLabel={t("guidelines.activate")}
          busy={activating !== null}
          testId="guideline-activate-confirm"
          onConfirm={() => void activate(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
