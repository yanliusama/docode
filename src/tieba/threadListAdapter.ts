import { isTiebaLocation } from '../linuxdo/host';
import type {
  TopicListCount,
  TopicListExtraction,
  TopicListIssue,
  TopicListItem,
  TopicListParticipant,
} from '../linuxdo/topicListAdapter';

const DOCODE_OWNED_ROOT_SELECTOR = '[data-docode-workbench-root]';
const THREAD_ANCHOR_SELECTOR = 'a[href*="/p/"]';
const THREAD_PATH_PATTERN = /^\/p\/([1-9]\d{0,18})\/?$/u;
const AUTHOR_LINK_PATTERN = /\/home\/main\/?$/u;
const REPLY_COUNT_PATTERN = /([1-9]\d*(?:[.,]\d+)?\s*[万千kw]?)\s*(?:条|个)?(?:回复|回帖|评论)/iu;
const ACTIVITY_PATTERN =
  /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?|\d{1,3}\s*(?:秒|分钟|小时|天|周|个月|月|年)前)/u;
const MAX_THREADS = 200;
const MAX_CARD_CLIMB = 10;

interface ThreadAnchor {
  readonly anchor: HTMLAnchorElement;
  readonly text: string;
  readonly threadId: number;
  readonly url: string;
}

/**
 * Extracts the thread feed rendered by the Tieba home page from any markup
 * shape. Tieba ships a client-rendered application whose class names change
 * between deploys, so the adapter keys off the stable `/p/<thread-id>` link
 * contract instead of presentation classes.
 */
export function extractTiebaThreadList(document: Document): TopicListExtraction {
  const anchors = collectThreadAnchors(document);
  if (anchors.length === 0) return emptyExtraction(document);

  const counts = countAncestorThreadAnchors(anchors);
  const byThreadId = new Map<number, ThreadAnchor>();
  for (const candidate of anchors) {
    const existing = byThreadId.get(candidate.threadId);
    if (!existing || candidate.text.length > existing.text.length) {
      byThreadId.set(candidate.threadId, candidate);
    }
  }

  const issues: TopicListIssue[] = [];
  const topics: TopicListItem[] = [];
  for (const entry of byThreadId.values()) {
    if (topics.length >= MAX_THREADS) break;
    if (entry.text.length === 0) continue;
    topics.push(createThreadItem(document, entry, scopeFor(entry.anchor, counts)));
  }

  return topics.length === 0
    ? { code: 'topic-rows-unreadable', issues, state: 'error', topics: [] }
    : { issues, state: 'ready', topics };
}

function emptyExtraction(document: Document): TopicListExtraction {
  if (isHydrationPending(document)) return { issues: [], state: 'loading', topics: [] };
  return hasTiebaAppRoot(document)
    ? { issues: [], state: 'empty', topics: [] }
    : { code: 'topic-list-not-found', issues: [], state: 'error', topics: [] };
}

function isHydrationPending(document: Document): boolean {
  if (document.readyState === 'loading') return true;
  const appRoot = document.querySelector('#app');
  return appRoot !== null && appRoot.childElementCount === 0;
}

function hasTiebaAppRoot(document: Document): boolean {
  return document.querySelector('#app') !== null;
}

function collectThreadAnchors(document: Document): ThreadAnchor[] {
  const anchors: ThreadAnchor[] = [];
  const seen = new Set<HTMLAnchorElement>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(THREAD_ANCHOR_SELECTOR)) {
    if (seen.has(anchor)) continue;
    seen.add(anchor);
    if (anchor.closest(DOCODE_OWNED_ROOT_SELECTOR) !== null) continue;
    const parsed = parseThreadHref(anchor.getAttribute('href'), document.baseURI);
    if (!parsed) continue;
    anchors.push({
      anchor,
      text: normalizeText(anchor.textContent),
      threadId: parsed.threadId,
      url: parsed.url,
    });
  }
  return anchors;
}

