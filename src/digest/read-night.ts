import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, DigestStatus, ReadNight } from './types.js';

type LogEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

type Aggregate = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  errorTime: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isLogEvent(value: unknown): value is LogEvent {
  return isRecord(value)
    && typeof value.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
    && isNight(value.at.slice(0, 10))
    && Number.isFinite(Date.parse(value.at))
    && typeof value.job === 'string' && value.job.trim().length > 0
    && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && (value.owner === null || typeof value.owner === 'string')
    && (value.error === undefined || typeof value.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, night + '.jsonl'), 'utf8');
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }

  const result: DigestNight = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, Aggregate>();

  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      result.badLines += 1;
      continue;
    }
    if (!isLogEvent(event)) {
      result.badLines += 1;
      continue;
    }

    result.counts[event.status] += 1;
    const time = Date.parse(event.at);
    const aggregate = jobs.get(event.job);
    if (!aggregate) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: time,
        lastTime: time,
        errorTime: event.error === undefined ? -Infinity : time,
      });
      continue;
    }

    aggregate.row.runs += 1;
    if (event.status === 'retry') aggregate.row.retries += 1;
    if (time < aggregate.firstTime) {
      aggregate.firstTime = time;
      aggregate.row.firstAt = event.at;
    }
    if (time >= aggregate.lastTime) {
      aggregate.lastTime = time;
      aggregate.row.lastAt = event.at;
      aggregate.row.lastStatus = event.status;
      aggregate.row.owner = event.owner;
    }
    if (event.error !== undefined && time >= aggregate.errorTime) {
      aggregate.errorTime = time;
      aggregate.row.lastError = event.error;
    }
  }

  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return result;
};
