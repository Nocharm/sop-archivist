// 관리 화면이 공유하는 Tailwind 클래스 묶음 - 버튼·입력·표 머리를 한 곳에서 맞춘다(흰 바탕·회색 단계·악센트 1색).

export const BUTTON_PRIMARY =
  "inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_SECONDARY =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_ICON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50";

const INPUT_BASE =
  "h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/** 칸 너비를 채우는 입력·선택 */
export const INPUT_FIELD = `w-full ${INPUT_BASE}`;

/** 내용 너비만큼만 차지하는 선택(헤더 옆 필터 등) */
export const INPUT_FIELD_AUTO = INPUT_BASE;

export const TABLE_HEAD_CELL = "px-3 py-2 text-left text-xs font-semibold text-gray-500";

export const TABLE_CELL = "px-3 py-2 align-top text-sm text-gray-800";

export const CHIP = "inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700";
