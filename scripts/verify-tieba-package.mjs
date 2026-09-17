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
  <div class="pc-main-page-layout">
    <div class="container styled-scrollbar deep" id="feed" style="height: 420px; overflow-y: auto;">
      <div id="feed-items">
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
        ${'<div class="feed-card">初始填充</div>'.repeat(30)}
      </div>
    </div>
  </div>
  <script>
    (function () {
      var page = 0;
      var feed = document.getElementById('feed');
      var items = document.getElementById('feed-items');
      feed.addEventListener('scroll', function () {
        if (feed.scrollTop + feed.clientHeight < feed.scrollHeight - 40) return;
        if (page >= 2) return;
        page += 1;
        var card = document.createElement('div');
        card.className = 'feed-card';
        var link = document.createElement('a');
        link.className = 'thread-title';
        link.setAttribute('href', '/p/10000000' + String(2 + page));
        link.textContent = '滚动加载帖子' + String(page);
        card.appendChild(link);
        items.appendChild(card);
        for (var index = 0; index < 16; index += 1) {
          var filler = document.createElement('div');
          filler.className = 'feed-card';
          filler.textContent = '追加填充 ' + String(page) + '-' + String(index);
          items.appendChild(filler);
        }
      });
    })();
  </script>
</body></html>`;

const TIEBA_HOME_REFRESH_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>百度贴吧</title></head><body>
  <div class="pc-main-page-layout">
    <div class="container styled-scrollbar deep" id="feed" style="height: 420px; overflow-y: auto;">
      <div id="feed-items">
        <div class="feed-card"><a class="thread-title" href="/p/2000000001">刷新后的帖子一</a></div>
        <div class="feed-card"><a class="thread-title" href="/p/2000000002">刷新后的帖子二</a></div>
        ${'<div class="feed-card">刷新填充</div>'.repeat(30)}
      </div>
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
        <div class="richtext-item">
          <div class="image-card-wrapper" origin-src="https://tiebapic.baidu.com/forum/original/big.jpg">
            <div class="lazy-img-wrapper">
              <img
                src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                data-src="https://tiebapic.baidu.com/forum/pic/item/photo.jpg?tbpicau=1"
              >
            </div>
          </div>
        </div>
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

  // Scrolling the workbench list must pull more cards out of the native feed.
  await page.evaluate(() => {
    const scroller = document.querySelector('.docode-topic-list__scroll');
    if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-docode-workbench-root]')
        ?.textContent?.includes('滚动加载帖子1') === true,
    undefined,
    { timeout: 20_000 },
  );

  // Reloading must show the freshly served feed instead of the previous content.
  await context.unroute('https://tieba.baidu.com/?menu=true');
  await context.route('https://tieba.baidu.com/?menu=true', (route) =>
    route.fulfill({
      body: TIEBA_HOME_REFRESH_FIXTURE,
      contentType: 'text/html; charset=utf-8',
      status: 200,
    }),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-docode-workbench-root]').waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-docode-workbench-root]')
        ?.textContent?.includes('刷新后的帖子一') === true,
    undefined,
    { timeout: 20_000 },
  );
  const refreshedText = await workbenchText();
  assert(
    refreshedText.includes('刷新后的帖子二'),
    'The reloaded feed did not render the newly fetched content.',
  );
  assert(
    !refreshedText.includes('合成帖子一'),
    'The reloaded feed kept stale content from the previous load.',
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

  // Images must stay collapsed into labelled hover previews.
  const imageTrigger = page.locator('.docode-topic-code__image-trigger').first();
  await imageTrigger.waitFor();
  const triggerLabel = (await imageTrigger.innerText()).trim();
  assert(
    triggerLabel.startsWith('image: ') && triggerLabel.includes('photo.jpg'),
    `Unexpected image trigger label: ${triggerLabel}`,
  );
  const sourceCollapsed = await page.evaluate(() => {
    const source = document.querySelector('[data-docode-image-source]');
    if (!(source instanceof HTMLElement)) return null;
    const style = getComputedStyle(source);
    return style.display === 'none' || source.getBoundingClientRect().height === 0;
  });
  assert.equal(sourceCollapsed, true, 'The full-size image must stay hidden until hover.');
  await imageTrigger.hover();
  await page.waitForFunction(
    () => {
      const preview = document.querySelector('[data-docode-image-preview]');
      return preview instanceof HTMLElement && !preview.hidden;
    },
    undefined,
    { timeout: 10_000 },
  );

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
        feedReload: 'fresh-content',
        feedScroll: 'loaded-more-threads',
        images: 'hover-preview',
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
