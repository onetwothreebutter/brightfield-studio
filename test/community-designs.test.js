import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/community-designs.js'), 'utf8');
const rdSrc = readFileSync(join(__dirname, '../assets/recent-designs.js'), 'utf8');

function loadModule() {
  delete window.CommunityDesigns;
  delete window.RecentDesigns;
  new Function(rdSrc)(); // eslint-disable-line no-new-func
  new Function(src)();   // eslint-disable-line no-new-func
}

// Build a DOM card matching what community-card.liquid produces
function makeCard(overrides = {}) {
  const opts = {
    shader:       'echo-text',
    submissionId: 'abc-123',
    sourceHandle: 'echo-text-shirt',
    values:       JSON.stringify({ u_speed: 1.5 }),
    liked:        false,
    ...overrides,
  };
  const article = document.createElement('article');
  article.className = 'product-card community-card';
  article.setAttribute('data-shader', opts.shader);

  const actions = document.createElement('div');
  actions.className = 'product-card__actions';

  if (opts.submissionId) {
    const likeBtn = document.createElement('button');
    likeBtn.className = 'btn community-designs__like-btn';
    likeBtn.setAttribute('data-submission-id', opts.submissionId);
    const icon  = document.createElement('span');
    icon.className = 'community-designs__like-icon';
    icon.textContent = '♥';
    const count = document.createElement('span');
    count.className = 'community-designs__like-count';
    count.textContent = '–';
    likeBtn.appendChild(icon);
    likeBtn.appendChild(count);
    actions.appendChild(likeBtn);

    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn community-designs__share-btn';
    shareBtn.setAttribute('data-share-url', 'https://share.brightfield.studio/' + opts.submissionId);
    shareBtn.textContent = '🔗';
    actions.appendChild(shareBtn);
  }

  if (opts.sourceHandle) {
    const custBtn = document.createElement('button');
    custBtn.className = 'btn community-card__customize-btn';
    custBtn.setAttribute('data-source-handle', opts.sourceHandle);
    custBtn.setAttribute('data-shader', opts.shader);
    custBtn.setAttribute('data-values', opts.values);
    actions.appendChild(custBtn);
  }

  article.appendChild(actions);
  return article;
}

beforeEach(() => {
  localStorage.clear();
  loadModule();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── toggleLike() ──────────────────────────────────────────────────────────────

describe('toggleLike()', () => {
  it('POSTs to /community/like with id, deviceId, and deviceToken', async () => {
    const mockFetch = vi.fn(async () => ({ json: async () => ({ likes: 4, liked: true }) }));
    vi.stubGlobal('fetch', mockFetch);

    await window.CommunityDesigns.toggleLike('abc-123', 'device-xyz');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/community/like'),
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ id: 'abc-123', deviceId: 'device-xyz', deviceToken: null });
  });

  it('returns { likes, liked } from response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ likes: 7, liked: false }) })));
    const result = await window.CommunityDesigns.toggleLike('abc-123', 'dev-1');
    expect(result).toEqual({ likes: 7, liked: false });
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await window.CommunityDesigns.toggleLike('abc-123', 'dev-1');
    expect(result).toBeNull();
  });

  // ── Device token (#544) ───────────────────────────────────────────────────
  // See worker/src/index.js authorizeDeviceWrite(): /community/like requires a
  // signed deviceToken once a deviceId has been claimed, and returns a fresh
  // one when it mints a first-time claim for a legacy deviceId.

  it('sends the stored deviceToken (via RecentDesigns), if any', async () => {
    window.RecentDesigns.setDeviceToken('stored-token-abc');
    const mockFetch = vi.fn(async () => ({ json: async () => ({ likes: 1, liked: true }) }));
    vi.stubGlobal('fetch', mockFetch);

    await window.CommunityDesigns.toggleLike('abc-123', 'device-xyz');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.deviceToken).toBe('stored-token-abc');
  });

  it('persists a deviceToken returned in the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ likes: 1, liked: true, deviceToken: 'new-token-xyz' }) })));

    await window.CommunityDesigns.toggleLike('abc-123', 'device-xyz');

    expect(window.CommunityDesigns.getDeviceToken()).toBe('new-token-xyz');
  });
});

// ── groupByShader() ───────────────────────────────────────────────────────────

describe('groupByShader()', () => {
  it('does nothing when container is null', () => {
    expect(() => window.CommunityDesigns.groupByShader(null)).not.toThrow();
  });

  it('does nothing when there is only one shader', () => {
    const container = document.createElement('div');
    container.className = 'product-grid';
    container.appendChild(makeCard({ shader: 'rise-shirt' }));
    container.appendChild(makeCard({ shader: 'rise-shirt' }));
    window.CommunityDesigns.groupByShader(container);
    expect(container.querySelectorAll('.community-card-group')).toHaveLength(0);
  });

  it('wraps cards into groups when multiple shaders are present', () => {
    const container = document.createElement('div');
    container.appendChild(makeCard({ shader: 'rise-shirt' }));
    container.appendChild(makeCard({ shader: 'echo-text' }));
    window.CommunityDesigns.groupByShader(container);
    expect(container.querySelectorAll('.community-card-group')).toHaveLength(2);
  });

  it('renders a heading per shader group', () => {
    const container = document.createElement('div');
    container.appendChild(makeCard({ shader: 'rise-shirt' }));
    container.appendChild(makeCard({ shader: 'echo-text' }));
    window.CommunityDesigns.groupByShader(container);
    const headings = container.querySelectorAll('.community-card-group__heading');
    const texts = Array.from(headings).map(h => h.textContent);
    expect(texts).toContain('Rise Shirt');
    expect(texts).toContain('Echo Text');
  });

  it('puts cards inside the correct group grid', () => {
    const container = document.createElement('div');
    const c1 = makeCard({ shader: 'rise-shirt' });
    const c2 = makeCard({ shader: 'echo-text' });
    const c3 = makeCard({ shader: 'rise-shirt' });
    container.appendChild(c1);
    container.appendChild(c2);
    container.appendChild(c3);
    window.CommunityDesigns.groupByShader(container);
    const groups = container.querySelectorAll('.community-card-group');
    expect(groups[0].querySelectorAll('.community-card')).toHaveLength(2);
    expect(groups[1].querySelectorAll('.community-card')).toHaveLength(1);
  });

  it('preserves first-seen shader order', () => {
    const container = document.createElement('div');
    container.appendChild(makeCard({ shader: 'echo-text' }));
    container.appendChild(makeCard({ shader: 'rise-shirt' }));
    window.CommunityDesigns.groupByShader(container);
    const headings = container.querySelectorAll('.community-card-group__heading');
    expect(headings[0].textContent).toBe('Echo Text');
    expect(headings[1].textContent).toBe('Rise Shirt');
  });
});

