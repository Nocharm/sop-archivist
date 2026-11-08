# Lessons — 시행착오 방지

형제 프로젝트(bpm)를 6개월 운영하며 실측으로 얻은 교훈 중 이 프로젝트에도 유효한 것만 옮겼다. 프론트 화면이나 검증 스크립트를 건드리기 전에 해당 문서를 먼저 읽을 것.

| 문서 | 언제 읽나 |
|------|-----------|
| [react-ts-patterns.md](react-ts-patterns.md) | useCallback deps/TDZ, ref 미러, `useEffectEvent`(§7), `<Activity>`(§8), 이펙트 내 setState 린트, Tailwind display 클래스 충돌 |
| [browser-verification.md](browser-verification.md) | Playwright + 시스템 Chrome으로 화면을 검증할 때 (dev DB 오염 함정 필독, 워크트리 세션 Bash 제약) |
| [remote-sessions.md](remote-sessions.md) | 클라우드 세션이 연결된 PC 폴더를 다룰 때 (파일 전송 비동기·체크섬 확인, 워크트리 prune 금지, git 삭제 권한, VM의 맥 `node_modules`) |

> 새 교훈은 같은 형식(번호 붙은 짧은 항목 + 실측 근거)으로 이 폴더에 추가하고 이 표에 한 줄 더한다. 설계 기록은 `docs/superpowers/specs/`, 진행 현황은 `PROGRESS.md` 참조.
