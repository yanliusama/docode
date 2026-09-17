import { countRenderedTiebaReplies, hasUnrenderedReplies } from './topicAdapter';
import type { TopicPostPageLoadOutcome } from '../linuxdo/topicPaginator';

const THREAD_BOX_SELECTOR = '.pc-pb-box';
const MAX_SCROLL_ROUNDS = 6;
const REPLY_GROWTH_TIMEOUT = 1_600;
const MUTATION_OPTIONS = { childList: true, subtree: true } as const;

type LoaderWindow = Window & {
  readonly MutationObserver: typeof MutationObserver;
};

/**
 * Tieba renders replies through a Vue virtual list that only materializes rows
 * near the viewport. Growing the mirrored reply list therefore means nudging the
 * native scroller until more rows appear, then letting the workbench re-extract.
 */
export async function loadMoreTiebaReplies(
  document: Document,
  signal: AbortSignal,
): Promise<TopicPostPageLoadOutcome> {
  const box = document.querySelector<HTMLElement>(THREAD_BOX_SELECTOR);
  const activeWindow = document.defaultView as LoaderWindow | null;
  if (!box || !activeWindow) return { kind: 'unavailable' };

  const before = countRenderedTiebaReplies(document);
  for (let round = 0; round < MAX_SCROLL_ROUNDS; round += 1) {
    if (isAborted(signal)) return { kind: 'aborted' };
    const reachableBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    box.scrollTop = Math.min(
      box.scrollTop + Math.round(box.clientHeight * 1.2),
      Math.max(0, box.scrollHeight - box.clientHeight),
    );
    const grew = await waitForReplyGrowth(document, box, before, signal, activeWindow);
    if (isAborted(signal)) return { kind: 'aborted' };
    if (grew) {
      const rendered = countRenderedTiebaReplies(document);
      return {
        hasMore: hasUnrenderedReplies(box, rendered),
        kind: 'ready',
        loadedPostCount: rendered - before,
      };
    }
    if (reachableBottom && round >= 1) return { kind: 'complete' };
  }

  return { kind: 'complete' };
}

function waitForReplyGrowth(
  document: Document,
  box: HTMLElement,
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
      if (countRenderedTiebaReplies(document) > before) finish(true);
    });
    const timer = activeWindow.setTimeout(() => {
      finish(countRenderedTiebaReplies(document) > before);
    }, REPLY_GROWTH_TIMEOUT);

    observer.observe(box, MUTATION_OPTIONS);
    signal.addEventListener('abort', onAbort, { once: true });
    if (countRenderedTiebaReplies(document) > before) finish(true);
  });
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
