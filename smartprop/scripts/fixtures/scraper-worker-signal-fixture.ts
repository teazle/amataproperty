import { installScraperWorkerShutdown } from '../../src/lib/queue/scraper-worker-lifecycle';

let releaseActiveJob!: () => void;
const keepAlive = setInterval(() => {}, 1_000);
const activeJob = new Promise<void>((resolve) => {
  releaseActiveJob = resolve;
});

installScraperWorkerShutdown({
  workers: [
    { name: 'scraper-jobs', id: 'main-worker' },
    { name: 'scraper-jobs-dlq', id: 'dlq-worker' },
  ],
  offWork: async (name, options) => {
    console.log(`offWork:${name}:${options.id}:${options.wait}`);
    if (name === 'scraper-jobs') await activeJob;
  },
  stopBoss: async () => {
    console.log('stopBoss');
    clearInterval(keepAlive);
  },
  onError: (error) => {
    console.error(`shutdown-error:${error.message}`);
    process.exitCode = 1;
  },
});

process.stdin.on('data', (chunk) => {
  if (chunk.toString().trim() === 'release') releaseActiveJob();
});

console.log('ready');
