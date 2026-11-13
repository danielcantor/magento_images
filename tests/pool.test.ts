import { describe, expect, it } from "vitest";
import { runPool } from "@/lib/pool";

describe("runPool", () => {
  it("respeta la concurrencia y procesa todo", async () => {
    let active = 0;
    let max = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      active--;
    });
    expect(max).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("se detiene al cancelar", async () => {
    const ctrl = new AbortController();
    const done: number[] = [];
    await runPool([1, 2, 3, 4], 1, async (n) => {
      done.push(n);
      if (n === 2) ctrl.abort();
    }, ctrl.signal);
    expect(done).toEqual([1, 2]);
  });
});
