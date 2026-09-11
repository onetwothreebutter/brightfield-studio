import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// snippets/analytics.liquid is one Liquid-rendered config object, the vendor
// loader tags, and a logic script that carries no Liquid. The logic script is
// the unit under test: extracted verbatim and executed against stubbed vendors,
// so what runs here is exactly what ships.

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const liquid = readFileSync(join(ROOT, 'snippets', 'analytics.liquid'), 'utf8');

const match = liquid.match(/<script data-bf-analytics>([\s\S]*?)<\/script>/);
if (!match) throw new Error('Could not find <script data-bf-analytics> in snippets/analytics.liquid');
const logicSrc = match[1];
if (/\{[{%]/.test(logicSrc)) {
  throw new Error('The analytics logic script must not contain Liquid — it is executed verbatim by this test');
}

// The theme-facing surface: only the config object is Liquid-rendered.
function makePosthogStub() {
  return {
    init: vi.fn(),
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn()
  };
}

let docListeners;

function run(config, { posthog = makePosthogStub(), privacy = { analytics: true, marketing: false }, shopify = true } = {}) {
  window.bfAnalyticsConfig = config;
  if (posthog) window.posthog = posthog; else delete window.posthog;
  if (shopify) {
    window.Shopify = {
      loadFeatures: vi.fn((features, cb) => cb(null)),
      customerPrivacy: {
        analyticsProcessingAllowed: () => privacy.analytics,
        marketingAllowed: () => privacy.marketing
      }
    };
  } else {
    delete window.Shopify;
  }
  new Function(logicSrc)();
  return posthog;
}

// The script registers a document listener for visitorConsentCollected. jsdom
// keeps one document for the whole file, so listeners from earlier runs would
// stack up and fire into later tests; capture them instead of letting them
// attach, and dispatch by hand.
function fireConsent(detail) {
  docListeners
    .filter((l) => l.type === 'visitorConsentCollected')
    .forEach((l) => l.fn({ detail }));
}

function consentUpdates() {
  return (window.dataLayer || [])
    .map((args) => Array.from(args))
    .filter((a) => a[0] === 'consent' && a[1] === 'update')
    .map((a) => a[2]);
}

function gaEvents() {
  return (window.dataLayer || [])
    .map((args) => Array.from(args))
    .filter((a) => a[0] === 'event')
    .map((a) => [a[1], a[2]]);
}

beforeEach(() => {
  docListeners = [];
  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn) => {
    docListeners.push({ type, fn });
  });
  delete window.dataLayer;
  delete window.gtag;
  delete window.bfTrack;
  delete window.bfAnalyticsConfig;
  delete window.posthog;
  delete window.Shopify;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BOTH = { ga4: 'G-TEST', posthogKey: 'phc_test', posthogHost: 'https://us.i.posthog.com', designMode: false };

describe('analytics snippet — bfTrack fan-out', () => {
  it('defines a no-op bfTrack when no provider is configured', () => {
    const ph = run({ ga4: null, posthogKey: null, posthogHost: 'https://us.i.posthog.com', designMode: false });
    expect(typeof window.bfTrack).toBe('function');
    expect(() => window.bfTrack('view_item', { shader: 'rise-shirt' })).not.toThrow();
    expect(window.dataLayer).toBeUndefined();
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
    // Nothing to sync consent for, so the Shopify consent API is not even loaded.
    expect(window.Shopify.loadFeatures).not.toHaveBeenCalled();
    expect(docListeners).toHaveLength(0);
  });

  it('sends every event to both providers with the same name and params', () => {
    const ph = run(BOTH);
    window.bfTrack('add_to_cart', { shader: 'rise-shirt', value: 42 });
    expect(gaEvents()).toEqual([['add_to_cart', { shader: 'rise-shirt', value: 42 }]]);
    expect(ph.capture).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledWith('add_to_cart', { shader: 'rise-shirt', value: 42 });
  });

  it('defaults params to an empty object for both providers', () => {
    const ph = run(BOTH);
    window.bfTrack('shader_demo_share');
    expect(gaEvents()).toEqual([['shader_demo_share', {}]]);
    expect(ph.capture).toHaveBeenCalledWith('shader_demo_share', {});
  });

  it('works with only one provider configured', () => {
    const ph = run({ ...BOTH, ga4: '' });
    window.bfTrack('x');
    expect(window.dataLayer).toBeUndefined();
    expect(ph.capture).toHaveBeenCalledWith('x', {});

    const ph2 = run({ ...BOTH, posthogKey: '' });
    window.bfTrack('y');
    expect(ph2.init).not.toHaveBeenCalled();
    expect(gaEvents()).toEqual([['y', {}]]);
  });

  it('a throwing sink does not stop the other provider', () => {
    const ph = run(BOTH);
    // GA4's sink runs first; make it throw and PostHog must still be reached.
    window.dataLayer.push = () => { throw new Error('gtag broke'); };
    expect(() => window.bfTrack('view_item', {})).not.toThrow();
    expect(ph.capture).toHaveBeenCalledWith('view_item', {});
  });

  it('does nothing in the theme editor even when both keys are set', () => {
    const ph = run({ ...BOTH, designMode: true });
    window.bfTrack('x');
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
    expect(window.dataLayer).toBeUndefined();
    expect(window.Shopify.loadFeatures).not.toHaveBeenCalled();
  });

  it('does not throw when a PostHog key is set but the loader stub is absent (blocked CDN)', () => {
    expect(() => run(BOTH, { posthog: null })).not.toThrow();
    expect(() => window.bfTrack('x')).not.toThrow();
    // GA4 still works.
    expect(gaEvents()).toEqual([['x', {}]]);
  });
});

describe('analytics snippet — PostHog init', () => {
  it('initialises opted out of capture and persistence, without session replay', () => {
    const ph = run(BOTH);
    expect(ph.init).toHaveBeenCalledTimes(1);
    const [key, opts] = ph.init.mock.calls[0];
    expect(key).toBe('phc_test');
    expect(opts).toMatchObject({
      api_host: 'https://us.i.posthog.com',
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      opt_out_capturing_persistence_type: 'localStorage',
      disable_session_recording: true,
      capture_pageview: true,
      autocapture: true
    });
  });

  it('honours the configured host and strips a trailing slash', () => {
    const ph = run({ ...BOTH, posthogHost: 'https://eu.i.posthog.com/' });
    expect(ph.init.mock.calls[0][1].api_host).toBe('https://eu.i.posthog.com');
  });

  it('falls back to US Cloud when the host is blank', () => {
    const ph = run({ ...BOTH, posthogHost: null });
    expect(ph.init.mock.calls[0][1].api_host).toBe('https://us.i.posthog.com');
  });
});

describe('analytics snippet — consent sync', () => {
  it('GA4 defaults every Consent Mode signal to denied before config', () => {
    run({ ...BOTH, posthogKey: '' });
    const calls = window.dataLayer.map((a) => Array.from(a));
    const defaultIdx = calls.findIndex((a) => a[0] === 'consent' && a[1] === 'default');
    const configIdx = calls.findIndex((a) => a[0] === 'config');
    expect(defaultIdx).toBeGreaterThanOrEqual(0);
    expect(calls[defaultIdx][2]).toEqual({
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied'
    });
    expect(configIdx).toBeGreaterThan(defaultIdx);
    expect(calls[configIdx][1]).toBe('G-TEST');
  });

  it('applies the already-resolved Shopify decision on load: analytics allowed → PostHog opts in without an $opt_in event', () => {
    const ph = run(BOTH, { privacy: { analytics: true, marketing: false } });
    expect(window.Shopify.loadFeatures).toHaveBeenCalledWith(
      [{ name: 'consent-tracking-api', version: '0.1' }], expect.any(Function)
    );
    expect(ph.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(ph.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: null });
    expect(ph.opt_out_capturing).not.toHaveBeenCalled();
    expect(consentUpdates()).toEqual([{
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'
    }]);
  });

  it('analytics denied on load → PostHog opts out and GA4 stays denied', () => {
    const ph = run(BOTH, { privacy: { analytics: false, marketing: true } });
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(ph.opt_in_capturing).not.toHaveBeenCalled();
    // Shopify's marketing bucket drives the three ad_* signals independently.
    expect(consentUpdates()).toEqual([{
      analytics_storage: 'denied', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted'
    }]);
  });

  it('a loadFeatures error leaves both providers in their denied defaults', () => {
    window.bfAnalyticsConfig = BOTH;
    const ph = makePosthogStub();
    window.posthog = ph;
    window.Shopify = { loadFeatures: vi.fn((f, cb) => cb(new Error('nope'))) };
    new Function(logicSrc)();
    expect(ph.opt_in_capturing).not.toHaveBeenCalled();
    expect(ph.opt_out_capturing).not.toHaveBeenCalled();
    expect(consentUpdates()).toEqual([]);
  });

  it('survives a page with no window.Shopify at all', () => {
    expect(() => run(BOTH, { shopify: false })).not.toThrow();
    // The live consent listener is still registered for a later banner decision.
    expect(docListeners.map((l) => l.type)).toEqual(['visitorConsentCollected']);
  });

  it('re-syncs both providers when the shopper changes consent in the banner', () => {
    const ph = run(BOTH, { privacy: { analytics: true, marketing: false } });
    expect(docListeners.map((l) => l.type)).toEqual(['visitorConsentCollected']);

    fireConsent({ analyticsAllowed: false, marketingAllowed: false });
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(consentUpdates().at(-1)).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied' });

    fireConsent({ analyticsAllowed: true, marketingAllowed: true });
    expect(ph.opt_in_capturing).toHaveBeenCalledTimes(2); // load + re-grant
    expect(consentUpdates().at(-1)).toEqual({
      analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted'
    });
  });

  it('treats a malformed consent event as denied', () => {
    const ph = run(BOTH, { privacy: { analytics: true, marketing: true } });
    fireConsent(undefined);
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(consentUpdates().at(-1)).toMatchObject({ analytics_storage: 'denied' });
  });

  it('a throwing consent listener does not stop the other provider', () => {
    const ph = run(BOTH, { privacy: { analytics: true, marketing: false } });
    // GA4's listener runs first; make it throw and PostHog must still be synced.
    window.dataLayer.push = () => { throw new Error('gtag broke'); };
    expect(() => fireConsent({ analyticsAllowed: false, marketingAllowed: false })).not.toThrow();
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
  });
});

describe('analytics snippet — Liquid surface', () => {
  it('renders the config from theme settings and design mode', () => {
    expect(liquid).toContain('ga4: {{ settings.ga4_measurement_id | json }}');
    expect(liquid).toContain('posthogKey: {{ settings.posthog_project_key | json }}');
    expect(liquid).toContain("posthogHost: {{ settings.posthog_api_host | default: 'https://us.i.posthog.com' | json }}");
    expect(liquid).toContain('designMode: {{ request.design_mode | json }}');
  });

  it('emits each vendor loader only when configured and never in the theme editor', () => {
    expect(liquid).toMatch(/\{%-?\s*if settings\.ga4_measurement_id != blank and request\.design_mode == false\s*-?%\}\s*<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js/);
    expect(liquid).toMatch(/\{%-?\s*if settings\.posthog_project_key != blank and request\.design_mode == false\s*-?%\}[\s\S]*?e\.__SV\|\|\(window\.posthog=e/);
  });

  it('the loader stub queues the methods the logic script calls before array.js arrives', () => {
    const stub = liquid.match(/o="([^"]+)"\.split\(" "\)/);
    expect(stub).not.toBeNull();
    const queued = stub[1].split(' ');
    for (const m of ['init', 'capture', 'opt_in_capturing', 'opt_out_capturing']) {
      expect(queued).toContain(m);
    }
  });

  it('declares the settings the config reads', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'config', 'settings_schema.json'), 'utf8'));
    const ids = schema.flatMap((g) => (g.settings || []).map((s) => s.id));
    expect(ids).toEqual(expect.arrayContaining(['ga4_measurement_id', 'posthog_project_key', 'posthog_api_host']));
  });
});
