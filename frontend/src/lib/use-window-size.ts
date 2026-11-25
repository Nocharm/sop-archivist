// 창 크기(px)를 읽는 훅 - 창 크기에 따라 자리를 다시 셈하는 떠 있는 판이 쓴다.
"use client";

import { useSyncExternalStore } from "react";

interface WindowSize {
  w: number;
  h: number;
}

const SERVER_SIZE: WindowSize = { w: 1440, h: 900 };
// 크기가 그대로면 같은 객체를 돌려준다 - useSyncExternalStore는 스냅숏을 참조로 견준다
let lastSize = SERVER_SIZE;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readSize(): WindowSize {
  if (lastSize.w !== window.innerWidth || lastSize.h !== window.innerHeight) lastSize = { w: window.innerWidth, h: window.innerHeight };
  return lastSize;
}

export function useWindowSize(): WindowSize {
  return useSyncExternalStore(subscribe, readSize, () => SERVER_SIZE);
}
