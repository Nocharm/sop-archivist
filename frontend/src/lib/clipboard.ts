// 클립보드 복사 — 성공 여부를 돌려준다.
// 서버는 원격 IP + 평문 HTTP(insecure context)라 navigator.clipboard가 아예 없다.
// `navigator.clipboard?.writeText()`로 쓰면 실패를 조용히 삼키므로 이 함수를 거친다.

/**
 * 화면 밖 textarea + execCommand 폴백.
 * execCommand는 사용자 제스처 컨텍스트 안에서 **동기적으로** 불러야 하므로 async가 아니다.
 */
function copyViaTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  // 화면 밖 + 스크롤 점프 방지. readOnly는 iOS 키보드 팝업 방지.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

/** 복사 성공하면 true. 호출부는 이 값을 보고 성공 표시를 낼 것. */
export async function copyText(text: string): Promise<boolean> {
  // insecure context면 navigator.clipboard 자체가 없다 → await 없이 동기 폴백(제스처 컨텍스트 보존)
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return copyViaTextarea(text);
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API가 있는데 거부된 경우(권한 등). await 뒤라 제스처가 풀렸을 수 있어 실패할 수도 있다.
    return copyViaTextarea(text);
  }
}
