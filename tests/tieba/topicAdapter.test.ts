// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://tieba.baidu.com/p/10754086366" }

import { afterEach, describe, expect, it } from 'vitest';

import { recognizeSiteRoute } from '../../src/site/routes';
import {
  disposeTiebaTopicStaging,
  extractTiebaTopic,
  TIEBA_STAGING_ATTRIBUTE,
} from '../../src/tieba/topicAdapter';

afterEach(() => {
  document.body.innerHTML = '';
});

function threadRoute() {
  const route = recognizeSiteRoute(window.location.href);
  if (route.kind !== 'topic') throw new Error('Expected a topic route.');
  return route;
}

function threadMarkup(options: { readonly totalReplies?: number } = {}): string {
  const total = options.totalReplies ?? 2;
  return `
    <div class="pc-pb-box styled-scrollbar deep">
      <div class="container">
        <div class="head-line user-info">
          <div class="left-box">
            <a class="avatar" href="https://tieba.baidu.com/home/main?id=tb.1.author&amp;fr=pb">
              <img class="avatar-img" src="https://himg.bdimg.com/sys/portrait/item/tb.1.author" >
            </a>
          </div>
          <div class="head-info">
            <a class="name-info-link" href="https://tieba.baidu.com/home/main?id=tb.1.author&amp;fr=pb">
              <span class="head-name">合成楼主</span>
            </a>
          </div>
          <div class="desc-info">
            <span class="post-num">05-29</span>
            <span class="ip-address">北京</span>
          </div>
        </div>
        <div class="pb-title-wrap pc-pb-title"><span class="pb-title">合成帖子标题</span></div>
        <div class="pb-content-wrap">
          <div class="richtext-item"><span class="pb-text-wrapper">第一段正文</span></div>
          <div class="image-card-wrapper">
            <img src="https://tiebapic.baidu.com/forum/pic/item/abc.jpg" >
          </div>
        </div>
        <div class="pc-pb-reply-top">
          <div class="card-tab"><span class="tab-item">全部回复 (${String(total)})</span></div>
        </div>
        <div class="thread-container">
          <div class="virtual-list-item" data-key="111" data-index="0">
            <div class="pb-comment-item" data-id="111">
              <div class="head-line user-info">
                <a class="name-info-link" href="https://tieba.baidu.com/home/main?id=tb.1.first&amp;fr=pb">
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
                <a class="name-info-link" href="https://tieba.baidu.com/home/main?id=tb.1.second&amp;fr=pb">
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
  `;
}

describe('extractTiebaTopic', () => {
  it('mirrors the original post and rendered replies into stable clones', () => {
    document.body.innerHTML = threadMarkup();
    const route = threadRoute();

    const result = extractTiebaTopic(document, route);

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;

    expect(result.topic).toEqual({
      category: null,
      closed: false,
      id: 10_754_086_366,
      pinned: false,
      tags: [],
      title: '合成帖子标题',
      url: 'https://tieba.baidu.com/p/10754086366',
    });
    expect(result.posts).toHaveLength(3);

    const [original, firstReply, secondReply] = result.posts;
    expect(original).toMatchObject({
      author: { displayName: '合成楼主', username: '合成楼主' },
      completeness: 'complete',
      id: 10_754_086_366,
      number: 1,
      permalink: 'https://tieba.baidu.com/p/10754086366',
      publishedLabel: '05-29 · 北京',
    });
    expect(original?.content?.source).toBe('tieba-owned-dom');
    expect(original?.content?.blocks.map(({ kind }) => kind)).toEqual(['paragraph', 'media']);
    expect(original?.content?.root.textContent).toContain('第一段正文');

    expect(firstReply).toMatchObject({
      author: { displayName: '甲用户' },
      completeness: 'complete',
      id: 111,
      number: 2,
      permalink: 'https://tieba.baidu.com/p/10754086366?pid=111',
    });
    expect(firstReply?.content?.root.textContent).toContain('第一条回复');
    expect(secondReply).toMatchObject({ id: 222, number: 3 });

    const staging = document.querySelector<HTMLElement>(`[${TIEBA_STAGING_ATTRIBUTE}]`);
    expect(staging).not.toBeNull();
    expect(staging?.childElementCount).toBe(3);
    expect(original?.content?.root.isConnected).toBe(true);
    expect(original?.content?.root.parentElement).toBe(staging);
    expect(result.hasMorePosts).toBe(false);
  });

  it('reuses one staged clone per post across extractions', () => {
    document.body.innerHTML = threadMarkup();
    const route = threadRoute();

    const first = extractTiebaTopic(document, route);
    const second = extractTiebaTopic(document, route);

    expect(first.state).toBe('ready');
    expect(second.state).toBe('ready');
    if (first.state !== 'ready' || second.state !== 'ready') return;
    expect(second.posts[1]?.content?.root).toBe(first.posts[1]?.content?.root);
    expect(second.posts[0]?.content?.root).toBe(first.posts[0]?.content?.root);
    expect(
      document.querySelector<HTMLElement>(`[${TIEBA_STAGING_ATTRIBUTE}]`)?.childElementCount,
    ).toBe(3);
  });

  it('reports remaining replies from the rendered reply total', () => {
    document.body.innerHTML = threadMarkup({ totalReplies: 5 });
    const route = threadRoute();

    const result = extractTiebaTopic(document, route);

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    expect(result.hasMorePosts).toBe(true);
  });

  it('keeps hidden Vue popovers out of the mirrored content', () => {
    document.body.innerHTML = threadMarkup();
    const route = threadRoute();

    const result = extractTiebaTopic(document, route);

    if (result.state !== 'ready') throw new Error('Expected a ready extraction.');
    expect(
      result.posts[0]?.content?.root.querySelector('.popover, .tooltip, .user-popover-mask'),
    ).toBeNull();
  });

  it('fails safely when the thread shell is missing', () => {
    document.body.innerHTML = '<main>没有帖子</main>';
    const route = threadRoute();

    expect(extractTiebaTopic(document, route)).toEqual({
      code: 'topic-metadata-not-found',
      issues: [],
      posts: [],
      state: 'error',
      topic: null,
    });
  });

  it('removes the staging holder on disposal', () => {
    document.body.innerHTML = threadMarkup();
    extractTiebaTopic(document, threadRoute());

    expect(disposeTiebaTopicStaging(document)).toBe(true);
    expect(document.querySelector(`[${TIEBA_STAGING_ATTRIBUTE}]`)).toBeNull();
  });
});
