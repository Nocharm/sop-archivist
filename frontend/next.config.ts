import type { NextConfig } from "next";

import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Docker 멀티스테이지 빌드에서 node_modules 없이 실행 가능한 산출물 생성
  output: "standalone",
  // 상단 바 서비스 버전 — package.json "version"을 빌드 때 번들에 인라인한다(main 머지마다 올림, rules/common/git.md)
  env: { APP_VERSION: version },
  // 홈 디렉터리에 package.json이 있는 PC에서 Next가 작업 공간 루트를 홈으로 오인해 홈 전체를 감시하므로
  // 프런트 디렉터리로 고정한다(--webpack 우회 없이 Turbopack 유지).
  turbopack: { root: __dirname },
  // 로컬 네이티브 개발(Docker/nginx 없음)에서 /api를 backend로 프록시.
  // 운영(서버)에서는 nginx가 /api를 backend로 직접 라우팅하므로 이 rewrites에 도달하지 않음.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8777";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
