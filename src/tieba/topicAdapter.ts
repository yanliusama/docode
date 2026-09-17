import { TIEBA_ORIGIN, isTiebaLocation } from '../linuxdo/host';
import type { LinuxDoRoute } from '../linuxdo/routes';
import type {
  NativePostContent,
  NativePostContentBlock,
  NativePostContentBlockKind,
  TopicExtraction,
  TopicIssue,
  TopicMetadata,
  TopicPost,
  TopicPostAuthor,
} from '../linuxdo/topicAdapter';

export const TIEBA_STAGING_ATTRIBUTE = 'data-docode-tieba-staging';

const THREAD_BOX_SELECTOR = '.pc-pb-box';
const THREAD_TITLE_SELECTOR = '.pc-pb-title .pb-title';
const OP_CONTENT_SELECTOR = '.pb-content-wrap';
const OP_HEAD_SELECTOR = '.head-line.user-info';
const REPLY_ITEM_SELECTOR = '.pb-comment-item[data-id]';
const REPLY_CONTENT_SELECTOR = '.comment-content, .pb-rich-text';
const REPLY_ROW_SELECTOR = '.virtual-list-item';
const REPLY_CONTAINER_SELECTOR = '.thread-container';
const MEDIA_WRAPPER_SELECTOR = '.image-card-wrapper, .lazy-img-wrapper';
const TEXT_BLOCK_SPLIT_SELECTOR = [
  '.pb-content-item',
  '.pb-text-wrapper',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'p',
  'pre',
  'table',
].join(', ');
const NOISE_SELECTOR = '.popover, .tooltip, .user-popover-mask, .avatar';
const AUTHOR_NAME_SELECTOR = '.head-name, .name-info-link';
const AUTHOR_LINK_SELECTOR = 'a.name-info-link[href], a.avatar[href]';
const AVATAR_SELECTOR = 'img.avatar-img';
const PUBLISH_LABEL_SELECTOR = '.post-num';
const IP_SELECTOR = '.ip-address';
const REPLY_COUNT_SELECTOR = '.card-tab .tab-item';
const REPLY_COUNT_PATTERN = /\((\d+)\)/u;
const SYNTHETIC_ROOT_CLASS = 'docode-tieba-content';
const MAX_CACHED_THREADS = 4;
const MAX_CACHED_REPLIES = 2_000;
const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;

interface CachedContent {
  readonly blocks: readonly NativePostContentBlock[];
  readonly root: HTMLElement;
}

interface CachedReply {
  readonly author: TopicPostAuthor | null;
  readonly content: CachedContent | null;
  readonly publishedLabel: string | null;
}

interface TiebaThreadCache {
  readonly indexes: Map<number, number>;
  readonly replies: Map<number, CachedReply>;
  op: CachedContent | null;
}

const threadCaches = new Map<number, TiebaThreadCache>();

/**
 * Extracts a Tieba thread page into the shared topic vocabulary. Thread content
 * is mirrored into a sanitized, Discourse-shaped DOM (paragraphs, links, images)
 * staged inside a hidden holder, so the live Vue virtual list keeps owning its
 * own nodes while the workbench renders stable content.
 */
export function extractTiebaTopic(document: Document, route: LinuxDoRoute): TopicExtraction {
  if (route.kind !== 'topic') {
    return { code: 'unsupported-route', issues: [], posts: [], state: 'error', topic: null };
  }

  const box = document.querySelector<HTMLElement>(THREAD_BOX_SELECTOR);
  const title = normalizeText(box?.querySelector(THREAD_TITLE_SELECTOR)?.textContent);
  if (!box || title.length === 0) {
    return isRenderingPending(document)
      ? { issues: [], posts: [], state: 'loading', topic: null }
      : { code: 'topic-metadata-not-found', issues: [], posts: [], state: 'error', topic: null };
  }

  const topic: TopicMetadata = {
    category: null,
    closed: false,
    id: route.topicId,
    pinned: false,
    tags: [],
    title,
    url: `${TIEBA_ORIGIN}/p/${String(route.topicId)}`,
  };
  const cache = getThreadCache(route.topicId);
  const issues: TopicIssue[] = [];
  const posts: TopicPost[] = [];

  posts.push(createOriginalPost(document, route, box, cache, issues));
  posts.push(...createReplyPosts(document, route, box, cache, issues));

  return {
    containsRequestedPost: true,
    hasMorePosts: hasUnrenderedReplies(box, posts.length - 1),
    issues,
    posts,
    requestedPostNumber: null,
    state: 'ready',
    topic,
  };
}

