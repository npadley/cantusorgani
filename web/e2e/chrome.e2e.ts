import { expect, test } from '@playwright/test';

const readers = [
  '/piece/dominica-i-adventus/',
  '/kyriale/ix/',
  '/ordinary-form/easter/',
  '/vespers/2026-11-29/',
  '/good-friday/',
];

test('the footer keeps its destinations and links to published corrections', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  for (const [name, href] of [
    ['Sources and attributions', '/about/#sources'],
    ['Report an error', '/corrections/'],
    ['Published corrections', '/corrections/log/'],
    ['AI discovery guide', '/llms.txt'],
  ]) {
    await expect(footer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  await footer.getByRole('link', { name: 'Published corrections' }).click();
  await expect(page.getByRole('heading', { name: 'Corrections log', exact: true })).toBeVisible();
});

for (const width of [320, 390]) {
  test(`chrome fits at ${width}px with all header destinations`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/', ...readers]) {
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
      for (const [name, href] of [
        ['Cantus Organi', '/'],
        ['Extraordinary Form (1962) calendar', '/calendar/'],
        ['Ordinary Form calendar', '/calendar/ordinary-form/'],
        ['Search', '/search/'],
        ['About', '/about/'],
        ['Corrections', '/corrections/'],
      ]) {
        const link = nav.getByRole('link', { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', href);
        const box = await link.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await expect(nav.getByRole('button', { name: 'Invert', exact: true })).toBeVisible();
      const grid = nav.locator('.nav-links');
      await expect(grid).toHaveCSS('display', 'grid');
      const positions = await grid.locator(':scope > *').evaluateAll(elements =>
        elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })),
      );
      expect(new Set(positions.map(position => position.x)).size).toBe(3);
      expect(new Set(positions.map(position => position.y)).size).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}

test('Manufacturing Consent is loaded for the wordmark only', async ({ page }) => {
  await page.goto('/');
  const brand = page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Cantus Organi', exact: true });
  await expect(brand).toHaveCSS('font-family', /Manufacturing Consent/);
  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('24px "Manufacturing Consent"', 'Cantus Organi');
    return faces.length > 0 && faces.every(face => face.status === 'loaded');
  });
  expect(loaded).toBe(true);
  await expect(page.locator('h1').first()).not.toHaveCSS('font-family', /Manufacturing Consent/);
  await expect(page.locator('link[rel="preload"][href*="manufacturing-consent"]')).toHaveCount(0);
});

for (const path of readers) {
  test(`skip to music is the first Tab stop on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to music', exact: true });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    const target = await skip.getAttribute('href');
    expect(target).toMatch(/^#/);
    await expect(page.locator(target!)).toHaveCount(1);
  });
}
