import { extractTiebaThreadList } from './threadListAdapter';
import { createTopicListDocument, type TopicListRoute } from '../views/topicList/topicListDocument';
import type { TopicListPageLoadOutcome } from '../linuxdo/topicListPaginator';

const THREAD_LINK_SELECTOR = 'a[href*="/p/"]';
const DOCODE_OWNED_ROOT_SELECTOR = '[data-docode-workbench-root]';
const MAX_SCROLL_ROUNDS = 6;
const THREAD_GROWTH_TIMEOUT = 1_600;
const MAX_SCROLL_ANCESTOR_DEPTH = 12;
const MUTATION_OPTIONS = { childList: true, subtree: true } as const;

type LoaderWindow = Window & {
  readonly HTMLElement: typeof HTMLElement;
  readonly MutationObserver: typeof MutationObserver;
};

export function countRenderedTiebaThreadLinks(document: Document): number {
  return [...document.querySelectorAll(THREAD_LINK_SELECTOR)].filter(
    (anchor) => anchor.closest(DOCODE_OWNED_ROOT_SELECTOR) === null,
  ).length;
}

/**
 * Tieba renders the home feed through a virtualized scroller that only appends
 * cards as the native container scrolls. Growing the mirrored feed therefore
 * means nudging that scroller until more thread links appear, then rebuilding
 * the topic-list document from the freshly rendered cards.
 */
export async function loadMoreTiebaThreads(
  document: Document,
  route: TopicListRoute,
  signal: AbortSignal,
): Promise<TopicListPageLoadOutcome> {
  const activeWindow = document.defaultView as LoaderWindow | null;
  const scroller = activeWindow ? findFeedScroller(document, activeWindow) : null;
  if (!activeWindow || !scroller) return { kind: 'unavailable' };

  const before = countRenderedTiebaThreadLinks(document);
  for (let round = 0; round < MAX_SCROLL_ROUNDS; round += 1) {
    if (isAborted(signal)) return { kind: 'aborted' };
    const reachableBottom = isAtBottom(scroller);
    scroller.scrollTop = Math.min(
      scroller.scrollTop + Math.round(scroller.clientHeight * 1.2),
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    );
    const grew = await waitForThreadGrowth(document, scroller, before, signal, activeWindow);
    if (isAborted(signal)) return { kind: 'aborted' };
    if (grew) {
      const extraction = extractTiebaThreadList(document);
      return {
        document: extraction.state === 'ready' ? createTopicListDocument(route, extraction) : null,
        hasMore: !isAtBottom(scroller),
        kind: 'ready',
      };
    }
    if (reachableBottom && round >= 1) return { kind: 'complete' };
  }

  return { kind: 'complete' };
}

function findFeedScroller(document: Document, activeWindow: LoaderWindow): HTMLElement | null {
  for (const anchor of document.querySelectorAll(THREAD_LINK_SELECTOR)) {
    if (anchor.closest(DOCODE_OWNED_ROOT_SELECTOR) !== null) continue;
    let node: Element | null = anchor.parentElement;
    let depth = 0;
    while (node && depth < MAX_SCROLL_ANCESTOR_DEPTH) {
      if (node instanceof activeWindow.HTMLElement && isScrollable(node, activeWindow)) return node;
      node = node.parentElement;
      depth += 1;
    }
  }
  return null;
}

function isScrollable(element: HTMLElement, activeWindow: LoaderWindow): boolean {
  const style = activeWindow.getComputedStyle(element);
  return (
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    element.scrollHeight > element.clientHeight + 80
  );
}

function isAtBottom(element: HTMLElement): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
}

function waitForThreadGrowth(
  document: Document,
  scroller: HTMLElement,
  before: number,
  signal: AbortSignal,
  activeWindow: LoaderWindow,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;

    function finish(grew: boolean): void {
      if (settled) return;
      settled = true;
      observer.disconnect();
      activeWindow.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(grew);
    }

    function onAbort(): void {
      finish(false);
    }

    const observer = new activeWindow.MutationObserver(() => {
      if (countRenderedTiebaThreadLinks(document) > before) finish(true);
    });
    const timer = activeWindow.setTimeout(() => {
      finish(countRenderedTiebaThreadLinks(document) > before);
    }, THREAD_GROWTH_TIMEOUT);

    observer.observe(scroller, MUTATION_OPTIONS);
    signal.addEventListener('abort', onAbort, { once: true });
    if (countRenderedTiebaThreadLinks(document) > before) finish(true);
  });
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
