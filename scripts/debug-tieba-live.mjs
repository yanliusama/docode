import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const unpackedRoot = path.join(projectRoot, '.output', 'chrome-mv3');
const targetUrl = process.argv[2] ?? 'https://tieba.baidu.com/p/10754086366';
const cdpEndpoint = process.env.DOCODE_CDP_ENDPOINT ?? '';
const timeoutMs = Number.parseInt(process.env.DOCODE_DEBUG_TIMEOUT_MS ?? '0', 10);
const headless = process.env.DOCODE_DEBUG_HEADLESS === '1';
const browserChannel = process.env.DOCODE_BROWSER_CHANNEL ?? 'chromium';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Live debugging entry point.
 *
 * - Default: launches a visible Chromium window with the freshly built extension
 *   loaded and opens the given Tieba URL, so the workbench can be inspected by
 *   hand (or with DevTools).
 * - DOCODE_CDP_ENDPOINT=http://127.0.0.1:9222: attaches to an already running
 *   browser that was started with --remote-debugging-port=9222 and reuses its
 *   pages instead of launching a new window.
 * - DOCODE_DEBUG_TIMEOUT_MS=8000: closes automatically after the given delay,
 *   which keeps automated smoke runs from hanging.
 */
const attached = cdpEndpoint.length > 0;
const ownProfileRoot = attached ? null : await mkdtemp(path.join(tmpdir(), 'docode-debug-live-'));
let browser;
let context;
let page;

if (attached) {
  browser = await chromium.connectOverCDP(cdpEndpoint);
  context = browser.contexts()[0];
  assert(context, `No browser context is available at ${cdpEndpoint}.`);
  page = context.pages()[0] ?? (await context.newPage());
} else {
  context = await chromium.launchPersistentContext(ownProfileRoot, {
    args: ['--enable-unsafe-extension-debugging'],
    channel: browserChannel,
    headless,
    ignoreDefaultArgs: ['--disable-extensions'],
    locale: 'zh-CN',
    userAgent: DESKTOP_UA,
    viewport: { height: 900, width: 1280 },
  });
  const browserConnection = context.browser();
  assert(browserConnection, 'Chromium browser connection is unavailable.');
  const session = await browserConnection.newBrowserCDPSession();
  await session.send('Extensions.loadUnpacked', { path: unpackedRoot });
  page = context.pages()[0] ?? (await context.newPage());
}

const exceptions = [];
const pageSession = await context.newCDPSession(page);
await pageSession.send('Runtime.enable');
pageSession.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  exceptions.push(
    (exceptionDetails.exception?.description ?? exceptionDetails.text).split('\n')[0],
  );
});

await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.locator('[data-docode-workbench-root]').waitFor({ timeout: 60_000 });
await page.waitForTimeout(4_000);

const report = async () => {
  const stats = await page.evaluate(() => {
    const root = document.querySelector('[data-docode-workbench-root]');
    return {
      editorLines: document.querySelectorAll('[data-docode-editor-line]').length,
      renderedTextLength: root?.textContent?.length ?? 0,
      title: document.title,
      unsupported: root?.textContent?.includes('Unsupported Tieba page') ?? false,
    };
  });
  process.stdout.write(
    `${JSON.stringify({ attached, exceptions: [...new Set(exceptions)], stats, targetUrl }, null, 2)}\n`,
  );
};

if (timeoutMs > 0) {
  await page.waitForTimeout(timeoutMs);
  await report();
  const screenshotPath = process.env.DOCODE_DEBUG_SCREENSHOT ?? '';
  if (screenshotPath.length > 0) {
    await page.screenshot({ path: screenshotPath, fullPage: false });
    process.stdout.write(`Screenshot: ${screenshotPath}\n`);
  }
  if (!attached) {
    const browserConnection = context.browser();
    if (browserConnection) {
      const session = await browserConnection.newBrowserCDPSession();
      await session.detach().catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    await rm(ownProfileRoot, {
      force: true,
      maxRetries: 4,
      recursive: true,
      retryDelay: 250,
    }).catch(() => undefined);
  }
} else {
  process.stdout.write(
    `DOCode live debugging is attached${attached ? ` to ${cdpEndpoint}` : ''} at ${targetUrl}\n` +
      'Close the browser (or press Ctrl+C) when finished.\n',
  );
  await report();
  await new Promise((resolve) => {
    page.on('close', resolve);
    process.on('SIGINT', resolve);
  });
  if (!attached) {
    await context.close().catch(() => undefined);
    await rm(ownProfileRoot, {
      force: true,
      maxRetries: 4,
      recursive: true,
      retryDelay: 250,
    }).catch(() => undefined);
  }
}
