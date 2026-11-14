// 가짜 EQUIS 조회 웹훅 - n8n의 dbv-query(table_preview 조건 조회)를 합성 줄로 흉내 낸다. 배선과 화면 확인용이고 실제 EDW 값이 아니다.
// 실행(저장소 루트에서): node frontend/scripts/fake-equis-webhook.mjs
// backend는 N8N_QUERY_URL=http://localhost:9997/webhook/dbv-query EQUIS_EDW_TABLE=edw.EQUIS_DOCUMENT EQUIS_DOC_URL_BASE=https://equis.example 로 띄운다.
// FAKE_EQUIS_DELAY_MS(기본 600)만큼 늦게 답해 "Looking up"을 볼 수 있다. 번호 SOP-ABC-00500은 500으로 답한다(조회 실패 확인).
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_EQUIS_PORT ?? 9997);
const DELAY_MS = Number(process.env.FAKE_EQUIS_DELAY_MS ?? 600);
const FAILING_NUMBER = "SOP-ABC-00500";
const LIFECYCLE = "Draft to Effective Lifecycle";

function makeRow(number, id, version, status, extra = {}) {
  return {
    DOC_DOCUMENT_NUMBER: number,
    DOC_DOCUMENT_ID: id,
    DOC_VERSION: version,
    DOC_VERSION_ID: `${id}_${version.replace(".", "_")}`,
    DOC_DOCUMENT_STATUS: status,
    DOC_LIFECYCLE: LIFECYCLE,
    DOC_DOCUMENT_NAME: "",
    DOC_SUBTYPE: "Standard Operating Procedure (SOP)",
    DOC_OWNING_DEPARTMENT: "Purification",
    DOC_PLANT: "P1, P2, P3",
    DOC_AREA: "Manufacturing Equipment",
    DOC_LEGACY_DOCUMENT_ID: "",
    DOC_EQUIPMENT_TAG_NO: "",
    DOC_EFFECTIVE_DATE_KST: "",
    DOC_OBSOLETE_DATE_KST: "",
    // 실제 표에는 사람 이름 칸이 있다 - 앱이 받는 자리에서 버리는지 확인하려고 합성 이름을 넣는다
    DOC_OWNER: "Synthetic Owner",
    DOC_AUTHOR: "Synthetic Author",
    ...extra,
  };
}

const UV = { DOC_DOCUMENT_NAME: "Operation and Maintenance of UV spectrophotometer", DOC_LEGACY_DOCUMENT_ID: "SOP-ABC-1016" };
const ROWS = [
  makeRow("SOP-ABC-00001", "900001", "13.0", "Superseded", { ...UV, DOC_EFFECTIVE_DATE_KST: "2025-08-29T00:00:00.000Z" }),
  makeRow("SOP-ABC-00001", "900001", "14.0", "Effective", { ...UV, DOC_EFFECTIVE_DATE_KST: "2025-09-17T00:00:00.000Z" }),
  makeRow("SOP-ABC-00001", "900001", "14.1", "Draft", { ...UV, DOC_EFFECTIVE_DATE_KST: "2025-09-17T00:00:00.000Z" }),
  makeRow("SOP-ABC-00001", "900001", "14.2", "In Review", UV),
  makeRow("SOP-ABC-00001", "900001", "15.0", "Authorized", UV),
  makeRow("SOP-ABC-00120", "900120", "5.0", "Superseded", { DOC_DOCUMENT_NAME: "Cleaning of Laboratory Glassware", DOC_AREA: "Quality & Compliance" }),
  makeRow("SOP-ABC-00120", "900120", "6.0", "Effective", { DOC_DOCUMENT_NAME: "Cleaning of Laboratory Glassware", DOC_AREA: "Quality & Compliance", DOC_EFFECTIVE_DATE_KST: "2024-03-11T00:00:00.000Z" }),
  makeRow("SOP-ABC-00052", "900052", "3.0", "Obsolete", { DOC_DOCUMENT_NAME: "Operation of Vacuum System", DOC_OBSOLETE_DATE_KST: "2018-11-21T00:00:00.000Z" }),
];

function pickRows(filters) {
  return ROWS.filter((row) =>
    filters.every(({ column, op, value }) => {
      const cell = String(row[column] ?? "");
      return op === "eq" ? cell === value : cell.includes(value);
    }),
  );
}

createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const filters = Array.isArray(body.filters) ? body.filters : [];
    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    setTimeout(() => {
      if (request.method !== "POST" || body.kind !== "table_preview") return send(404, { message: "not found" });
      if (filters.some((filter) => filter.value === FAILING_NUMBER)) return send(500, { message: "Error in workflow" });
      const where = filters.map((filter) => `[${filter.column}] ${filter.op === "eq" ? "=" : "LIKE"} N'${filter.value}'`).join(" AND ");
      send(200, { query: `SELECT TOP ${body.limit} * FROM [${body.schema}].[${body.table}] WHERE ${where}`, rows: pickRows(filters) });
    }, DELAY_MS);
  });
}).listen(PORT, () => console.log(`fake EQUIS webhook on http://localhost:${PORT}/webhook/dbv-query (delay ${DELAY_MS}ms)`));
