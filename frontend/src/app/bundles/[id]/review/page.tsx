// 옛 주소 - 검토는 결과 화면(4단계) 위의 검토 띠가 되었다(네 단계 워크플로우 B4). 즐겨찾기·설명서 링크를 그 자리로 넘긴다.
import { redirect } from "next/navigation";

export default async function LegacyReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/bundles/${id}/outputs`);
}
