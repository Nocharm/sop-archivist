// 옛 주소 - To-Be 목록은 Documents 화면의 New 문서 영역이 되었다(네 단계 워크플로우). 즐겨찾기·설명서 링크를 그 자리로 넘긴다.
import { redirect } from "next/navigation";

export default async function LegacyToBePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/bundles/${id}/documents#new-documents`);
}