export function countRenderedTiebaReplies(document: Document): number {
  return document.querySelectorAll(REPLY_ITEM_SELECTOR).length;
}

export function hasUnrenderedReplies(box: HTMLElement, renderedReplyCount: number): boolean {
  const total = readTotalReplyCount(box);
  if (total !== null) return renderedReplyCount < total;
  return box.scrollTop + box.clientHeight < box.scrollHeight - 8;
}

export function readTiebaTotalReplyCount(document: Document): number | null {
  const box = document.querySelector<HTMLElement>(THREAD_BOX_SELECTOR);
  return box ? readTotalReplyCount(box) : null;
}

export function disposeTiebaTopicStaging(document: Document): boolean {
  const staging = document.querySelector<HTMLElement>(`[${TIEBA_STAGING_ATTRIBUTE}]`);
  if (!staging) return false;
  staging.remove();
  return true;
}

function createOriginalPost(
  document: Document,
  route: Extract<LinuxDoRoute, { readonly kind: 'topic' }>,
  box: HTMLElement,
  cache: TiebaThreadCache,
  issues: TopicIssue[],
): TopicPost {
  const head = findOriginalHead(box);
  const contentSource = findOriginalContent(box);
  const content = contentSource
    ? cacheContent(document, route.topicId, 0, contentSource)
    : (cache.op ?? null);
  if (!content) issues.push({ code: 'missing-post-content', postIndex: 0 });

  const author = contentSource ? extractAuthor(document, head) : null;
  if (!author) issues.push({ code: 'missing-post-author', postIndex: 0 });

  return {
    author,
    boosts: [],
    completeness: author && content ? 'complete' : 'partial',
    content: content ? toNativePostContent(content) : null,
    id: route.topicId,
    loadedOrder: 0,
    number: 1,
    permalink: `${TIEBA_ORIGIN}/p/${String(route.topicId)}`,
    publishedAt: null,
    publishedLabel: extractPublishedLabel(head),
    reactionCount: 0,
    readState: 'unknown',
    replyToPostNumber: null,
  };
}

function createReplyPosts(
  document: Document,
  route: Extract<LinuxDoRoute, { readonly kind: 'topic' }>,
  box: HTMLElement,
  cache: TiebaThreadCache,
  issues: TopicIssue[],
): TopicPost[] {
  for (const item of box.querySelectorAll<HTMLElement>(REPLY_ITEM_SELECTOR)) {
    const postId = toPositiveInteger(item.getAttribute('data-id'));
    if (postId === null) continue;
    const rowIndex = toNonNegativeInteger(
      item.closest<HTMLElement>(REPLY_ROW_SELECTOR)?.getAttribute('data-index') ?? null,
    );
    if (rowIndex !== null) cache.indexes.set(postId, rowIndex);

    const contentSource = item.querySelector<HTMLElement>(REPLY_CONTENT_SELECTOR);
    const content = contentSource
      ? cacheContent(document, route.topicId, postId, contentSource)
      : null;
    cache.replies.set(postId, {
      author: extractAuthor(document, item),
      content: content ?? cache.replies.get(postId)?.content ?? null,
      publishedLabel: extractPublishedLabel(item),
    });
  }

  trimReplyCache(cache);

  return orderedReplyIds(cache).map((postId, position) => {
    const reply = cache.replies.get(postId);
    const author = reply?.author ?? null;
    const content = reply?.content ?? null;
    if (!author) issues.push({ code: 'missing-post-author', postIndex: position + 1 });
    if (!content) issues.push({ code: 'missing-post-content', postIndex: position + 1 });
    return {
      author,
      boosts: [],
      completeness: author && content ? 'complete' : 'partial',
      content: content ? toNativePostContent(content) : null,
      id: postId,
      loadedOrder: position + 1,
      number: position + 2,
      permalink: `${TIEBA_ORIGIN}/p/${String(route.topicId)}?pid=${String(postId)}`,
      publishedAt: null,
      publishedLabel: reply?.publishedLabel ?? null,
      reactionCount: 0,
      readState: 'unknown' as const,
      replyToPostNumber: null,
    };
  });
}

