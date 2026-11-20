import { describe, expect, it } from "vitest";

import { enqueueDocWrite, isDocWriteQueued } from "./doc-write-queue";

/** 밖에서 끝내는 약속 - 응답을 붙잡아 차례를 본다 */
function hold<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("doc write queue (D4)", () => {
  it("sends the second write on a document only after the first answered", async () => {
    const first = hold<string>();
    const order: string[] = [];
    const a = enqueueDocWrite(101, () => {
      order.push("a sent");
      return first.promise;
    });
    const b = enqueueDocWrite(101, async () => {
      order.push("b sent");
      return "b";
    });
    await flush();
    expect(order).toEqual(["a sent"]);
    first.resolve("a");
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["a sent", "b sent"]);
  });

  it("does not let a failed write block the next one", async () => {
    const first = hold<string>();
    const a = enqueueDocWrite(102, () => first.promise);
    const b = enqueueDocWrite(102, async () => "b");
    first.reject(new Error("409"));
    await expect(a).rejects.toThrow("409");
    expect(await b).toBe("b");
  });

  it("runs writes on different documents side by side", async () => {
    const first = hold<string>();
    const sent: number[] = [];
    void enqueueDocWrite(103, () => {
      sent.push(103);
      return first.promise;
    });
    const other = enqueueDocWrite(104, async () => {
      sent.push(104);
      return "other";
    });
    expect(await other).toBe("other");
    expect(sent).toEqual([103, 104]);
    first.resolve("done");
  });

  it("sends at once when the work names no document", async () => {
    let sent = false;
    const done = enqueueDocWrite(null, async () => {
      sent = true;
    });
    expect(sent).toBe(true);
    await done;
  });

  it("clears the document's lane once its last write ends", async () => {
    const first = hold<void>();
    const a = enqueueDocWrite(105, () => first.promise);
    expect(isDocWriteQueued(105)).toBe(true);
    first.resolve();
    await a;
    await flush();
    expect(isDocWriteQueued(105)).toBe(false);
  });
});
