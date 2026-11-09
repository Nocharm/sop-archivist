// 관리 패널 머리 - 패널 이름 옆 (i)에 설명을 숨긴다(설명 문단을 본문에 두지 않는 규칙).
import { InfoTip } from "@/components/ui/info-tip";

export function PanelTitle({ title, info, testId }: { title: string; info: string; testId: string }) {
  return (
    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
      {title}
      <InfoTip text={info} testId={testId} />
    </h2>
  );
}
