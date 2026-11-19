import { describe, expect, it } from "vitest";

import { noteDocRevision, pickDocRevision, sendDocWrite } from "./doc-revision";

// 모듈 상태를 시험끼리 나누지 않게 문서 id를 시험마다 다르게 쓴다
describe("doc-revision", () => {
  it("sends the screen's revision when this tab has written nothing newer", () => {
    expect(pickDocRevision(101, 5)).toBe(5);
  });

  it("sends the newer revision a write reply gave, while the view still holds the old one", async () => {
    // Arrange - 편집 하나가 5 → 6을 돌려줬고 화면은 아직 5를 든다
    const sent: number[] = [];
    const send = (revision: number) => {
      sent.push(revision);
      return Promise.resolve({ document_revision: revision + 1 });
    };
    await sendDocWrite(102, 5, send);

    // Act - 다시 받기 전에 다음 편집
    await sendDocWrite(102, 5, send);

    // Assert
    expect(sent).toEqual([5, 6]);
  });

  it("keeps the larger revision when the view catches up past what this tab knows", () => {
    noteDocRevision(103, 6);
    expect(pickDocRevision(103, 9)).toBe(9);
  });

  it("never lowers a known revision", () => {
    noteDocRevision(104, 8);
    noteDocRevision(104, 7);
    expect(pickDocRevision(104, 1)).toBe(8);
  });

  it("does not note anything when the write is refused", async () => {
    await expect(sendDocWrite(105, 3, () => Promise.reject(new Error("409")))).rejects.toThrow("409");
    expect(pickDocRevision(105, 3)).toBe(3);
  });
});
