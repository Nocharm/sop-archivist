// 관리 > AI - 사내 AI 연결 테스트(ping)와 일별 사용량. AI 꺼짐(503)·상류 오류(502)는 사람 말 문구로만 보여 준다(주소·토큰·원문 상태 코드 비노출).
"use client";

import { Loader2, Zap } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { getAiUsage, pingAi, type AiPing } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, INPUT_FIELD_AUTO, TABLE_CELL, TABLE_HEAD_CELL } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

// 사용량 조회 기간 선택지(일) - 서버 범위(1~365) 안에서 고른다
const USAGE_DAY_OPTIONS = [7, 30, 90];
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
          <select
            data-testid="ai-usage-days"
            className={INPUT_FIELD_AUTO}
            value={days}
            aria-label={t("ai.usage.range")}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {USAGE_DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t("ai.usage.days", { days: option })}
              </option>
            ))}
          </select>
        </div>
        {usage.error !== null && (
          <InlineNotice testId="ai-usage-error" tone="error">
            {humanizeApiError(usage.error, t)}
          </InlineNotice>
        )}
        {usage.data !== null && usage.data.length === 0 && (
          <p data-testid="ai-usage-empty" className="text-sm text-gray-500">
            {t("ai.usage.empty")}
          </p>
        )}
        {usage.data !== null && usage.data.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table data-testid="ai-usage-table" className="w-full min-w-[32rem]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className={TABLE_HEAD_CELL}>{t("ai.usage.column.date")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("ai.usage.column.calls")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("ai.usage.column.failed")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("ai.usage.column.prompt")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("ai.usage.column.completion")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usage.data.map((day) => (
                  <tr key={day.date} data-testid={`ai-usage-row-${day.date}`}>
                    <td className={TABLE_CELL}>{day.date}</td>
                    <td className={TABLE_CELL}>{day.calls}</td>
                    <td className={TABLE_CELL}>{day.failed}</td>
                    <td className={TABLE_CELL}>{day.prompt_tokens}</td>
                    <td className={TABLE_CELL}>{day.completion_tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
