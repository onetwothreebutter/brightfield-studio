import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/community-designs.js'), 'utf8');

// Also load recent-designs so getDeviceId delegation works
const rdSrc = readFileSync(join(__dirname, '../assets/recent-designs.js'), 'utf8');

function loadModule() {
  delete window.CommunityDesigns;
  delete window.RecentDesigns;
  new Function(rdSrc)(); // eslint-disable-line no-new-func
  new Function(src)();   // eslint-disable-line no-new-func
}

function makeDesign(overrides = {}) {
  return {
    id:            'abc-123',
    shader:        'echo-text',
    mockupUrl:     'https://example.com/mockup.jpg',
    productHandle: 'echo-text-shirt',
    timestamp:     1700000000,
    values:        { u_speed: 1.5 },
    creatorName:   'Jane',
    likes:         3,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  loadModule();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── fetchCommunityDesigns() ───────────────────────────────────────────────────

describe('fetchCommunityDesigns()', () => {
  it('calls /community/list with no args', async () => {
    const mockFetch = vi.fn(async () => ({ json: async () => [] }));
    vi.stubGlobal('fetch', mockFetch);

    await window.CommunityDesigns.fetchCommunityDesigns();
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/community/list'));
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('shader='));
  });

  it('appends ?shader= when shader arg is provided', async () => {
    const mockFetch = vi.fn(async () => ({ json: async () => [] }));
    vi.stubGlobal('fetch', mockFetch);

    await window.CommunityDesigns.fetchCommunityDesigns('rise-shirt');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('shader=rise-shirt'));
  });

  it('returns designs array from response', async () => {
    const designs = [makeDesign()];
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => designs })));

    const result = await window.CommunityDesigns.fetchCommunityDesigns();
    expect(result).toEqual(designs);
  });

  it('returns [] on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await window.CommunityDesigns.fetchCommunityDesigns();
    expect(result).toEqual([]);
  });
});

// ── toggleLike() ──────────────────────────────────────────────────────────────

describe('toggleLike()', () => {
  it('POSTs to /community/like with id and deviceId', async () => {
    const mockFetch = vi.fn(async () => ({ json: async () => ({ likes: 4, liked: true }) }));
    vi.stubGlobal('fetch', mockFetch);

    await window.CommunityDesigns.toggleLike('abc-123', 'device-xyz');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/community/like'),
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ id: 'abc-123', deviceId: 'device-xyz' });
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
});

// ── renderStrip() ─────────────────────────────────────────────────────────────

describe('renderStrip()', () => {
  it('renders one card per design', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign(), makeDesign()]);
    expect(container.querySelectorAll('.community-designs__card')).toHaveLength(2);
  });

  it('sets img src from mockupUrl', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ mockupUrl: 'https://img.example.com/1.jpg' })]);
    expect(container.querySelector('.community-designs__card-img').getAttribute('src'))
      .toBe('https://img.example.com/1.jpg');
  });

  it('shows creator name', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ creatorName: 'Alice' })]);
    expect(container.querySelector('.community-designs__card-name').textContent).toBe('Alice');
  });

  it('shows "Anonymous" when creatorName is absent', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ creatorName: '' })]);
    expect(container.querySelector('.community-designs__card-name').textContent).toBe('Anonymous');
  });

  it('shows shader name with hyphens replaced by spaces', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ shader: 'echo-text' })]);
    expect(container.querySelector('.community-designs__card-shader').textContent).toBe('echo text');
  });

  it('renders a timestamp label', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign()]);
    expect(container.querySelector('.community-designs__card-time').textContent).toMatch(/ago$/);
  });

  it('renders like button with initial count', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ likes: 5 })]);
    expect(container.querySelector('.community-designs__like-count').textContent).toBe('5');
  });

  it('marks like button as liked when id is in localStorage', () => {
    localStorage.setItem('brightfield_liked', JSON.stringify({ 'abc-123': 1 }));
    loadModule();
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123' })]);
    expect(container.querySelector('.community-designs__like-btn').classList.contains('community-designs__like-btn--liked')).toBe(true);
  });

  it('does not mark like button when id is not in localStorage', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123' })]);
    expect(container.querySelector('.community-designs__like-btn').classList.contains('community-designs__like-btn--liked')).toBe(false);
  });

  it('clears previous cards before rendering new ones', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign()]);
    window.CommunityDesigns.renderStrip(container, [makeDesign(), makeDesign()]);
    expect(container.querySelectorAll('.community-designs__card')).toHaveLength(2);
  });

  it('does nothing when designs array is empty', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, []);
    expect(container.innerHTML).toBe('');
  });
});

// ── card click (default navigation) ──────────────────────────────────────────

describe('card click — default navigation', () => {
  it('writes brightfield_restore to localStorage', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ shader: 'echo-text', values: { u_speed: 2 } });
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [design]);
    container.querySelector('.community-designs__card').click();
    const stored = JSON.parse(localStorage.getItem('brightfield_restore'));
    expect(stored).toEqual({ values: design.values, shader: 'echo-text' });
  });

  it('navigates to /products/{productHandle}#shader', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ productHandle: 'echo-text-shirt' });
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [design]);
    container.querySelector('.community-designs__card').click();
    expect(window.location.href).toBe('/products/echo-text-shirt#shader');
  });

  it('calls onCardClick instead of navigating when provided', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign();
    const container = document.createElement('div');
    const cb = vi.fn();
    window.CommunityDesigns.renderStrip(container, [design], { onCardClick: cb });
    container.querySelector('.community-designs__card').click();
    expect(cb).toHaveBeenCalledWith(design, expect.any(Object));
    expect(window.location.href).toBe('');
  });
});

// ── like button click ─────────────────────────────────────────────────────────

describe('like button click', () => {
  it('calls toggleLike and updates count in DOM', async () => {
    const mockFetch = vi.fn(async () => ({ json: async () => ({ likes: 4, liked: true }) }));
    vi.stubGlobal('fetch', mockFetch);

    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123', likes: 3 })]);
    const likeBtn = container.querySelector('.community-designs__like-btn');
    likeBtn.click();

    // Wait for async toggleLike to resolve
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelector('.community-designs__like-count').textContent).toBe('4');
  });

  it('adds liked class after liking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ likes: 4, liked: true }) })));
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123' })]);
    container.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.querySelector('.community-designs__like-btn').classList.contains('community-designs__like-btn--liked')).toBe(true);
  });

  it('persists liked state to localStorage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ likes: 1, liked: true }) })));
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123' })]);
    container.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const set = JSON.parse(localStorage.getItem('brightfield_liked'));
    expect(set['abc-123']).toBe(1);
  });

  it('removes liked state from localStorage on unlike', async () => {
    localStorage.setItem('brightfield_liked', JSON.stringify({ 'abc-123': 1 }));
    loadModule();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ likes: 0, liked: false }) })));
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123' })]);
    container.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const set = JSON.parse(localStorage.getItem('brightfield_liked'));
    expect(set['abc-123']).toBeUndefined();
  });

  it('does not navigate when like button is clicked', async () => {
    vi.stubGlobal('location', { href: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ likes: 1, liked: true }) })));
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ id: 'abc-123' })]);
    container.querySelector('.community-designs__like-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.location.href).toBe('');
  });
});
