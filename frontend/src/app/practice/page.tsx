// 연습 화면 /practice(설계 2026-11-26-practice-page) - 실제 Assign을 연습 Bundle(-1)로 그리고, 요청은 브라우저 안 가짜 서버가 받는다. 저장되지 않는다.
// 어떤 스위치도 읽지 않는다 - 운영 빌드에서도 늘 있다(D17). 띠 · 말풍선은 틀(PracticeFrame)이 그린다.
"use client";

import AssignPage from "@/app/bundles/[id]/assign/page";
import { PracticeFrame } from "@/components/practice/practice-frame";
import { PRACTICE_BUNDLE_ID } from "@/lib/practice-route";
import { BundleIdContext } from "@/lib/use-route-bundle-id";

export default function PracticePage() {
  return (
    <PracticeFrame>
      <BundleIdContext value={PRACTICE_BUNDLE_ID}>
        <AssignPage />
      </BundleIdContext>
    </PracticeFrame>
  );
}
