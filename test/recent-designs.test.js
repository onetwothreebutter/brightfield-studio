import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/recent-designs.js'), 'utf8');

function loadModule() {
  delete window.RecentDesigns;
  new Function(src)(); // eslint-disable-line no-new-func
}

function makeDesign(overrides = {}) {
  return {
    shader: 'echo-text',
    mockupUrl: 'https://example.com/mockup.jpg',
    productHandle: 'echo-text-shirt',
    timestamp: 1700000000,
    values: { u_speed: 1.5 },
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

// ── getDeviceId() ─────────────────────────────────────────────────────────────

describe('getDeviceId()', () => {
  it('generates a v4 UUID on first call', () => {
    const id = window.RecentDesigns.getDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('persists the UUID to localStorage', () => {
    const id = window.RecentDesigns.getDeviceId();
    expect(localStorage.getItem('brightfield_device_id')).toBe(id);
  });

  it('returns the same UUID on repeated calls', () => {
    const id1 = window.RecentDesigns.getDeviceId();
    const id2 = window.RecentDesigns.getDeviceId();
    expect(id1).toBe(id2);
  });

  it('reuses a UUID already in localStorage', () => {
    localStorage.setItem('brightfield_device_id', 'pre-existing-id');
    expect(window.RecentDesigns.getDeviceId()).toBe('pre-existing-id');
  });
});

// ── fetchDesigns() ────────────────────────────────────────────────────────────

describe('fetchDesigns()', () => {
  it('calls /list-designs with the deviceId in the query string', async () => {
    localStorage.setItem('brightfield_device_id', 'test-device-1');
    const mockFetch = vi.fn(async () => ({ json: async () => [] }));
    vi.stubGlobal('fetch', mockFetch);

    await window.RecentDesigns.fetchDesigns();
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('deviceId=test-device-1'));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/list-designs'));
  });

  it('returns all designs when no shader filter is given', async () => {
    const designs = [makeDesign({ shader: 'echo-text' }), makeDesign({ shader: 'circle-on-line' })];
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => designs })));

    const result = await window.RecentDesigns.fetchDesigns();
    expect(result).toEqual(designs);
  });

  it('filters designs by shader when shader arg is provided', async () => {
    const designs = [makeDesign({ shader: 'echo-text' }), makeDesign({ shader: 'circle-on-line' })];
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => designs })));

    const result = await window.RecentDesigns.fetchDesigns('echo-text');
    expect(result).toHaveLength(1);
    expect(result[0].shader).toBe('echo-text');
  });

  it('returns [] on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await window.RecentDesigns.fetchDesigns();
    expect(result).toEqual([]);
  });
});

// ── renderFilmstrip() ─────────────────────────────────────────────────────────

describe('renderFilmstrip()', () => {
  it('renders one card per design', () => {
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign(), makeDesign()]);
    expect(container.querySelectorAll('.recent-designs__card')).toHaveLength(2);
  });

  it('sets img src from mockupUrl', () => {
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign({ mockupUrl: 'https://mockup.example.com/1.jpg' })]);
    const img = container.querySelector('.recent-designs__card-img');
    expect(img.getAttribute('src')).toBe('https://mockup.example.com/1.jpg');
  });

  it('shows shader name with hyphens replaced by spaces', () => {
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign({ shader: 'echo-text' })]);
    const name = container.querySelector('.recent-designs__card-name');
    expect(name.textContent).toBe('echo text');
  });

  it('renders a timestamp label', () => {
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign()]);
    const time = container.querySelector('.recent-designs__card-time');
    expect(time.textContent).toMatch(/ago$/);
  });

  it('hides the nearest .recent-designs-section ancestor when designs are empty', () => {
    const section = document.createElement('div');
    section.className = 'recent-designs-section';
    const container = document.createElement('div');
    section.appendChild(container);
    document.body.appendChild(section);

    window.RecentDesigns.renderFilmstrip(container, []);
    expect(section.style.display).toBe('none');
    section.remove();
  });

  it('does not throw when designs are empty and there is no section ancestor', () => {
    const container = document.createElement('div');
    expect(() => window.RecentDesigns.renderFilmstrip(container, [])).not.toThrow();
  });

  it('clears previous cards before rendering new ones', () => {
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign()]);
    window.RecentDesigns.renderFilmstrip(container, [makeDesign(), makeDesign()]);
    expect(container.querySelectorAll('.recent-designs__card')).toHaveLength(2);
  });
});

