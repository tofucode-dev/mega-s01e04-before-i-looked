export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  counts: {
    ok: number;
    retry: number;
    fail: number;
  };
};

export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
