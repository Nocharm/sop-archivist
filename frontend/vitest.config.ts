// vitest 설정 — 순수 로직 단위 테스트(node 환경). tsconfig의 `@/*`→`src/*` alias 미러.

import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
  },
});
