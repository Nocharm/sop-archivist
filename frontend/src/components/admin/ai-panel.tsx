// 관리 > AI - 사내 AI 연결 테스트(ping)와 일별 사용량. AI 꺼짐(503)·상류 오류(502)는 사람 말 문구로만 보여 준다(주소·토큰·원문 상태 코드 비노출).
"use client";

import { Bot, Loader2, Zap } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { getAiUsage, pingAi, type AiPing, type AiUsageDay } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY } from "@/lib/ui-classes";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";

// 사용량 조회 기간 선택지(일) - 서버 범위(1~365) 안에서 고른다
const USAGE_DAY_OPTIONS = [7, 30, 90];
const LIST_KEY = "admin-ai-usage";
const DEFAULT_USAGE_DAYS = 30;

type PingResult = { kind: "ok"; ping: AiPing } | { kind: "error"; error: unknown };

function PingOutcome({ result }: { result: PingResult }) {
  const { t } = useI18n();
  if (result.kind === "error") {
    return (
      <InlineNotice testId="ai-ping-result" tone="error">
        {humanizeApiError(result.error, t)}
      </InlineNotice>
    );
  }
  return (
    <InlineNotice testId="ai-ping-result" tone="info">
      <p>{t("ai.ping.connected", { model: result.ping.model, ms: result.ping.latency_ms })}</p>
      <p className="text-gray-600">{result.ping.reply_ok ? t("ai.ping.replyOk") : t("ai.ping.replyOff")}</p>
    </InlineNotice>
  );
}

export function AiPanel() {
  const { t } = useI18n();
  const [days, setDays] = useState(DEFAULT_USAGE_DAYS);
  const usage = useLoaded(() => getAiUsage(days), String(days));
  const view = useListView(LIST_KEY);
  const countColumn = (key: "calls" | "failed" | "prompt_tokens" | "completion_tokens", label: string): DataColumn<AiUsageDay> => ({
    key,
    header: label,
    align: "end",
    cell: (day) => day[key],
  });
  const usageColumns: DataColumn<AiUsageDay>[] = [
    { key: "date", header: t("ai.usage.column.date"), card: "title", nowrap: true, cell: (day) => <span className="tabular-nums">{day.date}</span> },
    countColumn("calls", t("ai.usage.column.calls")),
    countColumn("failed", t("ai.usage.column.failed")),
    countColumn("prompt_tokens", t("ai.usage.column.prompt")),
    countColumn("completion_tokens", t("ai.usage.column.completion")),
  ];
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);

  const handlePing = async () => {
    setIsPinging(true);
    setPingResult(null);
    try {
      setPingResult({ kind: "ok", ping: await pingAi() });
    } catch (err) {
      setPingResult({ kind: "error", error: err });
    } finally {
      setIsPinging(false);
    }
  };

  return (
    <section data-testid="ai-panel" className="space-y-6">
      <p className="text-sm text-gray-600">{t("ai.intro")}</p>

      <div className="space-y-3">
        <button type="button" data-testid="ai-ping" className={BUTTON_PRIMARY} disabled={isPinging} onClick={() => void handlePing()}>
          {isPinging ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <Zap size={16} strokeWidth={1.5} />}
          {isPinging ? t("ai.pinging") : t("ai.pingRun")}
        </button>
        {pingResult !== null && <PingOutcome result={pingResult} />}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="shrink-0 text-sm font-semibold text-gray-900">{t("ai.usage.title")}</h3>
          <div className="flex items-center gap-2">
            <Select
              testId="ai-usage-days"
              ariaLabel={t("ai.usage.range")}
              value={String(days)}
              options={USAGE_DAY_OPTIONS.map((option) => ({ value: String(option), label: t("ai.usage.days", { days: option }) }))}
              onChange={(next) => setDays(Number(next))}
            />
            <ListViewToggle listKey={LIST_KEY} view={view} testId="ai-usage-view" />
          </div>
        </div>
        {usage.error !== null && (
          <InlineNotice testId="ai-usage-error" tone="error">
            {humanizeApiError(usage.error, t)}
          </InlineNotice>
        )}
        {usage.data !== null && usage.data.length === 0 && (
          <EmptyState icon={Bot} testId="ai-usage-empty" title={t("ai.usage.empty")} compact />
        )}
        {usage.data !== null && usage.data.length > 0 && (
          <DataList
            view={view}
            rows={usage.data}
            columns={usageColumns}
            getRowKey={(day) => day.date}
            testId="ai-usage-table"
            rowTestId={(day) => `ai-usage-row-${day.date}`}
            cardMinWidth={260}
            framed
          />
        )}
      </div>
    </section>
  );
}