function orderedReplyIds(cache: TiebaThreadCache): number[] {
  return [...cache.replies.keys()].sort((left, right) => {
    const leftIndex = cache.indexes.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = cache.indexes.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function cacheContent(
  document: Document,
  threadId: number,
  key: number,
  source: HTMLElement,
): CachedContent {
  const cache = getThreadCache(threadId);
  const existing = key === 0 ? cache.op : cache.replies.get(key)?.content;
  // A staged mirror that left the document (for example after the runtime
  // released its staging holder) must be built again before reuse.
  if (existing?.root.isConnected === true) return existing;

  const content = buildContentMirror(document, source);
  if (key === 0) {
    cache.op = content;
  } else {
    const reply = cache.replies.get(key);
    cache.replies.set(key, {
      author: reply?.author ?? null,
      content,
      publishedLabel: reply?.publishedLabel ?? null,
    });
  }
  return content;
}

/**
 * Rebuilds thread content as a plain paragraph/media DOM. Tieba's own classes
 * are intentionally dropped: the workbench renders this mirror inside its own
 * code-style layout, and dropping the site classes keeps that layout stable.
 */
function buildContentMirror(document: Document, source: HTMLElement): CachedContent {
  const root = document.createElement('div');
  root.className = SYNTHETIC_ROOT_CLASS;
  let paragraph: HTMLElement | null = null;

  const flushParagraph = (): void => {
    if (paragraph && normalizeText(paragraph.textContent).length > 0) root.append(paragraph);
    paragraph = null;
  };
  const appendInline = (node: Node): void => {
    paragraph ??= document.createElement('p');
    appendInlineContent(document, paragraph, node);
  };
  const appendMedia = (element: HTMLElement): void => {
    flushParagraph();
    const figure = createMediaBlock(document, element);
    if (figure) root.append(figure);
  };
  const visit = (node: Node): void => {
    if (node.nodeType === TEXT_NODE_TYPE) {
      appendInline(node);
      return;
    }
    if (node.nodeType !== ELEMENT_NODE_TYPE) return;
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') return;
    if (element.matches(NOISE_SELECTOR)) return;
    // Media wrappers become their own figure block wherever they appear, which
    // keeps images out of the paragraph flow. The workbench then replaces each
    // image with a labelled hover preview instead of showing it full size.
    if (isMediaElement(element)) {
      appendMedia(element);
      return;
    }
    if (element.matches(TEXT_BLOCK_SPLIT_SELECTOR)) {
      flushParagraph();
      appendInline(element);
      flushParagraph();
      return;
    }
    for (const child of element.childNodes) visit(child);
  };

  for (const child of source.childNodes) visit(child);
  flushParagraph();

  if (root.childElementCount === 0) {
    const paragraphFallback = document.createElement('p');
    paragraphFallback.textContent = normalizeText(source.textContent) || '…';
    root.append(paragraphFallback);
  }

  ensureStaging(document).append(root);
  const blocks: NativePostContentBlock[] = [...root.children].map((element) => ({
    element: element as HTMLElement,
    kind: classifySyntheticBlock(element),
  }));
  return { blocks, root };
}

function isMediaElement(element: HTMLElement): boolean {
  if (element.tagName === 'FIGURE' || element.tagName === 'VIDEO') return true;
  if (element.matches(MEDIA_WRAPPER_SELECTOR)) return findMediaSource(element) !== null;
  return false;
}

function classifySyntheticBlock(element: Element): NativePostContentBlockKind {
  return element.tagName === 'FIGURE' ? 'media' : 'paragraph';
}

function createMediaBlock(document: Document, section: HTMLElement): HTMLElement | null {
  const media = findMediaSource(section);
  if (!media) return null;
  const figure = document.createElement('figure');
  if (media.tagName === 'IMG') {
    const image = document.createElement('img');
    const resolved = resolveImageUrl(document, readMediaSource(media));
    if (!resolved) return null;
    image.setAttribute('src', resolved);
    const alt = normalizeText(media.getAttribute('alt'));
    if (alt.length > 0) image.setAttribute('alt', alt);
    image.setAttribute('loading', 'eager');
    figure.append(image);
    return figure;
  }
  const video = media.cloneNode(true);
  figure.append(video);
  return figure;
}

function appendInlineContent(document: Document, target: HTMLElement, node: Node): void {
  if (node.nodeType === TEXT_NODE_TYPE) {
    const text = (node as Text).data.replace(/\s+/gu, ' ');
    if (text.trim().length > 0) target.append(document.createTextNode(text));
    return;
  }
  if (node.nodeType !== ELEMENT_NODE_TYPE) return;

  const element = node as HTMLElement;
  const tag = element.tagName;
  if (tag === 'BR') {
    target.append(document.createElement('br'));
    return;
  }
  if (tag === 'IMG') {
    const resolved = resolveImageUrl(document, readMediaSource(element));
    if (!resolved) return;
    const image = document.createElement('img');
    image.setAttribute('src', resolved);
    image.setAttribute('loading', 'eager');
    target.append(image);
    return;
  }
  if (element.matches(NOISE_SELECTOR) || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') {
    return;
  }
  if (element.matches(MEDIA_WRAPPER_SELECTOR)) {
    const media = findMediaSource(element);
    if (media?.tagName === 'IMG') {
      appendInlineContent(document, target, media);
      return;
    }
  }
  if (tag === 'A') {
    const anchor = document.createElement('a');
    const href = element.getAttribute('href');
    if (href) {
      try {
        const url = new URL(href, document.baseURI);
        anchor.setAttribute('href', url.href);
      } catch {
        /* keep the anchor text without a target */
      }
    }
    for (const child of element.childNodes) appendInlineContent(document, anchor, child);
    if (anchor.childNodes.length > 0) target.append(anchor);
    return;
  }
  for (const child of element.childNodes) appendInlineContent(document, target, child);
}

/**
 * Tieba lazy-loads photos: `src` often holds a 1x1 `data:` placeholder while the
 * real address lives in `data-src`, and the card wrapper keeps the original in
 * `origin-src`. Only http(s) candidates are accepted, in fidelity order.
 */
function readMediaSource(element: HTMLElement): string {
  const image =
    element.tagName === 'IMG' ? element : element.querySelector<HTMLImageElement>('img');
  const wrapper =
    (element.matches(MEDIA_WRAPPER_SELECTOR) ? element : null) ??
    element.closest<HTMLElement>(MEDIA_WRAPPER_SELECTOR) ??
    image?.closest<HTMLElement>(MEDIA_WRAPPER_SELECTOR) ??
    null;
  const candidates = [
    image?.getAttribute('data-src'),
    image?.getAttribute('src'),
    element.getAttribute('origin-src'),
    wrapper?.getAttribute('origin-src'),
    image?.getAttribute('origin-src'),
  ];
  for (const candidate of candidates) {
    const value = candidate ?? '';
    if (value.length === 0) continue;
    try {
      const url = new URL(value, element.ownerDocument.baseURI);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      /* try the next candidate */
    }
  }
  return '';
}

function findMediaSource(section: HTMLElement): HTMLElement | null {
  if (section.tagName === 'IMG' || section.tagName === 'VIDEO') return section;
  return section.querySelector<HTMLElement>('img, video');
}

function ensureStaging(document: Document): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`[${TIEBA_STAGING_ATTRIBUTE}]`);
  if (existing) return existing;
  const staging = document.createElement('div');
  staging.setAttribute(TIEBA_STAGING_ATTRIBUTE, '');
  staging.hidden = true;
  document.body.append(staging);
  return staging;
}

function findOriginalContent(box: HTMLElement): HTMLElement | null {
  for (const candidate of box.querySelectorAll<HTMLElement>(OP_CONTENT_SELECTOR)) {
    if (
      candidate.closest(REPLY_ITEM_SELECTOR) === null &&
      candidate.closest(REPLY_CONTAINER_SELECTOR) === null
    ) {
      return candidate;
    }
  }
  return null;
}

function findOriginalHead(box: HTMLElement): HTMLElement | null {
  for (const candidate of box.querySelectorAll<HTMLElement>(OP_HEAD_SELECTOR)) {
    if (candidate.closest(REPLY_CONTAINER_SELECTOR) === null) return candidate;
  }
  return null;
}

function extractPublishedLabel(scope: HTMLElement | null): string | null {
  if (!scope) return null;
  const parts = [
    normalizeText(scope.querySelector(PUBLISH_LABEL_SELECTOR)?.textContent),
    normalizeText(scope.querySelector(IP_SELECTOR)?.textContent),
  ].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function extractAuthor(document: Document, scope: HTMLElement | null): TopicPostAuthor | null {
  if (!scope) return null;
  const name = normalizeText(scope.querySelector(AUTHOR_NAME_SELECTOR)?.textContent);
  const avatar = resolveImageUrl(
    document,
    scope.querySelector<HTMLImageElement>(AVATAR_SELECTOR)?.getAttribute('src') ?? '',
  );
  const url = resolveAuthorUrl(
    document,
    scope.querySelector<HTMLAnchorElement>(AUTHOR_LINK_SELECTOR),
  );
  if (name.length === 0 && url === null && avatar === null) return null;
  return {
    avatarUrl: avatar,
    displayName: name.length > 0 ? name : (url ?? ''),
    url: url ?? `${TIEBA_ORIGIN}/`,
    username: name.length > 0 ? name : (url ?? ''),
  };
}

function resolveAuthorUrl(document: Document, anchor: HTMLAnchorElement | null): string | null {
  const href = anchor?.getAttribute('href');
  if (!href) return null;
  try {
    const url = new URL(href, document.baseURI);
    return isTiebaLocation(url) ? url.href : null;
  } catch {
    return null;
  }
}

function resolveImageUrl(document: Document, source: string): string | null {
  if (!source) return null;
  try {
    const url = new URL(source, document.baseURI);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function readTotalReplyCount(box: HTMLElement): number | null {
  for (const tab of box.querySelectorAll<HTMLElement>(REPLY_COUNT_SELECTOR)) {
    const match = REPLY_COUNT_PATTERN.exec(normalizeText(tab.textContent));
    const total = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
    if (Number.isSafeInteger(total)) return total;
  }
  return null;
}

function getThreadCache(threadId: number): TiebaThreadCache {
  const existing = threadCaches.get(threadId);
  if (existing) return existing;
  const cache: TiebaThreadCache = { indexes: new Map(), op: null, replies: new Map() };
  threadCaches.set(threadId, cache);
  while (threadCaches.size > MAX_CACHED_THREADS) {
    const oldest = threadCaches.keys().next();
    if (oldest.done === true) break;
    threadCaches.delete(oldest.value);
  }
  return cache;
}

function trimReplyCache(cache: TiebaThreadCache): void {
  while (cache.replies.size > MAX_CACHED_REPLIES) {
    const oldest = cache.replies.keys().next();
    if (oldest.done === true) break;
    cache.replies.delete(oldest.value);
    cache.indexes.delete(oldest.value);
  }
}

function toNativePostContent(content: CachedContent): NativePostContent {
  return { blocks: content.blocks, root: content.root, source: 'tieba-owned-dom' };
}

function isRenderingPending(document: Document): boolean {
  return document.readyState !== 'complete';
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function toNonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toPositiveInteger(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
