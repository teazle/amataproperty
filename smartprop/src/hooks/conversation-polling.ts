export const CONVERSATION_POLL_INTERVAL_MS = 5_000;

export type ConversationPollingScheduler = {
  setInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (id: unknown) => void;
};

const browserScheduler: ConversationPollingScheduler = {
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
};

export function startConversationPolling(
  fetchConversations: () => Promise<void>,
  scheduler: ConversationPollingScheduler = browserScheduler,
) {
  let disposed = false;
  let isFetching = false;

  const poll = async () => {
    if (disposed || isFetching) return;

    isFetching = true;
    try {
      await fetchConversations();
    } finally {
      isFetching = false;
    }
  };

  void poll();
  const interval = scheduler.setInterval(() => void poll(), CONVERSATION_POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    scheduler.clearInterval(interval);
  };
}
