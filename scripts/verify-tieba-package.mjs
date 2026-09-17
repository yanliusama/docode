import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const unpackedRoot = path.join(projectRoot, '.output', 'chrome-mv3');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'docode-tieba-verification-'));
const browserChannel = process.env.DOCODE_BROWSER_CHANNEL ?? 'chromium';

const TIEBA_HOME_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>百度贴吧</title></head><body>
  <div id="app">
    <div class="feed-card">
      <a class="thread-title" href="/p/1000000001">合成帖子一</a>
      <a class="author" href="/home/main?un=alice">alice</a>
      <span class="reply">128回复</span>
      <span class="time">3小时前</span>
    </div>
    <div class="feed-card">
      <a class="thread-title" href="/p/1000000002">合成帖子二</a>
      <a class="author" href="/home/main?un=bob">bob</a>
      <span class="reply">1.2万回复</span>
    </div>
  </div>
</body></html>`;

const TIEBA_THREAD_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>合成帖子标题-百度贴吧</title></head><body>
  <div class="pc-pb-box styled-scrollbar deep">
    <div class="container">
      <div class="head-line user-info">
        <div class="left-box">
          <a class="avatar" href="https://tieba.baidu.com/home/main?id=tb.1.author&fr=pb">
            <img class="avatar-img" src="https://himg.bdimg.com/sys/portrait/item/tb.1.author">
          </a>
        </div>
        <div class="head-info">
          <a class="name-info-link" href="https://tieba.baidu.com/home/main?id=tb.1.author&fr=pb">
            <span class="head-name">合成楼主</span>
          </a>
        </div>
        <div class="desc-info"><span class="post-num">05-29</span><span class="ip-address">北京</span></div>
      </div>
      <div class="pb-title-wrap pc-pb-title"><span class="pb-title">合成帖子标题</span></div>
      <div class="pb-content-wrap">
        <div class="richtext-item"><span class="pb-text-wrapper">第一段正文</span></div>
        <div class="image-card-wrapper"><img src="https://tiebapic.baidu.com/forum/pic/item/abc.jpg"></div>
        <div class="richtext-item"><span class="pb-text-wrapper">第二段正文</span></div>
      </div>
      <div class="pc-pb-reply-top"><div class="card-tab"><span class="tab-item">全部回复 (2)</span></div></div>
      <div class="thread-container">
        <div class="virtual-list-item" data-key="111" data-index="0">
          <div class="pb-comment-item" data-id="111">
            <div class="head-line user-info">
              <a class="name-info-link" href="https://tieba.baidu.com/home/main?id=tb.1.first&fr=pb">
                <span class="head-name">甲用户</span>
              </a>
            </div>
            <div class="comment-content">
              <div class="pb-rich-text"><div class="pb-content-item">第一条回复</div></div>
            </div>
          </div>
        </div>
        <div class="virtual-list-item" data-key="222" data-index="1">
          <div class="pb-comment-item" data-id="222">
            <div class="head-line user-info">
              <a class="name-info-link" href="https://tieba.baidu.com/home/main?id=tb.1.second&fr=pb">
                <span class="head-name">乙用户</span>
              </a>
            </div>
            <div class="comment-content">
              <div class="pb-rich-text"><div class="pb-content-item">第二条回复</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

const LINUX_DO_FIXTURE =
  '<!doctype html><html><body><main id="main-outlet"><div id="list-area"></div></main></body></html>';

let context;
let session;
try {
  const manifest = JSON.parse(await readFile(path.join(unpackedRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'DOCode Tieba', 'The Tieba package must stay distinguishable.');
  assert.equal(
    (manifest.content_scripts ?? [])
      .filter(({ world }) => world === undefined)
      .every(({ matches }) => matches.includes('https://tieba.baidu.com/*')),
    true,
    'The isolated workbench script must cover Tieba pages.',
  );

  context = await chromium.launchPersistentContext(path.join(temporaryRoot, 'profile'), {
    args: ['--enable-unsafe-extension-debugging'],
    channel: browserChannel,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { height: 720, width: 1080 },
  });
  const browser = context.browser();
  assert(browser, 'Chromium browser connection is unavailable.');
  session = await browser.newBrowserCDPSession();
  const installation = await session.send('Extensions.loadUnpacked', { path: unpackedRoot });
  const page = context.pages()[0] ?? (await context.newPage());
  const pageSession = await context.newCDPSession(page);
  await pageSession.send('Runtime.enable');
  const exceptions = [];
  pageSession.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    exceptions.push(
      (exceptionDetails.exception?.description ?? exceptionDetails.text).split('\n')[0],
    );
  });

  const workbenchText = async () =>
    (await page.locator('[data-docode-workbench-root]').innerText()).replace(/\s+/gu, ' ');

  await context.route('https://tieba.baidu.com/?menu=true', (route) =>
    route.fulfill({
      body: TIEBA_HOME_FIXTURE,
      contentType: 'text/html; charset=utf-8',
      status: 200,
    }),
  );
  await page.goto('https://tieba.baidu.com/?menu=true', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-docode-workbench-root]').waitFor();
  await page.waitForFunction(() => document.title === 'Tieba.java - docode - Visual Studio Code');
  const homeText = await workbenchText();
  assert(homeText.includes('合成帖子一'), 'The Tieba feed extraction dropped a thread.');
  assert(homeText.includes('合成帖子二'), 'The Tieba feed extraction dropped a thread.');
  assert.equal(
    await page.locator('html[data-docode-runtime]').count(),
    1,
    'The Tieba runtime did not claim the home page.',
  );

  await context.route('https://tieba.baidu.com/p/10754086366', (route) =>
    route.fulfill({
      body: TIEBA_THREAD_FIXTURE,
      contentType: 'text/html; charset=utf-8',
      status: 200,
    }),
  );
  await page.goto('https://tieba.baidu.com/p/10754086366', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-docode-workbench-root]').waitFor();
  await page.waitForFunction(
    () => document.title === '合成帖子标题.java - docode - Visual Studio Code',
  );
  const threadText = await workbenchText();
  assert.equal(threadText.includes('Unsupported Tieba page'), false, 'Thread pages must render.');
  assert(threadText.includes('合成帖子标题'), 'The thread title did not render.');
  assert(threadText.includes('合成楼主'), 'The original poster did not render.');
  assert(threadText.includes('第一段正文'), 'The original post body did not render.');
  assert(threadText.includes('甲用户'), 'The first reply author did not render.');
  assert(threadText.includes('第一条回复'), 'The first reply body did not render.');
  assert(threadText.includes('第二条回复'), 'The second reply body did not render.');
  const editorLines = await page.locator('[data-docode-editor-line]').count();
  assert(editorLines > 0, 'The thread document rendered no editor lines.');

  await context.route('https://linux.do/latest?docode_verify=tieba_package', (route) =>
    route.fulfill({ body: LINUX_DO_FIXTURE, contentType: 'text/html', status: 200 }),
  );
  await page.goto('https://linux.do/latest?docode_verify=tieba_package', {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('[data-docode-workbench-root]').waitFor();
  assert.equal(
    await page.locator('html[data-docode-runtime]').count(),
    1,
    'The Linux DO runtime regressed after the Tieba adapter was added.',
  );

  assert.deepEqual(exceptions, [], 'The workbench threw while rendering Tieba pages.');

  await session.send('Extensions.uninstall', { id: installation.id });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator('[data-docode-workbench-root], html[data-docode-runtime]').count(),
    0,
    'The extension still modified a reloaded page after uninstall.',
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        editorLines,
        extensionId: installation.id,
        linuxDo: 'runtime-mounted',
        tiebaHome: 'workbench-mounted',
        tiebaThread: 'workbench-mounted',
        version: manifest.version,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (session) await session.detach().catch(() => undefined);
  if (context) await context.close().catch(() => undefined);
  // Windows keeps profile file handles briefly; retry without masking failures.
  await rm(temporaryRoot, {
    force: true,
    maxRetries: 4,
    recursive: true,
    retryDelay: 250,
  }).catch(() => undefined);
}
