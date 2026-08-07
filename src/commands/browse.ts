import fs from 'fs';
import path from 'path';
import { launchBrowser, closeBrowser } from '../browser/manager';
import { scrapePages } from '../browser/page-scraper';
import type { PageSnapshot, ProjectConfig } from '../types';

export interface BrowseCommandOptions {
  baseUrl: string;
  pages: string[];
  output?: string;
  headed?: boolean;
  /** Auto-login credentials from project config */
  login?: ProjectConfig['login'];
}

export async function browseCommand(options: BrowseCommandOptions): Promise<void> {
  const { baseUrl, pages, headed = false } = options;
  const outputDir = options.output || path.join(process.cwd(), 'test-output', 'pages');

  if (pages.length === 0) {
    console.log('No pages specified. Use --pages to provide page routes (e.g., --pages /,/login,/dashboard)');
    return;
  }

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Pages: ${pages.join(', ')}`);

  const instance = await launchBrowser({ headless: !headed });

  try {
    // Auto-login if credentials are configured
    if (options.login) {
      const { login } = options;
      console.log(`  Auto-login: ${baseUrl}${login.url}`);
      await instance.page.goto(`${baseUrl}${login.url}`, { waitUntil: 'networkidle' });
      await instance.page.fill(login.selectors.username, login.credentials.username);
      await instance.page.fill(login.selectors.password, login.credentials.password);
      await instance.page.click(login.selectors.submit);
      await instance.page.waitForLoadState('networkidle');
      console.log('  Login completed');
    }

    const snapshots = await scrapePages(instance.page, pages, baseUrl, outputDir);

    // Save summary
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'pages.json'),
      JSON.stringify(snapshots, null, 2)
    );

    console.log(`\nScraped ${snapshots.length} page(s):`);
    for (const s of snapshots) {
      const elemCount = s.interactiveElements.length;
      const hasScreenshot = s.screenshot ? ' [screenshot]' : '';
      console.log(`  ${s.route} → "${s.title}" (${elemCount} interactive elements)${hasScreenshot}`);
    }

    console.log(`\nOutput written to: ${outputDir}`);
  } finally {
    await closeBrowser(instance);
  }
}