// ── hydrateInteractions() — like button ───────────────────────────────────────

describe('hydrateInteractions() — like button', () => {
  it('fetches like count and updates DOM', async () => {
    const card = makeCard({ submissionId: 'abc-123' });
    document.body.appendChild(card);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ likes: 7 }),
    })));

    window.CommunityDesigns.hydrateInteractions();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(card.querySelector('.community-designs__like-count').textContent).toBe('7');
    document.body.removeChild(card);
  });

  it('applies liked class from localStorage on init', () => {
    localStorage.setItem('brightfield_liked', JSON.stringify({ 'abc-123': 1 }));
    loadModule();

    const card = makeCard({ submissionId: 'abc-123' });
    document.body.appendChild(card);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ likes: 3 }) })));
    window.CommunityDesigns.hydrateInteractions();

    expect(card.querySelector('.community-designs__like-btn').classList.contains('community-designs__like-btn--liked')).toBe(true);
    document.body.removeChild(card);
  });

  it('clicking like calls toggleLike and updates count', async () => {
    const card = makeCard({ submissionId: 'abc-123' });
    document.body.appendChild(card);

    const mockFetch = vi.fn(async (url) => {
      if (url.includes('/community/like')) return { json: async () => ({ likes: 5, liked: true }) };
      return { ok: true, json: async () => ({ likes: 3 }) };
    });
    vi.stubGlobal('fetch', mockFetch);

    window.CommunityDesigns.hydrateInteractions();
    await new Promise(resolve => setTimeout(resolve, 0));

    card.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(card.querySelector('.community-designs__like-count').textContent).toBe('5');
    expect(card.querySelector('.community-designs__like-btn').classList.contains('community-designs__like-btn--liked')).toBe(true);
    document.body.removeChild(card);
  });

  it('persists liked state to localStorage', async () => {
    const card = makeCard({ submissionId: 'abc-123' });
    document.body.appendChild(card);

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/community/like')) return { json: async () => ({ likes: 1, liked: true }) };
      return { ok: true, json: async () => ({ likes: 0 }) };
    }));

    window.CommunityDesigns.hydrateInteractions();
    card.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const set = JSON.parse(localStorage.getItem('brightfield_liked'));
    expect(set['abc-123']).toBe(1);
    document.body.removeChild(card);
  });

  it('removes liked state from localStorage on unlike', async () => {
    localStorage.setItem('brightfield_liked', JSON.stringify({ 'abc-123': 1 }));
    loadModule();

    const card = makeCard({ submissionId: 'abc-123' });
    document.body.appendChild(card);

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('/community/like')) return { json: async () => ({ likes: 0, liked: false }) };
      return { ok: true, json: async () => ({ likes: 1 }) };
    }));

    window.CommunityDesigns.hydrateInteractions();
    card.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const set = JSON.parse(localStorage.getItem('brightfield_liked') || '{}');
    expect(set['abc-123']).toBeUndefined();
    document.body.removeChild(card);
  });
});

// ── hydrateInteractions() — customize button ──────────────────────────────────

describe('hydrateInteractions() — customize button', () => {
  it('stores restore payload and redirects to source product', () => {
    const card = makeCard({
      sourceHandle: 'echo-text-shirt',
      shader:       'echo-text',
      values:       JSON.stringify({ u_speed: 2.0 }),
    });
    document.body.appendChild(card);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ likes: 0 }) })));
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { href: '', assign }, writable: true });

    window.CommunityDesigns.hydrateInteractions();
    card.querySelector('.community-card__customize-btn').click();

    const stored = JSON.parse(localStorage.getItem('brightfield_restore'));
    expect(stored.shader).toBe('echo-text');
    expect(stored.values).toEqual({ u_speed: 2.0 });
    expect(window.location.href).toContain('echo-text-shirt');
    expect(window.location.href).toContain('#shader');

    document.body.removeChild(card);
  });
});

// ── getLikedSet / setLikedSet ─────────────────────────────────────────────────

describe('getLikedSet() / setLikedSet()', () => {
  it('returns empty object when nothing stored', () => {
    expect(window.CommunityDesigns.getLikedSet()).toEqual({});
  });

  it('round-trips a set through localStorage', () => {
    window.CommunityDesigns.setLikedSet({ 'id-1': 1, 'id-2': 1 });
    expect(window.CommunityDesigns.getLikedSet()).toEqual({ 'id-1': 1, 'id-2': 1 });
  });
});