function parseThreadHref(
  href: string | null,
  baseHref: string,
): { readonly threadId: number; readonly url: string } | null {
  if (!href) return null;
  try {
    const url = new URL(href, baseHref);
    if (!isTiebaLocation(url)) return null;
    const threadId = THREAD_PATH_PATTERN.exec(url.pathname)?.[1];
    if (!threadId) return null;
    const parsed = Number(threadId);
    if (!Number.isSafeInteger(parsed)) return null;
    return { threadId: parsed, url: `https://tieba.baidu.com/p/${String(parsed)}` };
  } catch {
    return null;
  }
}

function countAncestorThreadAnchors(anchors: readonly ThreadAnchor[]): Map<Element, number> {
  const counts = new Map<Element, number>();
  for (const { anchor } of anchors) {
    let node: Element | null = anchor.parentElement;
    let depth = 0;
    while (node && depth < MAX_CARD_CLIMB) {
      counts.set(node, (counts.get(node) ?? 0) + 1);
      node = node.parentElement;
      depth += 1;
    }
  }
  return counts;
}

/**
 * The card scope is the largest ancestor that still contains exactly one thread
 * link, which keeps per-card metadata reads from bleeding into sibling cards.
 */
function scopeFor(anchor: HTMLAnchorElement, counts: ReadonlyMap<Element, number>): HTMLElement {
  const HTMLElementConstructor = anchor.ownerDocument.defaultView?.HTMLElement;
  const boundary = anchor.ownerDocument.body;
  let scope: HTMLElement = anchor;
  let node: Element | null = anchor.parentElement;
  let depth = 0;
  while (node && node !== boundary && depth < MAX_CARD_CLIMB) {
    const count = counts.get(node) ?? 0;
    if (count > 1) break;
    if (count === 1 && HTMLElementConstructor && node instanceof HTMLElementConstructor) {
      scope = node;
    }
    node = node.parentElement;
    depth += 1;
  }
  return scope;
}

function createThreadItem(
  document: Document,
  entry: ThreadAnchor,
  scope: HTMLElement,
): TopicListItem {
  const participants = extractParticipants(document, scope);
  const replyCount = extractReplyCount(scope);
  const activity = extractActivity(scope);
  return {
    activity,
    category: null,
    completeness: participants.length > 0 && replyCount !== null ? 'complete' : 'partial',
    hasExcerpt: false,
    id: entry.threadId,
    participants,
    pinned: false,
    readState: 'unknown',
    replyCount,
    tags: [],
    title: entry.text,
    url: entry.url,
    viewCount: null,
  };
}

function extractParticipants(document: Document, scope: HTMLElement): TopicListParticipant[] {
  for (const link of scope.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.closest(DOCODE_OWNED_ROOT_SELECTOR) !== null) continue;
    const participant = toParticipant(document, link);
    if (participant) return [participant];
  }
  return [];
}

function toParticipant(document: Document, link: HTMLAnchorElement): TopicListParticipant | null {
  const href = link.getAttribute('href');
  if (!href) return null;
  try {
    const url = new URL(href, document.baseURI);
    if (!isTiebaLocation(url) || !AUTHOR_LINK_PATTERN.test(url.pathname)) return null;
    const username =
      normalizeText(link.textContent) || normalizeText(url.searchParams.get('un') ?? '');
    if (username.length === 0) return null;
    url.hash = '';
    if (!url.searchParams.has('un')) url.searchParams.set('un', username);
    return {
      isLatestPoster: false,
      isOriginalPoster: true,
      url: url.href,
      username,
    };
  } catch {
    return null;
  }
}

function extractReplyCount(scope: HTMLElement): TopicListCount | null {
  const match = REPLY_COUNT_PATTERN.exec(normalizeText(scope.textContent));
  if (!match?.[1]) return null;
  const token = match[1].replace(/\s+/gu, '');
  const abbreviated = /[万千kw]/iu.test(token);
  const amount = Number(token.replace(/[万千kw]/giu, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = token.includes('万') ? 10_000 : /[千k]/iu.test(token) ? 1_000 : 1;
  const value = Math.round(amount * multiplier);
  return Number.isSafeInteger(value)
    ? { precision: abbreviated ? 'compact' : 'exact', value }
    : null;
}

function extractActivity(scope: HTMLElement): TopicListItem['activity'] {
  const label = ACTIVITY_PATTERN.exec(normalizeText(scope.textContent))?.[1];
  return label ? { label, lastPostNumber: null, timestamp: null, url: null } : null;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}