// ── deleteDesign() ────────────────────────────────────────────────────────────

describe('deleteDesign()', () => {
  it('POSTs to /delete-design with id and deviceId', async () => {
    localStorage.setItem('brightfield_device_id', 'test-device-del');
    const mockFetch = vi.fn(async () => ({ json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', mockFetch);

    await window.RecentDesigns.deleteDesign('design-123');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/delete-design'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'design-123', deviceId: 'test-device-del' }),
      })
    );
  });

  it('returns { ok: false } on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await window.RecentDesigns.deleteDesign('design-123');
    expect(result).toEqual({ ok: false });
  });
});

// ── delete button ─────────────────────────────────────────────────────────────

describe('delete button', () => {
  it('renders a delete button on each card', () => {
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign(), makeDesign()]);
    expect(container.querySelectorAll('.recent-designs__card-delete')).toHaveLength(2);
  });

  it('clicking delete removes the card', async () => {
    localStorage.setItem('brightfield_device_id', 'test-device-del');
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true }) })));

    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign({ id: 'abc' }), makeDesign({ id: 'def' })]);

    container.querySelectorAll('.recent-designs__card-delete')[0].click();
    document.querySelector('.delete-confirm-modal:not(.delete-confirm-modal--hidden) .btn--danger').click();
    await new Promise(r => setTimeout(r, 0)); // flush microtasks

    expect(container.querySelectorAll('.recent-designs__card')).toHaveLength(1);
  });

  it('hides the section when deleting the last card', async () => {
    localStorage.setItem('brightfield_device_id', 'test-device-del');
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true }) })));

    const section = document.createElement('div');
    section.className = 'recent-designs-section';
    const container = document.createElement('div');
    section.appendChild(container);
    document.body.appendChild(section);

    window.RecentDesigns.renderFilmstrip(container, [makeDesign({ id: 'only' })]);
    container.querySelector('.recent-designs__card-delete').click();
    document.querySelector('.delete-confirm-modal:not(.delete-confirm-modal--hidden) .btn--danger').click();
    await new Promise(r => setTimeout(r, 0));

    expect(section.style.display).toBe('none');
    section.remove();
  });

  it('clicking delete does not trigger card navigation', async () => {
    vi.stubGlobal('location', { href: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true }) })));

    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [makeDesign({ id: 'xyz', productHandle: 'my-shirt' })]);

    container.querySelector('.recent-designs__card-delete').click();
    await new Promise(r => setTimeout(r, 0));

    expect(window.location.href).toBe('');
  });
});

// ── card click ────────────────────────────────────────────────────────────────

describe('card click', () => {
  it('writes brightfield_restore to localStorage with values and shader', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ shader: 'echo-text', values: { u_speed: 2, u_color_mode: 1 } });
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [design]);

    container.querySelector('.recent-designs__card').click();

    const stored = JSON.parse(localStorage.getItem('brightfield_restore'));
    expect(stored).toEqual({ values: design.values, shader: 'echo-text' });
  });

  it('navigates to /products/{productHandle}#shader', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ productHandle: 'echo-text-shirt' });
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [design]);

    container.querySelector('.recent-designs__card').click();

    expect(window.location.href).toBe('/products/echo-text-shirt#shader');
  });

  it('calls onCardClick with the design instead of navigating when provided', () => {
    vi.stubGlobal('location', { href: '' });
    const design = makeDesign({ shader: 'echo-text', values: { u_speed: 1.5 } });
    const container = document.createElement('div');
    const onCardClick = vi.fn();
    window.RecentDesigns.renderFilmstrip(container, [design], onCardClick);

    container.querySelector('.recent-designs__card').click();

    expect(onCardClick).toHaveBeenCalledWith(design, expect.any(Object));
    expect(window.location.href).toBe('');
  });

  it('each card navigates to its own product', () => {
    vi.stubGlobal('location', { href: '' });
    const container = document.createElement('div');
    window.RecentDesigns.renderFilmstrip(container, [
      makeDesign({ productHandle: 'echo-text-shirt', shader: 'echo-text' }),
      makeDesign({ productHandle: 'line-circle-shirt', shader: 'circle-on-line' }),
    ]);

    container.querySelectorAll('.recent-designs__card')[1].click();
    expect(window.location.href).toBe('/products/line-circle-shirt#shader');
  });
});
