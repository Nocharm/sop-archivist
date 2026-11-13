// 결과물 A 옛 위치 표기 - Excel A의 Location 칸(backend sheet_model._format_location)과 같은 글을 화면에도 쓴다.
// 자리 이름(place)은 서버가 라벨 언어로 지어 보낸다 - 여기서는 이어 붙이기만 한다. 규칙을 바꾸면 두 곳을 함께 고친다.
import type { OutputLocation } from "./api-sop";

/** "§5 · Paragraph · p. 3" - 빈 조각은 빼고, 추정 쪽 번호는 "~p." */
export function formatOutputLocation(location: OutputLocation): string {
  const pieces = location.section ? [`§${location.section}`] : [];
  if (location.place) pieces.push(location.place);
  if (location.page !== null) pieces.push(location.page_basis === "estimated" ? `~p. ${location.page}` : `p. ${location.page}`);
  return pieces.join(" · ");
}
