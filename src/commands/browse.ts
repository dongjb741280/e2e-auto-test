import fs from 'fs';
import path from 'path';
import { launchBrowser, closeBrowser } from '../browser/manager';
import { scrapePages } from '../browser/page-scraper';
import type { PageSnapshot } from '../types';

export interface BrowseCommandOptions {
  baseUrl: string;
  pages: string[];
  output?: string;
  headed?: boolean;
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
