// 로컬 개발·스모크용 가짜 AI — OpenAI 호환 /v1/chat/completions, /v1/embeddings, /v1/models를 흉내 낸다. 합성 응답이고 실제 모델이 아니다.
// 실행(저장소 루트에서, Node 24 / 의존성 없음):
//   bash:        node frontend/scripts/fake-ai-server.mjs
//   PowerShell:  node frontend\scripts\fake-ai-server.mjs
//   포트 변경:    PORT=9998 node frontend/scripts/fake-ai-server.mjs   (PowerShell: $env:PORT="9998"; node ...)
// backend는 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS=""
//   임베딩까지 쓰면 EMBED_ENABLED=true EMBED_BASE_URL=http://localhost:9999/v1 EMBED_API_TOKEN=fake EMBED_MODEL=fake
//   (토큰이 비어도 ai_client는 "Bearer " 헤더를 보내 빈 토큰이면 요청 단계에서 실패하니 아무 값이나 넣는다)
// SOP 작업은 사용자 메시지의 data 구간 task로 답한다 — classify=첫 칸 후보+원문 그대로, translate=`[도착 언어] 원문`, match=as_is, split=조각 하나(나누지 않음), unwrap_order=받은 줄 차례를 거꾸로, table_follow=받은 줄 차례 그대로 + 첫 줄 번호 한 칸, grant=줄마다 ID·코드·한글 낱말과 줄에 든 역할 이름.
// FAKE_AI_SPLIT=1이면 classify와 split이 원문을 가운데 빈칸에서 두 문장으로 나눠 답한다 — 화면의 "AI 나눔 제안 확정"·쪼개기 화면의 나누기 제안 경로를 스모크로 밟기 위한 것(기본은 끈다).
// data 구간이 없는 호출에는 {"ok": true}를 답한다 — 관리 화면의 연결 점검(ping) 배선 확인용. 사용량 집계용 usage는 늘 싣는다.
import { createHash } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9999);
const MODEL_ID = "fake";
const REPLY_CONTENT = '{"ok": true}';
const FAKE_REASON = "합성: 가짜 AI 서버의 고정 응답이다.";
const FAKE_RULE_IDS = ["R01"]; // 규칙 문서에 있는 ID — 없는 ID는 backend가 경고로 남긴다
const TEXT_UNIT_KINDS = ["sentence", "heading", "cell_sentence"]; // 고쳐 쓴 문장이 필요한 단위 — 표·그림은 자리만 고른다
const SPLIT_REWRITES = process.env.FAKE_AI_SPLIT === "1";

/** 가운데에 가까운 빈칸에서 둘로 - 빈칸이 없으면 나누지 않는다 */
function splitInTwo(text) {
  const spaces = [...text.matchAll(/ /g)].map((match) => match.index);
  if (spaces.length === 0) return [text];
  const cut = spaces.reduce((best, at) => (Math.abs(at - text.length / 2) < Math.abs(best - text.length / 2) ? at : best));
  return [text.slice(0, cut).trim(), text.slice(cut + 1).trim()].filter(Boolean);
}
// backend app/sop/ai/llm.py wrap_data의 구분 줄 — 여는 줄과 닫는 줄의 nonce가 같아야 한 구간이다
const DATA_BLOCK_RE = /^<<<DATA ([0-9a-f]+)>>>\n(.*)\n<<<END DATA \1>>>$/m;

