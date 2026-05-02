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
    expect(container.querySelectorAll('.community-card')).toHaveLength(2);
  });

  it('sets img src from mockupUrl', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ mockupUrl: 'https://img.example.com/1.jpg' })]);
    expect(container.querySelector('.product-card__image').getAttribute('src'))
      .toBe('https://img.example.com/1.jpg');
  });

  it('shows creator name', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ creatorName: 'Alice' })]);
    expect(container.querySelector('.product-card__title').textContent).toBe('Alice');
  });

  it('shows "Anonymous" when creatorName is absent', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ creatorName: '' })]);
    expect(container.querySelector('.product-card__title').textContent).toBe('Anonymous');
  });

  it('shows shader name as title-cased group heading', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign({ shader: 'echo-text' })]);
    expect(container.querySelector('.community-card-group__heading').textContent).toBe('Echo Text');
  });

  it('renders a timestamp label', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [makeDesign()]);
    expect(container.querySelector('.community-card__meta').textContent).toMatch(/ago$/);
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
    expect(container.querySelectorAll('.community-card')).toHaveLength(2);
  });

  it('does nothing when designs array is empty', () => {
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, []);
    expect(container.innerHTML).toBe('');
  });
});

// ── card click (default navigation) ──────────────────────────────────────────

describe('card click — default navigation', () => {
  it('navigates to /pages/community-design?id={id}', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ id: 'abc-123' });
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [design]);
    container.querySelector('.community-card').click();
    expect(window.location.href).toBe('/pages/community-design?id=abc-123');
  });

  it('does not write brightfield_restore to localStorage', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ shader: 'echo-text', values: { u_speed: 2 } });
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [design]);
    container.querySelector('.community-card').click();
    expect(localStorage.getItem('brightfield_restore')).toBeNull();
  });

  it('calls onCardClick instead of navigating when provided', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign();
    const container = document.createElement('div');
    const cb = vi.fn();
    window.CommunityDesigns.renderStrip(container, [design], { onCardClick: cb });
    container.querySelector('.community-card').click();
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

// ── buy button → cart add ─────────────────────────────────────────────────────

async function clickBuyAndOrder(container, mockFetch) {
  container.querySelector('.community-designs__buy-btn').click();
  // Wait for product variants fetch to resolve
  await new Promise(resolve => setTimeout(resolve, 0));
  // Find the visible (non-hidden) modal
  const modals = document.querySelectorAll('.mockup-modal');
  const modal = Array.from(modals).find(m => !m.classList.contains('mockup-modal--hidden'));
  const orderBtn = modal && modal.querySelector('.btn--primary');
  if (orderBtn) orderBtn.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  return mockFetch.mock.calls.find(([url]) => url === '/cart/add.js');
}

describe('buy button → cart add', () => {
  afterEach(() => {
    // Remove any modals created during the test
    document.querySelectorAll('.mockup-modal').forEach(el => el.remove());
  });

  it('sends _mockup_url from design.mockupUrl to /cart/add.js', async () => {
    vi.stubGlobal('location', { href: '' });

    const cartItem = { id: 42, properties: { '_mockup_url': 'https://r2.example.com/mockups/uuid.jpg' } };
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('/products/')) {
        return { json: async () => ({ variants: [{ id: 99, title: 'M', available: true }] }) };
      }
      if (url === '/cart/add.js') {
        return { ok: true, json: async () => cartItem };
      }
      return { json: async () => ({}) };
    });
    vi.stubGlobal('fetch', mockFetch);

    const design = makeDesign({ mockupUrl: 'https://r2.example.com/mockups/uuid.jpg', productHandle: 'rise-shirt' });
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [design]);
    document.body.appendChild(container);

    const cartCall = await clickBuyAndOrder(container, mockFetch);
    expect(cartCall).toBeTruthy();
    const body = JSON.parse(cartCall[1].body);
    expect(body.properties['_mockup_url']).toBe('https://r2.example.com/mockups/uuid.jpg');
    expect(body.properties['_design_url']).toBe('https://r2.example.com/mockups/uuid.jpg');
    expect(body.properties['Design Type']).toBe('Community Design');

    document.body.removeChild(container);
  });

  it('falls back to mockup_url (snake_case) when mockupUrl is absent', async () => {
    vi.stubGlobal('location', { href: '' });

    const mockFetch = vi.fn(async (url) => {
      if (url.includes('/products/')) {
        return { json: async () => ({ variants: [{ id: 99, title: 'M', available: true }] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', mockFetch);

    // Design with snake_case field only
    const design = makeDesign({ mockupUrl: undefined, mockup_url: 'https://r2.example.com/mockups/snake.jpg' });
    const container = document.createElement('div');
    window.CommunityDesigns.renderStrip(container, [design]);
    document.body.appendChild(container);

    const cartCall = await clickBuyAndOrder(container, mockFetch);
    expect(cartCall).toBeTruthy();
    const body = JSON.parse(cartCall[1].body);
    expect(body.properties['_mockup_url']).toBe('https://r2.example.com/mockups/snake.jpg');

    document.body.removeChild(container);
  });
});
