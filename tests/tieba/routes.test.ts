import { describe, expect, it } from 'vitest';

import { recognizeSiteRoute } from '../../src/site/routes';
import { recognizeTiebaLocation, tiebaLocationToWorkbenchRoute } from '../../src/tieba/routes';

describe('recognizeTiebaLocation', () => {
  it('recognizes the home page with and without the menu flag', () => {
    expect(recognizeTiebaLocation('https://tieba.baidu.com/?menu=true')).toMatchObject({
      href: 'https://tieba.baidu.com/?menu=true',
      kind: 'home',
      search: '?menu=true',
    });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/')).toMatchObject({ kind: 'home' });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/index.html')).toMatchObject({
      kind: 'home',
    });
  });

  it('recognizes forum and thread pages', () => {
    expect(recognizeTiebaLocation('https://tieba.baidu.com/f?kw=%E5%8E%9F%E7%A5%9E')).toMatchObject(
      {
        forumName: '原神',
        kind: 'forum',
      },
    );
    expect(recognizeTiebaLocation('https://tieba.baidu.com/f')).toMatchObject({
      forumName: null,
      kind: 'forum',
    });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/p/8123456789')).toMatchObject({
      kind: 'thread',
      page: 1,
      threadId: 8123456789,
    });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/p/8123456789?pn=3')).toMatchObject({
      kind: 'thread',
      page: 3,
      threadId: 8123456789,
    });
  });

  it('fails safely for malformed or unsupported locations', () => {
    expect(recognizeTiebaLocation('not a URL')).toMatchObject({
      kind: 'unsupported',
      reason: 'malformed-path',
    });
    expect(recognizeTiebaLocation('https://example.com/?menu=true')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported-origin',
    });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/p/abc')).toMatchObject({
      kind: 'unsupported',
      reason: 'malformed-path',
    });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/p/123/extra')).toMatchObject({
      kind: 'unsupported',
      reason: 'malformed-path',
    });
    expect(recognizeTiebaLocation('https://tieba.baidu.com/home/main?un=alice')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported-path',
    });
  });
});

describe('tiebaLocationToWorkbenchRoute', () => {
  it('maps the home feed onto the shared topic-list surface', () => {
    const route = tiebaLocationToWorkbenchRoute(
      recognizeTiebaLocation('https://tieba.baidu.com/?menu=true'),
    );

    expect(route).toEqual({
      hash: '',
      href: 'https://tieba.baidu.com/?menu=true',
      kind: 'topic-list',
      pathname: '/',
      search: '?menu=true',
      site: 'tieba',
      view: 'latest',
    });
  });

  it('maps thread pages onto the shared topic surface', () => {
    const route = tiebaLocationToWorkbenchRoute(
      recognizeTiebaLocation('https://tieba.baidu.com/p/123?pn=2'),
    );

    expect(route).toEqual({
      hash: '',
      href: 'https://tieba.baidu.com/p/123?pn=2',
      kind: 'topic',
      pathname: '/p/123',
      postNumber: null,
      search: '?pn=2',
      site: 'tieba',
      topicId: 123,
      topicSlug: 'thread',
    });
  });

  it('degrades every other Tieba page to the unsupported surface', () => {
    expect(
      tiebaLocationToWorkbenchRoute(recognizeTiebaLocation('https://tieba.baidu.com/f?kw=linux')),
    ).toMatchObject({ kind: 'unsupported', reason: 'unsupported-path', site: 'tieba' });
    expect(
      tiebaLocationToWorkbenchRoute(recognizeTiebaLocation('https://example.com/latest')),
    ).toMatchObject({ kind: 'unsupported', reason: 'unsupported-origin', site: 'tieba' });
  });
});

describe('recognizeSiteRoute', () => {
  it('keeps Linux DO recognition untouched', () => {
    expect(recognizeSiteRoute('https://linux.do/latest')).toMatchObject({
      kind: 'topic-list',
      view: 'latest',
    });
    expect(recognizeSiteRoute('https://linux.do/latest')).not.toHaveProperty('site');
    expect(recognizeSiteRoute('https://example.com/latest')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported-origin',
    });
  });

  it('dispatches Tieba URLs to the Tieba mapping', () => {
    expect(recognizeSiteRoute('https://tieba.baidu.com/?menu=true')).toMatchObject({
      kind: 'topic-list',
      site: 'tieba',
      view: 'latest',
    });
    expect(recognizeSiteRoute('https://tieba.baidu.com/p/42')).toMatchObject({
      kind: 'topic',
      site: 'tieba',
      topicId: 42,
    });
  });
});
