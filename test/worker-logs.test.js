// @vitest-environment node
//
// Coverage for the PostHog Logs path in the worker — otlpLogRecord/
// otlpLogPayload (the OTLP/HTTP JSON body), phLog (mirror + buffer) and
// flushPhLogs (one batch per invocation). PostHog Logs is a plain OTLP
// endpoint, so what is asserted here is the wire format: get it wrong and
// ingestion accepts the request and drops the records.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// phLogBuffer is module-level state, so every test gets a fresh module rather
// than inheriting the previous test's un-flushed records.
let otlpLogRecord, otlpLogPayload, phLog, flushPhLogs;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../worker/src/index.js');
  ({ otlpLogRecord, otlpLogPayload, phLog, flushPhLogs } = mod);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ENV = { POSTHOG_PROJECT_KEY: 'phc_test' };

function mockFetch(impl = async () => new Response('{}', { status: 200 })) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function bodyOf(fetchMock, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

function recordsOf(fetchMock, call = 0) {
  return bodyOf(fetchMock, call).resourceLogs[0].scopeLogs[0].logRecords;
}

describe('otlpLogRecord', () => {
  it('maps each level onto its OTel severity number', () => {
    const levels = { trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21 };
    for (const [level, number] of Object.entries(levels)) {
      const rec = otlpLogRecord(level, 'msg');
      expect(rec.severityNumber).toBe(number);
      expect(rec.severityText).toBe(level.toUpperCase());
    }
  });

  it('falls back to info for a level it does not know', () => {
    expect(otlpLogRecord('verbose', 'msg').severityNumber).toBe(9);
  });

  it('reports the time in nanoseconds', () => {
    expect(otlpLogRecord('info', 'msg', {}, 1757600000000).timeUnixNano).toBe('1757600000000000000');
  });

  it('sends every attribute as a string', () => {
    const rec = otlpLogRecord('warn', 'msg', { status: 429, retried: true, name: '#1001' });
    expect(rec.attributes).toEqual([
      { key: 'status', value: { stringValue: '429' } },
      { key: 'retried', value: { stringValue: 'true' } },
      { key: 'name', value: { stringValue: '#1001' } },
    ]);
  });

  // An absent distinct_id is the normal case on an order-paid log (Shop Pay,
  // declined consent). It must not arrive as the text "null".
  it('drops null and undefined attributes rather than stringifying them', () => {
    const rec = otlpLogRecord('error', 'msg', { posthogDistinctId: null, error: undefined, orderName: '#1001' });
    expect(rec.attributes).toEqual([{ key: 'orderName', value: { stringValue: '#1001' } }]);
  });

  it('stringifies a non-string body', () => {
    expect(otlpLogRecord('info', 42).body).toEqual({ stringValue: '42' });
  });
});

describe('otlpLogPayload', () => {
  it('names the service on the resource', () => {
    const payload = otlpLogPayload([otlpLogRecord('info', 'msg')]);
    expect(payload.resourceLogs[0].resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'brightfield-worker' } },
    ]);
    expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
  });
});

describe('phLog', () => {
  it('mirrors to the console at the matching severity', () => {
    phLog({}, 'error', 'broke');
    phLog({}, 'warn', 'suspicious');
    phLog({}, 'info', 'fine');
    expect(console.error).toHaveBeenCalledWith('broke');
    expect(console.warn).toHaveBeenCalledWith('suspicious');
    expect(console.log).toHaveBeenCalledWith('fine');
  });

  it('appends the attributes to the console line when there are any', () => {
    phLog({}, 'error', 'broke', { orderName: '#1001' });
    expect(console.error).toHaveBeenCalledWith('broke', '{"orderName":"#1001"}');
  });

  // The console mirror is the whole point of the fallback: with no project key
  // the worker logs exactly as it did before any of this existed.
  it('still writes to the console with no project key, and sends nothing', async () => {
    const f = mockFetch();
    phLog({}, 'error', 'broke');
    await flushPhLogs({});
    expect(console.error).toHaveBeenCalledWith('broke');
    expect(f).not.toHaveBeenCalled();
  });

  it('never throws on an un-stringifiable attribute', () => {
    const circular = {}; circular.self = circular;
    expect(() => phLog(ENV, 'error', 'broke', { bad: { toString() { throw new Error('nope'); } } })).not.toThrow();
    expect(() => phLog(ENV, 'error', 'broke', circular)).not.toThrow();
    expect(console.error).toHaveBeenLastCalledWith('broke', '[unserializable attributes]');
  });

  it('stops buffering past the cap instead of growing without bound', async () => {
    const f = mockFetch();
    for (let i = 0; i < 250; i++) phLog(ENV, 'error', `line ${i}`);
    await flushPhLogs(ENV);
    const records = recordsOf(f);
    expect(records).toHaveLength(200);
    // The first error in a cascade is the one worth having, so the cap drops
    // the newest rather than rotating the oldest out.
    expect(records[0].body.stringValue).toBe('line 0');
    expect(records[199].body.stringValue).toBe('line 199');
  });
});

