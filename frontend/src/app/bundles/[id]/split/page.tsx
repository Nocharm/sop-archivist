// 옛 주소 - 쪼개기 화면은 배정 화면(2단계)에 합쳐졌다. 즐겨찾기·옛 링크를 배정 화면으로 넘기고, 그 화면이 문서를 한 단으로 연다.
import { redirect } from "next/navigation";

export default async function LegacySplitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string | string[] }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  // 문서를 가리키지 않았으면 읽을 수 있는 첫 문서가 열린다(first)
  const docId = typeof doc === "string" && /^\d+$/.test(doc) ? doc : "first";
  redirect(`/bundles/${id}/assign?edit=${docId}`);
}
