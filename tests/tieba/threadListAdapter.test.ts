// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://tieba.baidu.com/?menu=true" }

import { afterEach, describe, expect, it } from 'vitest';

import { extractTiebaThreadList } from '../../src/tieba/threadListAdapter';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('extractTiebaThreadList', () => {
  it('extracts thread identity, author, reply count, and activity from feed cards', () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="home-feed">
          <div class="feed-card">
            <a class="thread-title" href="/p/1000000001">第一个帖子标题</a>
            <a class="author" href="/home/main?un=alice">alice</a>
            <span class="reply">128回复</span>
            <span class="time">3小时前</span>
          </div>
          <div class="feed-card">
            <a class="thread-title" href="https://tieba.baidu.com/p/1000000002?pn=1">第二个帖子标题有更长的名字</a>
            <a class="author" href="/home/main?un=bob">bob</a>
            <span class="reply">1.2万回复</span>
          </div>
        </div>
      </div>
    `;

    const result = extractTiebaThreadList(document);

    expect(result.state).toBe('ready');
    const topics = result.state === 'ready' ? result.topics : [];
    expect(topics).toHaveLength(2);
    expect(topics[0]).toEqual({
      activity: { label: '3小时前', lastPostNumber: null, timestamp: null, url: null },
      category: null,
      completeness: 'complete',
      hasExcerpt: false,
      id: 1_000_000_001,
      participants: [
        {
          isLatestPoster: false,
          isOriginalPoster: true,
          url: 'https://tieba.baidu.com/home/main?un=alice',
          username: 'alice',
        },
      ],
      pinned: false,
      readState: 'unknown',
      replyCount: { precision: 'exact', value: 128 },
      tags: [],
      title: '第一个帖子标题',
      url: 'https://tieba.baidu.com/p/1000000001',
      viewCount: null,
    });
    expect(topics[1]).toMatchObject({
      activity: null,
      id: 1_000_000_002,
      replyCount: { precision: 'compact', value: 12_000 },
      title: '第二个帖子标题有更长的名字',
      url: 'https://tieba.baidu.com/p/1000000002',
    });
  });

  it('keeps one entry per thread and prefers the anchor with a readable title', () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="card"><a href="/p/777"></a></div>
        <div class="card"><a href="/p/777">真实标题</a></div>
      </div>
    `;

    const result = extractTiebaThreadList(document);

    expect(result.state).toBe('ready');
    const topics = result.state === 'ready' ? result.topics : [];
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      completeness: 'partial',
      id: 777,
      participants: [],
      replyCount: null,
      title: '真实标题',
    });
  });

  it('reports loading while the client-rendered shell is still empty', () => {
    document.body.innerHTML = '<div id="app"></div>';

    expect(extractTiebaThreadList(document)).toEqual({
      issues: [],
      state: 'loading',
      topics: [],
    });
  });

  it('reports empty when the rendered app exposes no thread links', () => {
    document.body.innerHTML = '<div id="app"><section>登录后查看关注与推荐</section></div>';

    expect(extractTiebaThreadList(document)).toEqual({
      issues: [],
      state: 'empty',
      topics: [],
    });
  });

  it('reports an error when the Tieba application shell is absent', () => {
    document.body.innerHTML = '<main>没有帖子</main>';

    expect(extractTiebaThreadList(document)).toEqual({
      code: 'topic-list-not-found',
      issues: [],
      state: 'error',
      topics: [],
    });
  });

  it('ignores thread links owned by the workbench itself', () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="card"><a href="/p/6">真实帖子</a></div>
      </div>
      <div data-docode-workbench-root="token"><a href="/p/5">DOCode 中的帖子</a></div>
    `;

    const result = extractTiebaThreadList(document);

    expect(result.state).toBe('ready');
    const topics = result.state === 'ready' ? result.topics : [];
    expect(topics.map(({ id }) => id)).toEqual([6]);
  });

  it('ignores links that do not target Tieba thread paths', () => {
    document.body.innerHTML = `
      <div id="app">
        <a href="https://example.com/p/9">外部链接</a>
        <a href="/f?kw=linux">吧链接</a>
      </div>
    `;

    expect(extractTiebaThreadList(document)).toEqual({
      issues: [],
      state: 'empty',
      topics: [],
    });
  });

  it('fails safely when every thread anchor lacks a readable title', () => {
    document.body.innerHTML = '<div id="app"><a href="/p/8"></a></div>';

    expect(extractTiebaThreadList(document)).toEqual({
      code: 'topic-rows-unreadable',
      issues: [],
      state: 'error',
      topics: [],
    });
  });
});
