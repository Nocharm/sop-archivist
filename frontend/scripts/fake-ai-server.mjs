// 로컬 개발·스모크용 가짜 AI — OpenAI 호환 /v1/chat/completions, /v1/models만 흉내 낸다(프롬프트를 읽지 않는다).
// 실행(저장소 루트에서, Node 24 / 의존성 없음):
//   bash:        node frontend/scripts/fake-ai-server.mjs
//   PowerShell:  node frontend\scripts\fake-ai-server.mjs
//   포트 변경:    PORT=9998 node frontend/scripts/fake-ai-server.mjs   (PowerShell: $env:PORT="9998"; node ...)
// backend는 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS=""
//   (토큰이 비어도 ai_client는 "Bearer " 헤더를 보내 빈 토큰이면 요청 단계에서 실패하니 아무 값이나 넣는다)
// 항상 {"ok": true}를 답하고 usage를 싣는다 — 관리 화면의 연결 점검(ping)과 사용량 집계 배선 확인용.
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9999);
const MODEL_ID = "fake";
const REPLY_CONTENT = '{"ok": true}';

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function handleChatCompletions(req, res) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let request;
    try {
      request = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: { message: "request body is not valid JSON" } });
      return;
    }
    sendJson(res, 200, {
      id: "chatcmpl-fake",
      object: "chat.completion",
      model: request.model || MODEL_ID,
      choices: [{ index: 0, message: { role: "assistant", content: REPLY_CONTENT }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "POST" && path === "/v1/chat/completions") {
    handleChatCompletions(req, res);
  } else if (req.method === "GET" && path === "/v1/models") {
    sendJson(res, 200, { object: "list", data: [{ id: MODEL_ID, object: "model" }] });
  } else {
    sendJson(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
  }
});

// 로컬 전용 — 외부에서 닿을 필요가 없으니 루프백에만 연다
server.listen(PORT, "127.0.0.1", () => console.log(`fake ai on http://127.0.0.1:${PORT}/v1`));
