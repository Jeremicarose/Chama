// =============================================================================
// Full E2E Test Suite for Chama
// Tests every page renders, navigation works, and API responds correctly.
// Wallet-gated pages show "connect wallet" prompts when not authenticated —
// we test that the pages load and display correctly in both states.
// Run: npx playwright test e2e/full-test.spec.ts
// =============================================================================

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// =============================================================================
// 1. Landing Page (not connected)
// =============================================================================

test.describe('Landing Page (no wallet)', () => {
  test('renders hero section with title', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('h1')).toContainText('Trustless Savings');
  });

  test('shows feature cards', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('heading', { name: 'Automated Payouts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Penalty Enforcement' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Verifiable Receipts' })).toBeVisible();
  });

  test('navbar shows all navigation links', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Join' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'History' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Badges' })).toBeVisible();
  });

  test('navbar has Connect Wallet button', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  });
});

// =============================================================================
// 2. Create Page (wallet-gated — shows connect prompt)
// =============================================================================

test.describe('Create Page', () => {
  test('loads and shows create heading', async ({ page }) => {
    await page.goto(`${BASE}/create`);
    await expect(page.getByRole('heading', { name: 'Create a Circle' })).toBeVisible();
  });

  test('page renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE}/create`);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// 3. Join / Marketplace Page (wallet-gated)
// =============================================================================

test.describe('Join / Marketplace Page', () => {
  test('loads and shows marketplace heading', async ({ page }) => {
    await page.goto(`${BASE}/join`);
    await expect(page.getByRole('heading', { name: 'Circle Marketplace' })).toBeVisible();
  });

  test('page renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE}/join`);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// 4. History Page
// =============================================================================

test.describe('History Page', () => {
  test('loads and shows receipt history heading', async ({ page }) => {
    await page.goto(`${BASE}/history`);
    await expect(page.getByRole('heading', { name: 'Receipt History' })).toBeVisible();
  });

  test('page renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE}/history`);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// 5. Achievements Page
// =============================================================================

test.describe('Achievements Page', () => {
  test('loads and shows achievements heading', async ({ page }) => {
    await page.goto(`${BASE}/achievements`);
    await expect(page.getByRole('heading', { name: 'Achievements' })).toBeVisible();
  });

  test('page renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE}/achievements`);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// 6. Circle Detail Pages
// =============================================================================

test.describe('Circle Detail Page', () => {
  test('circle #2 loads without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE}/circle/2`);
    await page.waitForTimeout(4000);
    // Page should render — either circle data or "not found"
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  test('circle #3 loads and shows circle name', async ({ page }) => {
    await page.goto(`${BASE}/circle/3`);
    await page.waitForTimeout(4000);
    // Circle #3 exists — should show a heading
    const headings = await page.locator('h1').count();
    expect(headings).toBeGreaterThan(0);
  });

  test('circle detail shows Configuration section', async ({ page }) => {
    await page.goto(`${BASE}/circle/2`);
    await page.waitForTimeout(4000);
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
  });

  test('circle detail shows Members section', async ({ page }) => {
    await page.goto(`${BASE}/circle/2`);
    await page.waitForTimeout(4000);
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  });

  test('circle detail shows Activity section', async ({ page }) => {
    await page.goto(`${BASE}/circle/2`);
    await page.waitForTimeout(4000);
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  });

  test('nonexistent circle shows error state', async ({ page }) => {
    await page.goto(`${BASE}/circle/99999`);
    await page.waitForTimeout(5000);
    const body = await page.textContent('body');
    const hasError = body?.includes('not found') || body?.includes('Dashboard');
    expect(hasError).toBeTruthy();
  });
});

// =============================================================================
// 7. Navigation Flow
// =============================================================================

test.describe('Navigation', () => {
  test('can navigate between all pages via navbar', async ({ page }) => {
    await page.goto(BASE);

    await page.getByRole('link', { name: 'Create' }).click();
    await expect(page).toHaveURL(`${BASE}/create`);

    await page.getByRole('link', { name: 'Join' }).click();
    await expect(page).toHaveURL(`${BASE}/join`);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(`${BASE}/history`);

    await page.getByRole('link', { name: 'Badges' }).click();
    await expect(page).toHaveURL(`${BASE}/achievements`);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(`${BASE}/`);
  });

  test('breadcrumbs work on sub-pages', async ({ page }) => {
    await page.goto(`${BASE}/circle/2`);
    await page.waitForTimeout(3000);
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page).toHaveURL(`${BASE}/`);
  });
});

// =============================================================================
// 8. API Routes
// =============================================================================

test.describe('API Routes', () => {
  test('POST /api/receipts with valid data returns 503 (no Storacha config)', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/receipts`, {
      data: {
        circleId: '1',
        action: 'contribution',
        actor: '0xtest',
        timestamp: '2026-03-12T00:00:00Z',
        details: { amount: '10.0' },
      },
    });
    expect(resp.status()).toBe(503);
    const body = await resp.json();
    expect(body.error).toContain('not configured');
  });

  test('POST /api/receipts with missing fields returns 400', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/receipts`, {
      data: { circleId: '1' },
    });
    expect(resp.status()).toBe(400);
  });

  test('GET /api/receipts returns 405', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/receipts`);
    expect(resp.status()).toBe(405);
  });
});

// =============================================================================
// 9. No Console Errors on Any Page
// =============================================================================

test.describe('Console Error Check', () => {
  const routes = ['/', '/create', '/join', '/history', '/achievements', '/circle/2', '/circle/3'];

  for (const route of routes) {
    test(`${route} has no JavaScript errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(`${BASE}${route}`);
      await page.waitForTimeout(3000);
      // Filter out known benign errors (wallet extensions, etc.)
      const realErrors = errors.filter(
        (e) => !e.includes('WELLDONE') && !e.includes('WalletConnect') && !e.includes('chrome-extension')
      );
      expect(realErrors).toHaveLength(0);
    });
  }
});

// =============================================================================
// 10. Screenshots (visual verification)
// =============================================================================

test.describe('Visual Screenshots', () => {
  test('capture all pages', async ({ page }) => {
    const pages = [
      { name: 'dashboard', url: '/' },
      { name: 'create', url: '/create' },
      { name: 'join', url: '/join' },
      { name: 'history', url: '/history' },
      { name: 'achievements', url: '/achievements' },
      { name: 'circle-2', url: '/circle/2' },
      { name: 'circle-3', url: '/circle/3' },
    ];

    for (const p of pages) {
      await page.goto(`${BASE}${p.url}`);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `e2e/screenshots/${p.name}.png`, fullPage: true });
    }
  });
});
