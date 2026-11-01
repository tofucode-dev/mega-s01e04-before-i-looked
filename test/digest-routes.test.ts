import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

const sample = '2026-10-28';
const previous = '2026-10-27';
const sampleJobs = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];
const night = '2026-10-30';

function jsonl(events: unknown[]) {
  return events.map((entry) => JSON.stringify(entry)).join('\n');
}

function htmlJobs(html: string) {
  return [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((match) => match[1]);
}

function rowHtml(html: string, job: string) {
  const start = html.indexOf(`<tr><td>${job}</td>`);
  return start === -1 ? '' : html.slice(start, html.indexOf('</tr>', start));
}

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(value: string, contents: string) {
    writeFileSync(join(runsDir, value + '.jsonl'), contents);
  }

  function copySample(value: string) {
    copyFileSync(join('runs', value + '.jsonl'), join(runsDir, value + '.jsonl'));
  }

  it('serves a sample night as HTML and JSON with the same jobs in the same order', async () => {
    copySample(sample);
    const page = await app.request(`/digest/${sample}`);
    const html = await page.text();
    const api = await app.request(`/api/digest/${sample}`);
    const body = (await api.json()) as DigestNight;

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(html).toContain('digest · 2026-10-28');
    expect(html).toContain('1 malformed line counted, not shown');
    expect(html).not.toMatch(/<script\b/i);

    expect(api.status).toBe(200);
    expect(api.headers.get('content-type')).toMatch(/^application\/json/);
    expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
    expect(body).toMatchObject({ night: sample, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });

    expect(body.rows.map((row) => row.job)).toEqual(sampleJobs);
    expect(htmlJobs(html)).toEqual(sampleJobs);
  });

  it('shows a null owner as an em dash and keeps the offsets, errors and markers', async () => {
    copySample(sample);
    const html = await (await app.request(`/digest/${sample}`)).text();
    const body = (await (await app.request(`/api/digest/${sample}`)).json()) as DigestNight;

    expect(body.rows[0]).toMatchObject({ job: 'digest/render', owner: null, firstAt: '2026-10-29T05:41:09+01:00' });
    expect(rowHtml(html, 'digest/render')).toContain('<td>—</td>');

    expect(body.rows[1]).toMatchObject({
      job: 'fixtures/refresh', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    const refresh = rowHtml(html, 'fixtures/refresh');
    expect(refresh).toContain('<td class="warn">3</td>');
    expect(refresh).toContain('upstream 503');
    expect(refresh).toContain('2026-10-29T01:30:00+01:00');

    expect(body.rows[3]).toMatchObject({ job: 'notes/backup', lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(rowHtml(html, 'notes/backup')).toContain('<td class="warn">fail</td>');
    expect(rowHtml(html, 'lane/sync')).not.toContain('class="warn"');
  });

  it('marks three or more retries and a final failure, but not two retries', async () => {
    const at = (time: string) => `2026-10-30T${time}+01:00`;
    writeNight(night, jsonl([
      { at: at('01:00:00'), job: 'b/three-retries', status: 'retry', owner: 'rook', error: 'busy' },
      { at: at('01:01:00'), job: 'b/three-retries', status: 'retry', owner: 'rook', error: 'busy' },
      { at: at('01:02:00'), job: 'b/three-retries', status: 'retry', owner: 'rook', error: 'busy' },
      { at: at('01:03:00'), job: 'b/three-retries', status: 'ok', owner: 'rook' },
      { at: at('01:00:00'), job: 'a/two-retries', status: 'retry', owner: 'rook', error: 'busy' },
      { at: at('01:01:00'), job: 'a/two-retries', status: 'retry', owner: 'rook', error: 'busy' },
      { at: at('01:02:00'), job: 'a/two-retries', status: 'ok', owner: 'rook' },
      { at: at('01:00:00'), job: 'c/failed', status: 'ok', owner: 'rook' },
      { at: at('01:05:00'), job: 'c/failed', status: 'fail', owner: 'rook', error: 'boom' },
    ]));
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as DigestNight;

    expect(htmlJobs(html)).toEqual(['a/two-retries', 'b/three-retries', 'c/failed']);
    expect(body.rows.map((row) => row.job)).toEqual(['a/two-retries', 'b/three-retries', 'c/failed']);
    expect(body.rows.map((row) => row.retries)).toEqual([2, 3, 0]);

    expect(rowHtml(html, 'a/two-retries')).toContain('<td>2</td>');
    expect(rowHtml(html, 'a/two-retries')).not.toContain('class="warn"');
    expect(rowHtml(html, 'b/three-retries')).toContain('<td class="warn">3</td>');
    expect(rowHtml(html, 'c/failed')).toContain('<td class="warn">fail</td>');
    expect(rowHtml(html, 'c/failed')).toContain('boom');
  });

  it('renders an empty night as nothing ran with no rows', async () => {
    writeNight(night, '');
    const page = await app.request(`/digest/${night}`);
    const html = await page.text();
    const api = await app.request(`/api/digest/${night}`);

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');

    expect(api.status).toBe(200);
    expect(api.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await api.json()).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed lines without dropping valid jobs', async () => {
    const valid = (job: string) => JSON.stringify({ at: '2026-10-30T03:00:00+01:00', job, status: 'ok', owner: 'rook' });
    writeNight(night, [valid('a/valid'), '{broken', valid('b/valid'), '[]'].join('\n'));
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as DigestNight;

    expect(html).toContain('2 malformed lines counted, not shown');
    expect(htmlJobs(html)).toEqual(['a/valid', 'b/valid']);
    expect(body).toMatchObject({ badLines: 2, counts: { ok: 2, retry: 0, fail: 0 } });
    expect(body.rows.map((row) => row.job)).toEqual(['a/valid', 'b/valid']);
  });

  it('keeps the original offset strings and the latest error', async () => {
    writeNight(night, jsonl([
      { at: '2026-10-30T08:00:00+02:00', job: 'offset/check', status: 'retry', owner: 'rook', error: 'first error' },
      { at: '2026-10-30T07:30:00Z', job: 'offset/check', status: 'fail', owner: 'rook', error: 'latest error' },
    ]));
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as DigestNight;

    expect(body.rows).toEqual([{
      job: 'offset/check', owner: 'rook', runs: 2, retries: 1, lastStatus: 'fail', lastError: 'latest error',
      firstAt: '2026-10-30T08:00:00+02:00', lastAt: '2026-10-30T07:30:00Z',
    }]);
    expect(html).toContain('2026-10-30T08:00:00+02:00');
    expect(html).toContain('2026-10-30T07:30:00Z');
    expect(html).toContain('latest error');
    expect(html).not.toContain('first error');
  });

  it.each(['2026-10-30', '2026-02-30', '2026-13-01', '2026-1-28', '2026-10-28.jsonl'])(
    'returns 404 for %s as HTML and JSON',
    async (value) => {
      const page = await app.request(`/digest/${value}`);
      expect(page.status).toBe(404);
      expect(page.headers.get('content-type')).toMatch(/^text\/html/);
      expect(await page.text()).toContain('no digest for this night');

      const api = await app.request(`/api/digest/${value}`);
      expect(api.status).toBe(404);
      expect(api.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await api.json()).toEqual({ error: 'no digest for this night' });
    },
  );

  it('escapes untrusted job, owner and error text in HTML but not in JSON', async () => {
    const job = '<script>alert("job")</script>';
    writeNight(night, jsonl([{
      at: '2026-10-30T02:00:00+01:00', job, status: 'fail',
      owner: '<img src=x onerror=alert(1)>', error: '"><svg onload=alert(1)>',
    }]));
    const page = await app.request(`/digest/${night}`);
    const html = await page.text();
    const api = await app.request(`/api/digest/${night}`);

    expect(page.status).toBe(200);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;svg onload=alert(1)&gt;');

    expect(api.headers.get('content-type')).toMatch(/^application\/json/);
    expect(((await api.json()) as DigestNight).rows[0]).toMatchObject({ job, owner: '<img src=x onerror=alert(1)>' });
  });

  it('links each night on disk to a digest that renders, with its counts', async () => {
    copySample(sample);
    copySample(previous);
    const html = await (await app.request('/')).text();

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 10 · retry 4 · fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('ok 7 · retry 0 · fail 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toMatch(/<script\b/i);

    for (const value of [sample, previous]) {
      expect((await app.request(`/digest/${value}`)).status).toBe(200);
    }
  });
});
