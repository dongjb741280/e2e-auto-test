import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import type { PageSnapshot, ElementInfo } from '../types';

export interface ScrapeOptions {
  page: Page;
  route: string;
  baseUrl: string;
  outputDir: string;
  screenshot?: boolean;
}

/**
 * Extracts interactive elements from a Playwright page.
 * Prioritizes elements with data-testid, then id, then accessible name.
 */
async function extractElements(page: Page): Promise<ElementInfo[]> {
  return page.$$eval(
    'a, button, input, select, textarea, [data-testid], [role="button"], [role="link"], [role="textbox"]',
    (els) =>
      els.map((el) => {
        const tag = el.tagName.toLowerCase();
        const text = (el as HTMLElement).innerText?.trim().slice(0, 100) || '';
        const attrs: Record<string, string> = {};

        const attrList = (el as HTMLElement).attributes;
        for (let i = 0; i < attrList.length; i++) {
          const attr = attrList[i];
          attrs[attr.name] = attr.value;
        }

        // Build recommended selector
        const testId = attrs['data-testid'] || attrs['data-test'];
        let selector: string;

        if (testId) {
          selector = `[data-testid="${testId}"]`;
        } else if (attrs.id) {
          selector = `#${attrs.id}`;
        } else if (attrs.name) {
          selector = `[name="${attrs.name}"]`;
        } else if (attrs['aria-label']) {
          selector = `[aria-label="${attrs['aria-label']}"]`;
        } else if (text && tag === 'button') {
          selector = `button:has-text("${text.slice(0, 50)}")`;
        } else if (text && tag === 'a') {
          selector = `a:has-text("${text.slice(0, 50)}")`;
        } else if (attrs.placeholder) {
          selector = `[placeholder="${attrs.placeholder}"]`;
        } else {
          selector = tag;
        }

        return { tag, text, selector, attributes: attrs, testId };
      })
  );
}

/**
 * Extracts a simplified DOM structure string.
 */
async function extractDOM(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Get main content
    const main =
      document.querySelector('main') ||
      document.querySelector('#app') ||
      document.querySelector('#root') ||
      document.body;
    if (!main) return '';

    // Strip scripts, styles, and comments; get a readable structure
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript, svg, path, [aria-hidden="true"]').forEach((e) => e.remove());

    // Truncate long text content
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    for (const node of textNodes) {
      const trimmed = node.textContent?.trim() || '';
      if (trimmed.length > 200) {
        node.textContent = trimmed.slice(0, 200) + '…';
      }
    }

    const html = clone.outerHTML;
    // Truncate very large DOM to keep it manageable for AI analysis
    if (html.length > 30000) {
      return html.slice(0, 30000) + '\n\n<!-- DOM truncated at 30KB -->';
    }
    return html;
  });
}

/**
 * Scrapes a single page: navigates to it, extracts DOM + interactive elements,
 * optionally takes a screenshot.
 */
export async function scrapePage(options: ScrapeOptions): Promise<PageSnapshot> {
  const { page, route, baseUrl, outputDir, screenshot = true } = options;

  const url = `${baseUrl.replace(/\/$/, '')}${route.startsWith('/') ? route : '/' + route}`;

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
    // If networkidle never settles, proceed with what we have
  });

  // Small wait for any JS rendering to complete
  await page.waitForTimeout(1000);

  const title = await page.title();
  const dom = await extractDOM(page);
  const interactiveElements = await extractElements(page);

  const snapshot: PageSnapshot = {
    route,
    url,
    title,
    dom,
    interactiveElements,
  };

  // Screenshot
  if (screenshot) {
    const safeRoute = route.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_/, '') || 'index';
    const screenshotPath = path.join(outputDir, `${safeRoute}.png`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    snapshot.screenshot = screenshotPath;
  }

  // Save DOM snapshot
  const safeRoute = route.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_/, '') || 'index';
  const domPath = path.join(outputDir, `${safeRoute}.html`);
  fs.writeFileSync(domPath, dom);

  return snapshot;
}

/**
 * Scrapes multiple pages sequentially using a single browser page.
 */
export async function scrapePages(
  page: Page,
  routes: string[],
  baseUrl: string,
  outputDir: string
): Promise<PageSnapshot[]> {
  const snapshots: PageSnapshot[] = [];

  for (const route of routes) {
    const snapshot = await scrapePage({ page, route, baseUrl, outputDir });
    snapshots.push(snapshot);
  }

  return snapshots;
}
