// 관리 화면이 공유하는 Tailwind 클래스 묶음 - 버튼·입력·표 머리를 한 곳에서 맞춘다. 색은 디자인 토큰 이름만 쓴다(globals.css @theme).

export const BUTTON_PRIMARY =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent px-3 text-sm font-semibold text-on-accent hover:border-accent-hover hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_SECONDARY =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-line-2 bg-surface px-3 text-sm font-semibold text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_ICON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

const INPUT_BASE =
  "h-8 rounded-md border border-line-2 bg-surface px-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/** 칸 너비를 채우는 입력·선택 */
export const INPUT_FIELD = `w-full ${INPUT_BASE}`;

/** 내용 너비만큼만 차지하는 선택(헤더 옆 필터 등) */
export const INPUT_FIELD_AUTO = INPUT_BASE;

export const TABLE_HEAD_CELL = "px-3 py-2 text-left text-xs font-semibold text-ink-3";

export const TABLE_CELL = "px-3 py-2 align-top text-sm text-ink";

export const CHIP = "inline-flex items-center rounded-sm border border-line bg-sunken px-1.5 py-0.5 text-xs text-ink-2";
