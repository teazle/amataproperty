import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_VALUATION_LOCAL_STATUS_PATH =
  '/var/lib/smartprop/newsletter-valuation-status.json';

export interface ValuationLocalFailureStatus {
  status: 'failed';
  command: 'queue' | 'heartbeat' | 'import' | 'complete' | 'set-project-profile';
  runId?: string;
  itemId?: string;
  recordedAt: string;
  errorCode: 'database_error';
  message: 'database operation failed';
}

export async function writeValuationLocalStatus(
  value: ValuationLocalFailureStatus,
  path = DEFAULT_VALUATION_LOCAL_STATUS_PATH,
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function clearValuationLocalStatus(
  path = DEFAULT_VALUATION_LOCAL_STATUS_PATH,
): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
