// 두 용지의 빈 곳을 누르면 - 나눌 선이 먼저, 짝 · 캡션 · 이을 상대 고르기가 그다음, 아니면 양쪽 고름과 여럿 고름을 모두 푼다(쪼개기 먼저 §8).
// 박스 · 단추 · 칸 머리 · 글 긁기 · 끌기 · 스크롤 막대 · 떠 있는 판 · 오른쪽 칸은 빈 곳이 아니다(듣는 자리는 .assign-panes 하나, 이펙트 없음).

/** 눌러도 빈 곳이 아닌 자리 - 박스 · 줄 앞머리 · 표 칸 · 삭제 블록 · 접힌 줄 · 틈 단추 · 단추 줄 · 칸 머리 · 단추 · 입력 */
export const BLANK_STOPS = ".strip, .cell-piece, .strip-lead, .toc-block, .deleted-line, .fold-line, .fold-run, .fold-head, .strip-merge, .unwrap-head, .shift-head, .pick-bar, .pane-head, button, a, input, textarea, [role='slider']";

export interface BlankClickState {
  /** 용지 칸(.pane-body) 안이고 스크롤 막대가 아니다 */
  isSheetArea: boolean;
  /** 박스나 BLANK_STOPS의 자리를 눌렀다 */
  isOnBox: boolean;
  hasTextSelection: boolean;
  isDragging: boolean;
  /** 나눌 선이 있다 */
  hasCut: boolean;
  /** 짝 · 캡션 · 이을 상대를 고르는 중이다 */
  isPicking: boolean;
}

export function resolveBlankClick(state: BlankClickState): "none" | "clear_cut" | "end_mode" | "clear_all" {
  if (!state.isSheetArea || state.isOnBox || state.hasTextSelection || state.isDragging) return "none";
  if (state.hasCut) return "clear_cut";
  return state.isPicking ? "end_mode" : "clear_all";
}