const TASK_REPLIES = {
  classify(data) {
    const rewrites = {};
    for (const unit of data.units) {
      if (TEXT_UNIT_KINDS.includes(unit.kind)) {
        rewrites[unit.lang] = [...(rewrites[unit.lang] ?? []), ...(SPLIT_REWRITES ? splitInTwo(unit.text) : [unit.text])];
      }
    }
    return {
      candidate: data.candidates[0].key,
      reason: FAKE_REASON,
      rule_ids: FAKE_RULE_IDS,
      evidence: data.units.filter((unit) => unit.text).map((unit) => ({ unit_id: unit.id, quote: unit.text })),
      change_type: "as_is",
      rewrites,
    };
  },
  translate: (data) => ({ text: `[${data.to}] ${data.text}` }),
  match: () => ({ change_type: "as_is", reason: FAKE_REASON, rule_ids: FAKE_RULE_IDS }),
  split: (data) => ({ parts: SPLIT_REWRITES ? splitInTwo(data.text) : [data.text], reason: FAKE_REASON, rule_ids: FAKE_RULE_IDS }),
  // 벗긴 표 줄 순서 - 받은 차례를 거꾸로 답한다(옮길 줄이 생겨 미리 보기 경로를 밟는다)
  unwrap_order: (data) => ({ order: (data.lines ?? []).map((line) => line.id).reverse(), reason: FAKE_REASON }),
  // 한글 표처럼 하기 - 받은 영어 줄 차례를 그대로 두고 첫 줄 번호만 한 칸 고치게 답한다(칩 하나가 서는 경로를 밟는다)
  table_follow: (data) => ({
    actions: (data.lines ?? []).map((line, index) => ({ id: line.id, order: index + 1, ...(index === 0 ? { number: "9.9" } : {}) })),
    reason: FAKE_REASON,
  }),
  // 새 문서 목록 읽기 - 글의 줄마다 첫 문서 번호를 한 줄로 답한다(SOP-…는 SOP, WI-…는 바로 앞 SOP 아래의 WI, 나머지는 종류 없이).
  // 번호 뒤의 글(칸 구분 " | " 다음 칸)을 제목으로 쓴다. 글에 없는 번호 하나를 끼워 서버가 버리는지도 보인다
  tobe_list(data) {
    const docs = [];
    let lastSop = null;
    for (const line of String(data.text ?? "").split("\n")) {
      const code = /(?<![A-Za-z0-9])([A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6})(?![A-Za-z0-9])/.exec(line)?.[1];
      if (!code || docs.some((doc) => doc.code === code)) continue;
      const title = (line.split(" | ")[1] ?? "").trim();
      const docType = code.startsWith("SOP") ? "sop" : code.startsWith("WI") ? "wi" : null;
      if (docType === "sop") lastSop = code;
      docs.push({ code, title, doc_type: docType, parent_code: docType === "wi" ? lastSop : null, is_equipment_sop: false, steps: docType === "wi" ? ["Prepare", "Run"] : [] });
    }
    return { docs: [...docs, { code: "SOP-INVENTED-999", title: "not in the text", doc_type: "sop", parent_code: null, is_equipment_sop: false, steps: [] }] };
  },
  // 부여 지시 읽기 - 줄마다 로그인 ID·부서 코드·2~4자 한글 낱말(역할·동작 말 제외)을 대상으로, 줄에 든 역할 이름·권한 키를 그대로 답한다.
  // 회수 말이 있으면 remove. 이름 맞추기·목록에 없음·동명이인 고르기는 backend와 화면이 하므로 여기서는 글자만 옮긴다
  grant(data) {
    const roles = (data.roles ?? []).map(String);
    const permissions = (data.permissions ?? []).map(String);
    const actionWords = /^(회수|빼기|삭제|제거|추가|부여|주기|부서|부서에|에게|역할|권한)$/;
    const lines = [];
    String(data.text ?? "").split("\n").forEach((raw, index) => {
      const text = raw.trim();
      if (!text) return;
      const lower = text.toLowerCase();
      const foundRoles = roles.filter((role) => lower.includes(role.toLowerCase()));
      const foundPermissions = permissions.filter((key) => text.includes(key));
      const roleWords = new Set(foundRoles.flatMap((role) => role.split(/\s+/)));
      const ids = text.match(/\b[a-z][a-z0-9]*(?:\.[a-z0-9]+)+\b/g) ?? [];
      const codes = text.match(/\b[A-Z]{2,5}-[A-Z0-9]{1,5}\b/g) ?? [];
      const names = (text.match(/[가-힣]{2,4}/g) ?? []).filter((word) => !actionWords.test(word) && !roleWords.has(word));
      const subjects = [...new Set([...ids.filter((id) => !foundPermissions.includes(id)), ...codes, ...names])];
      lines.push({ line: index + 1, action: /회수|빼|삭제|제거|remove|revoke/i.test(text) ? "remove" : "add", subjects, roles: foundRoles, permissions: foundPermissions });
    });
    return { lines };
  },
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, res, handleBody) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: { message: "request body is not valid JSON" } });
      return;
    }
    handleBody(body);
  });
}

function readDataBlock(messages) {
  const user = (messages ?? []).find((message) => message.role === "user");
  const match = typeof user?.content === "string" ? DATA_BLOCK_RE.exec(user.content) : null;
  return match ? JSON.parse(match[2]) : null;
}

function buildReplyContent(messages) {
  const data = readDataBlock(messages);
  const buildReply = TASK_REPLIES[data?.task];
  return buildReply ? JSON.stringify(buildReply(data)) : REPLY_CONTENT;
}

function handleChatCompletions(req, res) {
  readJsonBody(req, res, (request) => {
    sendJson(res, 200, {
      id: "chatcmpl-fake",
      object: "chat.completion",
      model: request.model || MODEL_ID,
      choices: [
        { index: 0, message: { role: "assistant", content: buildReplyContent(request.messages) }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
}

// 글자 해시로 정한 고정 벡터 — 값이 -0.5~0.5라 영벡터가 나오지 않고, 같은 글은 늘 같은 벡터다
function buildEmbedding(text) {
  return [...createHash("sha256").update(text).digest()].map((byte) => byte / 255 - 0.5);
}

function handleEmbeddings(req, res) {
  readJsonBody(req, res, (request) => {
    sendJson(res, 200, {
      object: "list",
      model: request.model || MODEL_ID,
      data: request.input.map((text, index) => ({ object: "embedding", index, embedding: buildEmbedding(text) })),
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
  });
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "POST" && path === "/v1/chat/completions") {
    handleChatCompletions(req, res);
  } else if (req.method === "POST" && path === "/v1/embeddings") {
    handleEmbeddings(req, res);
  } else if (req.method === "GET" && path === "/v1/models") {
    sendJson(res, 200, { object: "list", data: [{ id: MODEL_ID, object: "model" }] });
  } else {
    sendJson(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
  }
});

// 로컬 전용 — 외부에서 닿을 필요가 없으니 루프백에만 연다
server.listen(PORT, "127.0.0.1", () => console.log(`fake ai on http://127.0.0.1:${PORT}/v1`));
