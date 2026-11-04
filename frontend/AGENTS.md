<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## This repo — gotchas

- **React Compiler breaks the build on mismatched manual memoization** — a `useCallback`/`useMemo` whose inferred deps differ from the declared array fails `npm run lint`/`build` with `react-hooks/preserve-manual-memoization` (esp. handlers that only call setState — the compiler infers the setter as the dep). Fix: make trivial handlers **plain functions** (let the compiler memoize) or align deps. Also avoid synchronous setState in effects (`react-hooks/set-state-in-effect`) — use a `reloadKey` bump, anchor-derived state, or move the setState into a callback (`requestAnimationFrame` for measurements, `Promise.then` for restores, `ResizeObserver` for size changes; the rule only flags synchronous calls). If that callback's effect depends on a list derived each render, memoize the list or you get an rAF→setState→render loop (`docs/lessons/react-ts-patterns.md` §3).
- **Never put two Tailwind display utilities on one element** (`inline-flex` + `hidden`, `flex` + `hidden`) — which one wins depends on generated CSS order, and `hidden` lost in practice, leaving "hidden" chips clipped but visible. Pick one class conditionally: `${shown ? "inline-flex" : "hidden"}`.
- **Timestamps are KST.** Backend `app/clock.now()` (UTC+9) is the canonical "now". Display via `lib/datetime.formatKst`/`formatKstShort` (Asia/Seoul) — never raw `toLocaleString()`/`getHours()` (browser tz).
- **Generate ids with `genId()` from `@/lib/id`, never `crypto.randomUUID()`** — the server runs over plain HTTP (insecure context) where Web Crypto is undefined. Same reason `crypto.subtle`/PKCE is disabled, and why copying goes through `copyText()` from `@/lib/clipboard`, never `navigator.clipboard`.
- **Quote `--include` globs in zsh** — `grep -rn foo src --include=*.tsx` dies with "no matches found" because zsh expands the glob first; write `--include="*.tsx"`.
