// SOP 칸 이름 - 화면 언어와 상관없이 영어(디자인 문서 12절). To-Be와 분류가 같이 쓴다.
import type { SLOT_KEYS } from "./api-sop";

export const SLOT_LABELS: Record<(typeof SLOT_KEYS)[number], string> = {
  purpose: "Purpose",
  scope: "Scope",
  definitions: "Definitions",
  responsibilities: "Responsibilities",
  general_requirements: "General requirements",
  "general_requirements.safety": "Safety",
  "general_requirements.operation": "Operation",
  procedures: "Procedures",
  "procedures.procedure": "Procedure",
  "procedures.electronic_record_control": "Electronic record control",
  "procedures.troubleshooting": "Troubleshooting",
  "procedures.maintenance": "Maintenance",
  document_relationships: "Document relationships",
  "document_relationships.attachments": "Attachments",
  "document_relationships.appendices": "Appendices",
};
