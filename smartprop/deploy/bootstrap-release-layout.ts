/** One-time, user-approved layout maintenance; NOT a qualified release executor. */
import { existsSync, lstatSync, statSync, readFileSync, writeFileSync, renameSync, symlinkSync, readlinkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface LayoutPaths { app: string; release: string; journal: string }
interface Journal extends LayoutPaths { version: 1; inode: number; device: number; status: 'prepared' | 'applied' | 'rolled-back' }
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const QUIET_UNITS = ['smartprop-articles.service', 'smartprop-articles.timer', 'smartprop-healthcheck.service', 'smartprop-healthcheck.timer'];
export function assertQuiescent(processes: Array<{ name: string; status: string }>, units: Record<string, string>): void {
  const affected = processes.filter(p => ['smartprop', 'scraper-worker'].includes(p.name));
  assert(affected.length === 2 && new Set(affected.map(p => p.name)).size === 2 && affected.every(p => p.status === 'stopped'), 'App and worker must be stopped');
  assert(QUIET_UNITS.every(unit => units[unit] === 'inactive'), 'Article and auto-recovery service/timers must be inactive');
}
function present(path: string) { try { lstatSync(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
function readJournal(path: string): Journal {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Journal;
  assert(j.version === 1 && j.journal === path && Number.isSafeInteger(j.inode) && Number.isSafeInteger(j.device), 'Invalid layout journal');
  assert([j.app, j.release, j.journal].every(p => typeof p === 'string' && resolve(p) === p && p !== '/'), 'Invalid journal paths');
  assert(['prepared', 'applied', 'rolled-back'].includes(j.status), 'Invalid journal state');
  return j;
}
function save(j: Journal, exclusive = false) {
  writeFileSync(j.journal, JSON.stringify(j, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
}
function originalDirectory(path: string, j: Journal): boolean {
  if (!present(path)) return false;
  const st = lstatSync(path);
  return st.isDirectory() && st.ino === j.inode && st.dev === j.device;
}
export function applyLayout(paths: LayoutPaths): Journal {
  const { app, release, journal } = paths;
  assert([app, release, journal].every(p => resolve(p) === p && p !== '/'), 'Absolute bounded paths required');
  assert(!release.startsWith(app + '/') && app !== release, 'Release must be outside app tree');
  assert(!journal.startsWith(app + '/') && !journal.startsWith(release + '/'), 'Journal must remain outside relocated tree');
  assert(!present(release) && !present(journal) && !present(app + '.layout-next'), 'Refusing existing migration target');
  const st = lstatSync(app);
  assert(st.isDirectory() && !st.isSymbolicLink(), 'Source must be a real directory');
  assert(statSync(dirname(release)).dev === st.dev && statSync(dirname(app)).dev === st.dev, 'Same filesystem required');
  const j: Journal = { version: 1, app, release, journal, inode: st.ino, device: st.dev, status: 'prepared' };
  save(j, true);
  symlinkSync(release, app + '.layout-next');
  try {
    renameSync(app, release);
    renameSync(app + '.layout-next', app);
    j.status = 'applied'; save(j);
    return verifyLayout(journal);
  } catch (error) {
    rollbackLayout(journal);
    throw error;
  }
}
export function rollbackLayout(path: string): Journal {
  const j = readJournal(path);
  if (originalDirectory(j.app, j) && !present(j.release)) {
    // Already restored, or the move never started.
  } else if (originalDirectory(j.release, j) && !present(j.app)) {
    renameSync(j.release, j.app);
  } else {
    assert(originalDirectory(j.release, j), 'Original release directory identity changed');
    assert(lstatSync(j.app).isSymbolicLink() && readlinkSync(j.app) === j.release, 'App pointer changed externally');
    const oldPointer = j.app + '.layout-rollback';
    assert(!present(oldPointer), 'Rollback staging path already exists');
    renameSync(j.app, oldPointer);
    try { renameSync(j.release, j.app); } catch (error) { renameSync(oldPointer, j.app); throw error; }
    unlinkSync(oldPointer);
  }
  const prepared = j.app + '.layout-next';
  if (present(prepared)) {
    assert(lstatSync(prepared).isSymbolicLink() && readlinkSync(prepared) === j.release, 'Prepared pointer changed externally');
    unlinkSync(prepared);
  }
  j.status = 'rolled-back'; save(j);
  return verifyLayout(path);
}
export function verifyLayout(path: string): Journal {
  const j = readJournal(path);
  if (j.status === 'applied') {
    assert(lstatSync(j.app).isSymbolicLink() && readlinkSync(j.app) === j.release, 'Wrong app pointer');
    assert(originalDirectory(j.release, j) && statSync(j.app).ino === j.inode, 'Relocated directory identity changed');
  } else {
    assert(j.status === 'rolled-back' && originalDirectory(j.app, j) && !present(j.release), 'Layout not settled');
  }
  return j;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, journal, release] = process.argv.slice(2);
  const app = '/opt/smartprop/app/smartprop';
  assert(hostname() === 'vmi3201429' && readFileSync('/etc/machine-id', 'utf8').trim() === 'bfb5b1b8859546f9aac39a4c5bafa616', 'Wrong migration host');
  assert(['apply', 'rollback', 'verify'].includes(mode), 'Use apply, rollback or verify');
  assert(/^\/opt\/smartprop\/backups\/layout-[A-Za-z0-9_-]+\/layout\.json$/.test(journal), 'Unexpected private journal path');
  if (mode !== 'verify') {
    const entries = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })) as Array<{ name: string; pm2_env: { status: string } }>;
    const units = Object.fromEntries(QUIET_UNITS.map(unit => [unit,
      execFileSync('systemctl', ['show', unit, '-p', 'ActiveState', '--value'], { encoding: 'utf8' }).trim()]));
    assertQuiescent(entries.map(p => ({ name: p.name, status: p.pm2_env.status })), units);
  }
  if (mode === 'apply') {
    assert(/^\/opt\/smartprop\/releases\/baseline-[A-Za-z0-9_-]+$/.test(release), 'Unexpected baseline release path');
    assert(existsSync(dirname(journal)), 'Backup directory missing');
    console.log(JSON.stringify(applyLayout({ app, release, journal })));
  } else {
    const j = readJournal(journal);
    assert(j.app === app && /^\/opt\/smartprop\/releases\/baseline-[A-Za-z0-9_-]+$/.test(j.release), 'Journal target is outside approved scope');
    console.log(JSON.stringify(mode === 'verify' ? verifyLayout(journal) : rollbackLayout(journal)));
  }
}
