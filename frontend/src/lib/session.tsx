// 로그인 세션 컨텍스트 - 인증 게이트(providers.tsx)가 모드·로그아웃을 주입하고, 여기서 /api/me를 불러 상단 바·홈·관리 화면이 함께 쓴다.
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getMe, type Me } from "@/lib/api";
import type { AuthMode } from "@/lib/auth-mode";

interface SessionValue {
  mode: AuthMode;
  /** 아직 불러오는 중이거나 실패했으면 null */
  me: Me | null;
  /** 마지막 /api/me 실패 원인. 실패가 없으면 null */
  error: unknown;
  /** /api/me를 다시 불러온다(실패 재시도, dev 사용자 전환 뒤). 새 값이 오기 전까지 이전 me는 유지된다. */
  reloadMe: () => void;
  signOut: () => void;
}

interface MeState {
  me: Me | null;
  error: unknown;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  mode,
  signOut,
  children,
}: {
  mode: AuthMode;
  signOut: () => void;
  children: ReactNode;
}) {
  const [state, setState] = useState<MeState>({ me: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    // 사용자를 빠르게 바꾸면 응답이 뒤바뀔 수 있어, 최신 요청 것만 반영한다
    getMe().then(
      (me) => {
        if (alive) setState({ me, error: null });
      },
      (error: unknown) => {
        if (alive) setState({ me: null, error });
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const reloadMe = () => {
    setState((prev) => (prev.error === null ? prev : { me: null, error: null }));
    setReloadKey((key) => key + 1);
  };

  return (
    <SessionContext.Provider value={{ mode, me: state.me, error: state.error, reloadMe, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}

/** AppShell은 me를 불러온 뒤에만 페이지를 그린다 - 페이지는 null 검사 없이 이 훅을 쓴다. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) {
    throw new Error("useMe must be used inside a page rendered by AppShell after /api/me loaded");
  }
  return me;
}
