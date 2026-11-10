// 사용 설명서 - Markdown 한 벌(public/manual/user-manual.md)을 빌드 때 읽어 조각 화면에 넘긴다.
// 같은 파일이 /manual/user-manual.md 로도 나가므로 화면과 (나중의) 챗봇이 같은 글을 본다.
import type { Metadata } from "next";

import { ManualView } from "@/components/manual/manual-view";
import { readImageSizes, readManualSource } from "@/lib/manual-files";

export const metadata: Metadata = { title: "Manual · SOP Archivist" };

// 파일은 빌드 때 한 번만 읽는다 - 요청마다 디스크를 읽지 않고, 그림 크기도 미리 재어 글이 그려진 뒤 밀리지 않게 한다
export const dynamic = "force-static";

export default async function ManualPage() {
  const source = await readManualSource();
  const imageSizes = await readImageSizes(source);
  return <ManualView source={source} imageSizes={imageSizes} />;
}
