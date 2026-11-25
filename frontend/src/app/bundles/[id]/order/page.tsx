// 3단계 순서·문단번호 - New 문서를 하나씩 열어 문장 순서, 들여쓰기, 번호 표시를 고친다(네 단계 워크플로우 §4.4).
// 결과물 C와 같은 종이와 같은 저장 줄을 쓴다 - 지나가도 되는 단계라 검토 요청 조건이 아니다.
// 새 문서를 만드는 쪽을 숨긴 동안(lib/drafting) 이 주소는 배정 화면으로 넘어간다.
"use client";

import { redirect, useParams } from "next/navigation";

import { OutputsWorkspace } from "@/components/outputs/outputs-workspace";
import { useDraftingOn } from "@/lib/drafting";
import { getStageHref } from "@/lib/stages";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const drafting = useDraftingOn();
  // 서버 렌더에서는 아직 모른다 - 거기서 넘기면 켠 개발 화면도 열 수 없다
  if (drafting === null) return null;
  if (!drafting) redirect(getStageHref(Number(id), "assign"));
  return <OutputsWorkspace mode="order" />;
}
