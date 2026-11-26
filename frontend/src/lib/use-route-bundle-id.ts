// Assign가 읽는 Bundle id(설계 2026-11-26-practice-page D12) - 맥락 값이 있으면 그것(연습 화면이 -1을 넣는다), 없으면 주소 `/bundles/<id>/…`의 id.
"use client";

import { useParams } from "next/navigation";
import { createContext, useContext } from "react";

export const BundleIdContext = createContext<number | null>(null);

export function useRouteBundleId(): number {
  const fromContext = useContext(BundleIdContext);
  const params = useParams<{ id?: string }>();
  return fromContext ?? Number(params.id);
}
