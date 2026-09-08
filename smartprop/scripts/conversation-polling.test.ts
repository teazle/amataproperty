import { describe, expect, test } from "bun:test";

import { startConversationPolling } from "../src/hooks/conversation-polling";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeScheduler() {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];

  return {
    scheduler: {
      setInterval(callback: () => void, delay: number) {
        const id = nextId++;
        callbacks.set(id, callback);
        delays.push(delay);
        return id;
      },
      clearInterval(id: unknown) {
        callbacks.delete(id as number);
      },
    },
    tick() {
      for (const callback of callbacks.values()) callback();
    },
    delays,
  };
}

describe("conversation polling", () => {
  test("loads immediately and skips interval ticks while a fetch is in flight", async () => {
    const pending = deferred();
    const timer = fakeScheduler();
    let calls = 0;

    const stop = startConversationPolling(async () => {
      calls += 1;
      if (calls === 1) await pending.promise;
    }, timer.scheduler);

    expect(calls).toBe(1);
    expect(timer.delays).toEqual([5000]);

    timer.tick();
    timer.tick();
    expect(calls).toBe(1);

    pending.resolve();
    await pending.promise;
    await Promise.resolve();
    timer.tick();
    expect(calls).toBe(2);

    stop();
  });

  test("cleans up the interval so unmounted hooks cannot fetch again", async () => {
    const timer = fakeScheduler();
    let calls = 0;

    const stop = startConversationPolling(async () => {
      calls += 1;
    }, timer.scheduler);
    await Promise.resolve();

    stop();
    timer.tick();

    expect(calls).toBe(1);
  });
});
