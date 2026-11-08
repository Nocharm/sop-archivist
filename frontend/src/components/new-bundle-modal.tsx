// 새 묶음 만들기 - 제목·설명·합성 표시. 만들면 바로 그 묶음의 개요로 간다(첫 다음 행동은 문서 올리기).
"use client";

import { useState, type FormEvent } from "react";

import { Modal } from "@/components/modal";
import { humanizeApiError } from "@/lib/api-errors";
import { createBundle } from "@/lib/api-sop";
import { putBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { INPUT_FIELD } from "@/lib/ui-classes";

const MAX_TITLE = 200;

export function NewBundleModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSynthetic, setIsSynthetic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const bundle = await createBundle({ title: title.trim(), description, is_synthetic: isSynthetic });
      putBundle(bundle);
      navigate(`/bundles/${bundle.id}`, { immediate: true });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("bundles.newTitle")}
      onClose={onClose}
      testId="new-bundle"
      footer={
        <>
          <button type="button" className="btn" data-testid="new-bundle-cancel" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="new-bundle-form"
            className="btn pri"
            data-testid="new-bundle-submit"
            disabled={!title.trim() || saving}
          >
            <span className="stack">
              <span data-on={saving ? undefined : ""}>{t("bundles.create")}</span>
              <span data-on={saving ? "" : undefined}>{t("common.saving")}</span>
            </span>
          </button>
        </>
      }
    >
      <form id="new-bundle-form" className="space-y-3" onSubmit={handleSubmit}>
        <label className="block space-y-1">
          <span className="text-xs text-ink-2">{t("bundles.fieldTitle")}</span>
          <input
            data-testid="new-bundle-title"
            className={INPUT_FIELD}
            value={title}
            maxLength={MAX_TITLE}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-2">{t("bundles.fieldDescription")}</span>
          <textarea
            data-testid="new-bundle-description"
            className={`${INPUT_FIELD} h-20 py-1.5`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            data-testid="new-bundle-synthetic"
            className="mt-1"
            checked={isSynthetic}
            onChange={(event) => setIsSynthetic(event.target.checked)}
          />
          <span>
            Synthetic data
            <span className="block text-xs text-ink-3">{t("bundles.syntheticHint")}</span>
          </span>
        </label>
        {error !== null && (
          <p data-testid="new-bundle-error" className="text-sm text-danger">
            {humanizeApiError(error, t)}
          </p>
        )}
      </form>
    </Modal>
  );
}
