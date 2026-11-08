// 화면이 열릴 때 목록 하나를 불러오는 훅 - 관리 패널이 공유한다. 다시 불러오는 동안과 다시 불러오다 실패했을 때도 이전 데이터를 유지해 목록이 깜박이거나 사라지지 않는다.
"use client";

import { useEffect, useEffectEvent, useState } from "react";

interface LoadedState<T> {
  /** 이 결과가 어느 요청(입력 + 다시 불러오기 횟수)의 것인지 */
  requestKey: string;
  data: T | null;
  error: unknown;
}

export interface Loaded<T> {
  data: T | null;
  /** 가장 최근 요청의 실패 원인. 진행 중이거나 성공했으면 null */
  error: unknown;
  /** 가장 최근 요청이 아직 끝나지 않았는가 */
  isLoading: boolean;
  reload: () => void;
}

/**
 * fetcher는 매 렌더 새 함수여도 된다(이펙트 이벤트로 읽는다). 입력이 바뀌어 다시 불러와야 하면 inputKey를 바꾼다.
 * 응답이 뒤바뀌어도(입력을 빠르게 바꿈) 마지막 요청의 결과만 반영한다.
 */
export function useLoaded<T>(fetcher: () => Promise<T>, inputKey = ""): Loaded<T> {
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<LoadedState<T> | null>(null);
  const requestKey = `${inputKey}#${reloadCount}`;
  const runFetcher = useEffectEvent(fetcher);

  useEffect(() => {
    let alive = true;
    runFetcher().then(
      (data) => {
        if (alive) setState({ requestKey, data, error: null });
      },
      (error: unknown) => {
        // 다시 불러오다 실패해도 이전 데이터는 남긴다 - 화면이 통째로 오류 문구로 바뀌지 않고, 오류는 error로 따로 알린다
        if (alive) setState((prev) => ({ requestKey, data: prev?.data ?? null, error }));
      },
    );
    return () => {
      alive = false;
    };
  }, [requestKey]);

  const isCurrent = state !== null && state.requestKey === requestKey;
  return {
    data: state?.data ?? null,
    error: isCurrent ? state.error : null,
    isLoading: !isCurrent,
    reload: () => setReloadCount((count) => count + 1),
  };
}
