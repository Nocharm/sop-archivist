// 관리 화면·모달이 공유하는 클래스 이름 - 버튼·칩은 앱 공통 부품(components.css .btn·.tag)을 그대로 가리켜 SOP 화면과 모양이 같다. 색은 디자인 토큰 이름만 쓴다(globals.css @theme).

export const BUTTON_PRIMARY = "btn pri";

export const BUTTON_SECONDARY = "btn";

export const BUTTON_ICON = "btn ghost icon";

const INPUT_BASE =
  "h-8 rounded-md border border-line-2 bg-surface px-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/** 칸 너비를 채우는 입력. 값 고르기는 components/ui/select.tsx */
export const INPUT_FIELD = `w-full ${INPUT_BASE}`;

export const CHIP = "tag";