describe('flushPhLogs', () => {
  it('posts one batch to the OTLP endpoint with the project key as a bearer token', async () => {
    const f = mockFetch();
    phLog(ENV, 'error', 'first');
    phLog(ENV, 'warn', 'second');
    await flushPhLogs(ENV);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/i/v1/logs');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer phc_test');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(recordsOf(f).map((r) => r.body.stringValue)).toEqual(['first', 'second']);
  });

  it('honours POSTHOG_API_HOST, trailing slash and all', async () => {
    const f = mockFetch();
    const env = { ...ENV, POSTHOG_API_HOST: 'https://eu.i.posthog.com/' };
    phLog(env, 'info', 'hello');
    await flushPhLogs(env);
    expect(f.mock.calls[0][0]).toBe('https://eu.i.posthog.com/i/v1/logs');
  });

  it('sends nothing when there is nothing buffered', async () => {
    const f = mockFetch();
    await flushPhLogs(ENV);
    expect(f).not.toHaveBeenCalled();
  });

  it('drains the buffer, so a second flush is a no-op', async () => {
    const f = mockFetch();
    phLog(ENV, 'error', 'once');
    await flushPhLogs(ENV);
    await flushPhLogs(ENV);
    expect(f).toHaveBeenCalledTimes(1);
  });

  // Records logged while a batch is in flight belong to the next batch, not to
  // the one that already went out — and must not be lost to the swap.
  it('keeps records logged during a flush for the next one', async () => {
    // Only the first send is held open; the second resolves at once, so the
    // test is waiting on the buffer swap and not on its own mock.
    let release;
    const f = mockFetch(() => (f.mock.calls.length === 1
      ? new Promise((resolve) => { release = () => resolve(new Response('{}', { status: 200 })); })
      : Promise.resolve(new Response('{}', { status: 200 }))));
    phLog(ENV, 'error', 'batch one');
    const first = flushPhLogs(ENV);
    phLog(ENV, 'error', 'batch two');
    release();
    await first;
    await flushPhLogs(ENV);

    expect(f).toHaveBeenCalledTimes(2);
    expect(recordsOf(f, 0).map((r) => r.body.stringValue)).toEqual(['batch one']);
    expect(recordsOf(f, 1).map((r) => r.body.stringValue)).toEqual(['batch two']);
  });

  it('hands the send to waitUntil when a context is available', async () => {
    mockFetch();
    const ctx = { waitUntil: vi.fn() };
    phLog(ENV, 'error', 'broke');
    await flushPhLogs(ENV, ctx);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  // A logging failure that can fail a request is worse than no logging.
  it('swallows a rejected send', async () => {
    mockFetch(async () => { throw new Error('network down'); });
    phLog(ENV, 'error', 'broke');
    await expect(flushPhLogs(ENV)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[logs] PostHog log flush failed:', 'network down');
  });

  it('swallows a rejection from PostHog and does not re-buffer it', async () => {
    const f = mockFetch(async () => new Response('bad request', { status: 400 }));
    phLog(ENV, 'error', 'broke');
    await flushPhLogs(ENV);
    expect(console.error).toHaveBeenCalledWith('[logs] PostHog rejected log batch (status', '400)');
    // A failed flush logging into the buffer it just drained would become the
    // next flush's payload, and a persistent failure would log about itself
    // forever.
    await flushPhLogs(ENV);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
