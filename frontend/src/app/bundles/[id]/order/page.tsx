// 3단계 순서·문단번호 - New 문서를 하나씩 열어 문장 순서, 들여쓰기, 번호 표시를 고친다(네 단계 워크플로우 §4.4).
// 결과물 C와 같은 종이와 같은 저장 줄을 쓴다 - 지나가도 되는 단계라 검토 요청 조건이 아니다.
"use client";

import { OutputsWorkspace } from "@/components/outputs/outputs-workspace";

export default function OrderPage() {
  return <OutputsWorkspace mode="order" />;
}
