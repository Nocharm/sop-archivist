// 4단계 결과 - 결과물 A·B·C(읽기 전용), 요약 숫자, 의미 확인, Excel. 순서·들여쓰기·번호는 3단계(/order)에서 고친다.
"use client";

import { OutputsWorkspace } from "@/components/outputs/outputs-workspace";

export default function OutputsPage() {
  return <OutputsWorkspace mode="outputs" />;
}
