// 옛 주소 - 쪼개기 화면은 배정 화면(2단계) 안의 "원문 고치기"가 되었다(네 단계 워크플로우 B3). 즐겨찾기·설명서 링크를 그 자리로 넘긴다.
import { redirect } from "next/navigation";

export default async function LegacySplitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string | string[] }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  // 문서를 가리키지 않았으면 읽을 수 있는 첫 문서가 열린다(first)
  const docId = typeof doc === "string" && /^\d+$/.test(doc) ? doc : "first";
  redirect(`/bundles/${id}/assign?edit=${docId}`);
}
