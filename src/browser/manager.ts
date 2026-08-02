import { chromium, firefox, webkit, Browser, BrowserContext, Page } from '@playwright/test';

export interface BrowserInstance {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface LaunchOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<BrowserInstance> {
  const {
    browser: browserType = 'chromium',
    headless = true,
    viewport = { width: 1280, height: 720 },
  } = options;

  const launcher = { chromium, firefox, webkit }[browserType];
  const browser = await launcher.launch({ headless });

  const context = await browser.newContext({
    viewport,
    // ignoresHTTPSErrors: true to handle self-signed certs in staging
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  return { browser, context, page };
}

export async function closeBrowser(instance: BrowserInstance): Promise<void> {
  await instance.browser.close();
}
