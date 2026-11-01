import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-28T23:00:00+01:00',
  job: 'job',
  status: 'ok',
  owner: 'rook',
};

describe('run log reader', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, night + '.jsonl'), events.map((entry) => JSON.stringify(entry)).join('\n'));
  }

  it('reads the real fixture without dropping the missing owner', () => {
    const result = readNight('runs', night);
    expect(result).toMatchObject({ night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });
    expect(result?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
      lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(result?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(result?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
  });

  it('counts malformed JSON and invalid schemas while ignoring blank lines', () => {
    const invalidRows: unknown[] = [
      null, [], 7, 'text', {},
      { ...event, at: 42 }, { ...event, at: 'not a time' },
      { ...event, at: '2026-02-30T00:00:00Z' }, { ...event, at: '2026-10-28T23:00:00' },
      { ...event, job: null }, { ...event, job: '  ' },
      { ...event, status: 'unknown' }, { ...event, owner: undefined },
      { ...event, owner: 1 }, { ...event, error: null }, { ...event, error: 1 },
    ];
    writeFileSync(join(runsDir, night + '.jsonl'), [
      '', '   ', '{broken', ...invalidRows.map((row) => JSON.stringify(row)),
      JSON.stringify({ ...event, owner: null }), '\t', '',
    ].join('\r\n'));
    const result = readNight(runsDir, night);
    expect(result).toMatchObject({ badLines: invalidRows.length + 1, counts: { ok: 1, retry: 0, fail: 0 } });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].owner).toBeNull();
  });

  it('aggregates actual instants out of order and retains the latest error after recovery', () => {
    writeEvents([
      { ...event, at: '2026-10-29T00:30:00+02:00', status: 'retry', error: 'new error' },
      { ...event, at: '2026-10-28T23:00:00Z', owner: null },
      { ...event, at: '2026-10-29T01:00:00+03:00', status: 'fail', error: 'old error' },
      { ...event, at: '2026-10-28T22:15:00Z', status: 'retry', error: 'middle error' },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 2, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok', lastError: 'new error',
        firstAt: '2026-10-29T01:00:00+03:00', lastAt: '2026-10-28T23:00:00Z',
      }],
    });
  });

  it('breaks equal-instant ties by file order without erasing an error', () => {
    writeEvents([
      { ...event, status: 'retry', error: 'first error' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'fail', error: 'last error' },
      { ...event, at: '2026-10-29T00:00:00+02:00', owner: null },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'last error',
      firstAt: event.at, lastAt: '2026-10-29T00:00:00+02:00',
    });
  });

  it('sorts job names deterministically rather than by locale', () => {
    writeEvents(['z', 'a', 'Z', '__proto__', 'A', 'constructor'].map((job) => ({ ...event, job })));
    expect(readNight(runsDir, night)?.rows.map((row) => row.job)).toEqual([
      'A', 'Z', '__proto__', 'a', 'constructor', 'z',
    ]);
  });

  it('returns null for an absent night', () => {
    expect(readNight(runsDir, night)).toBeNull();
  });

  it.each(['', ' \n\t\r\n'])('returns an empty digest for empty or blank content %j', (contents) => {
    writeFileSync(join(runsDir, night + '.jsonl'), contents);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each([
    '../2026-10-28', '..\\2026-10-28', '/2026-10-28', 'C:\\2026-10-28',
    '2026-10-28/../2026-10-28', '2026-10-28.jsonl', '2026-10-28\n',
    '2026-1-28', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01',
    '2026-10-00', '2026-10-32', '%2e%2e%2f2026-10-28', '2026-10-28\0',
  ])('returns null for invalid night %j so routes can return 404 without reading a file', (invalidNight) => {
    writeEvents([event]);
    expect(readNight(runsDir, invalidNight)).toBeNull();
  });

  it('accepts a real leap day', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')?.night).toBe('2024-02-29');
  });

  it('rejects traversal even when a readable log exists outside runsDir', () => {
    writeEvents([event]);
    const nestedDir = join(runsDir, 'nested');
    mkdirSync(nestedDir);
    expect(readNight(nestedDir, '../' + night)).toBeNull();
    expect(readNight(nestedDir, '..\\' + night)).toBeNull();
  });

  it('returns a digest rather than null when every nonblank line is invalid', () => {
    writeEvents([null, {}, []]);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 3, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('propagates IO failures other than a missing file', () => {
    mkdirSync(join(runsDir, night + '.jsonl'));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
