// 줄 전체가 누름 대상인 목록(표 줄·카드)을 키보드로도 열게 한다 - Tab으로 닿고 Enter·Space로 연다.
import type { KeyboardEvent } from "react";

interface RowOpenProps {
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** 줄에 펼쳐 넣을 속성 - 줄 안의 단추·링크에 포커스가 있을 때는 그 요소의 키를 가로채지 않는다 */
export function getRowOpenProps(onOpen: () => void): RowOpenProps {
  return {
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      // Space의 기본 동작(쪽 내리기)을 막는다
      event.preventDefault();
      onOpen();
    },
  };
}
