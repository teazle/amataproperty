import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, lstatSync, symlinkSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLayout, rollbackLayout, verifyLayout, assertQuiescent } from '../deploy/bootstrap-release-layout';

test('active auto-recovery timer blocks migration even when app and worker are stopped', () => {
  const processes = [{ name: 'smartprop', status: 'stopped' }, { name: 'scraper-worker', status: 'stopped' }];
  const units = { 'smartprop-articles.service': 'inactive', 'smartprop-articles.timer': 'inactive',
    'smartprop-healthcheck.service': 'inactive', 'smartprop-healthcheck.timer': 'active' };
  expect(() => assertQuiescent(processes, units)).toThrow();
  units['smartprop-healthcheck.timer'] = 'inactive';
  expect(() => assertQuiescent(processes, units)).not.toThrow();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'smartprop-layout-test-'));
  const app = join(root, 'app'); const release = join(root, 'baseline'); const journal = join(root, 'layout.json');
  mkdirSync(app); mkdirSync(join(app, 'storage'));
  writeFileSync(join(app, '.env'), 'test-only-private-state', { mode: 0o600 });
  writeFileSync(join(app, 'storage', 'state.json'), '{"test":true}');
  return { root, app, release, journal };
}

test('move and rollback retain original directory inode, private state bytes and permissions', () => {
  const f = fixture();
  try {
    const inode = statSync(f.app).ino;
    applyLayout(f);
    expect(lstatSync(f.app).isSymbolicLink()).toBe(true);
    expect(statSync(f.app).ino).toBe(inode);
    expect(readFileSync(join(f.app, '.env'), 'utf8')).toBe('test-only-private-state');
    expect(statSync(join(f.app, '.env')).mode & 0o777).toBe(0o600);
    expect(verifyLayout(f.journal).status).toBe('applied');
    rollbackLayout(f.journal);
    expect(lstatSync(f.app).isDirectory()).toBe(true);
    expect(statSync(f.app).ino).toBe(inode);
    expect(readFileSync(join(f.app, 'storage', 'state.json'), 'utf8')).toBe('{"test":true}');
    expect(verifyLayout(f.journal).status).toBe('rolled-back');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('refuses an existing destination without changing original source', () => {
  const f = fixture();
  try {
    mkdirSync(f.release);
    expect(() => applyLayout(f)).toThrow();
    expect(lstatSync(f.app).isDirectory()).toBe(true);
    expect(readFileSync(join(f.app, '.env'), 'utf8')).toBe('test-only-private-state');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rollback refuses an externally changed pointer and leaves both targets intact', () => {
  const f = fixture();
  try {
    applyLayout(f); unlinkSync(f.app); symlinkSync(f.root, f.app);
    expect(() => rollbackLayout(f.journal)).toThrow();
    expect(lstatSync(f.app).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(f.release, '.env'), 'utf8')).toBe('test-only-private-state');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rollback restores original directory after interrupted pointer placement', () => {
  const f = fixture();
  try {
    const j = applyLayout(f);
    unlinkSync(f.app);
    writeFileSync(f.journal, JSON.stringify({ ...j, status: 'prepared' }));
    rollbackLayout(f.journal);
    expect(lstatSync(f.app).isDirectory()).toBe(true);
    expect(statSync(f.app).ino).toBe(j.inode);
    expect(readFileSync(join(f.app, '.env'), 'utf8')).toBe('test-only-private-state');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('journal update failure restores the original tree without truncating the prepared journal', () => {
  const f = fixture();
  const inode = statSync(f.app).ino;
  let writes = 0;
  const injectedWriter = (path: string, contents: string, options: { mode: number; flag: 'w' | 'wx' }) => {
    writes += 1;
    if (writes === 2) {
      writeFileSync(path, '', options);
      expect(JSON.parse(readFileSync(f.journal, 'utf8'))).toEqual(expect.objectContaining({ status: 'prepared' }));
      throw new Error('injected journal update failure');
    }
    writeFileSync(path, contents, options);
  };

  try {
    expect(() => applyLayout(f, { writeJournal: injectedWriter })).toThrow('injected journal update failure');
    expect(lstatSync(f.app).isDirectory()).toBe(true);
    expect(statSync(f.app).ino).toBe(inode);
    expect(readFileSync(join(f.app, '.env'), 'utf8')).toBe('test-only-private-state');
    expect(verifyLayout(f.journal).status).toBe('rolled-back');
    expect(JSON.parse(readFileSync(f.journal, 'utf8'))).toEqual(expect.objectContaining({ status: 'rolled-back' }));
    expect(readdirSync(f.root).filter(name => name.startsWith('layout.json.tmp-'))).toEqual([]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
