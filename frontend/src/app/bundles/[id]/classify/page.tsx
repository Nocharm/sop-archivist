// 옛 주소 - 분류·짝 맞추기는 Assign 한 화면이 되었다(v0.10.0). 즐겨찾기·설명서 링크를 그 화면으로 넘긴다.
import { redirect } from "next/navigation";

export default async function LegacyClassifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/bundles/${id}/assign`);
}
