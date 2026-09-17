import type { OffWorkOptions } from 'pg-boss';

export type ScraperWorkerRegistration = {
  name: string;
  id: string;
};

type ScraperWorkerShutdownOptions = {
  workers: ScraperWorkerRegistration[];
  offWork: (name: string, options: OffWorkOptions) => Promise<void>;
  stopBoss: () => Promise<void>;
  onBeforeDrain?: () => void;
};

type InstalledScraperWorkerShutdownOptions = ScraperWorkerShutdownOptions & {
  onError?: (error: Error) => void;
};

export function createScraperWorkerShutdown({
  workers,
  offWork,
  stopBoss,
  onBeforeDrain,
}: ScraperWorkerShutdownOptions): () => Promise<void> {
  let draining: Promise<void> | null = null;

  return () => {
    if (draining) return draining;

    onBeforeDrain?.();
    draining = Promise.all(
      workers.map(({ name, id }) => offWork(name, { id, wait: true }))
    ).then(() => stopBoss());
    return draining;
  };
}

export function installScraperWorkerShutdown(options: InstalledScraperWorkerShutdownOptions): () => void {
  const shutdown = createScraperWorkerShutdown(options);
  let failureReported = false;

  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      if (failureReported) return;
      failureReported = true;
      const failure = error instanceof Error ? error : new Error(String(error));
      if (options.onError) {
        options.onError(failure);
        return;
      }
      console.error('[ScraperWorker] Shutdown drain failed; leaving Boss running', failure);
      process.exitCode = 1;
    });
  };

  process.on('SIGTERM', handleSignal);
  process.on('SIGINT', handleSignal);

  return () => {
    process.removeListener('SIGTERM', handleSignal);
    process.removeListener('SIGINT', handleSignal);
  };
}
