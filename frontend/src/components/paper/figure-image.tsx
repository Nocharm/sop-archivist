// 용지 위 그림 - 인증 헤더가 필요해 <img src>로 바로 못 받는다. 받아 온 파일을 주소로 바꿔 보이고, 없거나 못 받으면 자리만 둔다.
"use client";

import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { getFigureImage } from "@/lib/api-sop";

export function FigureImage({ bundleId, docId, blockId }: { bundleId: number; docId: number; blockId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    getFigureImage(bundleId, docId, blockId).then(
      (blob) => {
        if (!alive || !blob.type.startsWith("image/")) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      // 받지 못한 그림은 자리 상자로 남긴다 - 원문 글자는 그대로 읽힌다
      () => undefined,
    );
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bundleId, docId, blockId]);

  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- 인증이 필요한 blob 주소라 next/image 최적화를 쓸 수 없다
    <img src={url} alt="" className="max-h-[320px] max-w-full rounded-sm border border-line" data-testid={`figure-${blockId}`} />
  ) : (
    <span className="pfig-box" aria-hidden>
      <ImageIcon size={28} strokeWidth={1.5} />
    </span>
  );
}
