const DOCODE_OWNED_ROOT_SELECTOR = '[data-docode-workbench-root]';
const THREAD_LINK_SELECTOR = 'a[href*="/p/"]';
const THREAD_SURFACE_SELECTOR =
  '.pc-pb-box, .pc-pb-title, .pb-comment-item, .virtual-list-item, .pc-main-page-layout';

/**
 * Watches the client-rendered Tieba application for feed and thread mutations so
 * the workbench can re-extract once hydration, a reload, lazy loading, or the
 * virtual lists have painted rows. Tieba replaces its own mount containers while
 * booting, so the observer stays on the document body and filters mutations by
 * Tieba content markers instead of binding to a container that may be discarded.
 */
export class TiebaViewStateObserver {
  readonly #document: Document;
  readonly #onChange: () => void;
  #observer: MutationObserver | null = null;
  #pending = false;
  #root: HTMLElement | null = null;

  constructor(document: Document, onChange: () => void) {
    this.#document = document;
    this.#onChange = onChange;
  }

  get isStarted(): boolean {
    return this.#observer !== null;
  }

  start(): boolean {
    if (this.#observer || !this.#document.defaultView) return false;
    const root = this.#resolveRoot();
    if (!root) return false;

    this.#root = root;
    this.#observer = new this.#document.defaultView.MutationObserver(this.#onMutations);
    this.#observer.observe(root, { childList: true, subtree: true });
    return true;
  }

  refresh(): boolean {
    const nextRoot = this.#resolveRoot();
    if (nextRoot === this.#root && this.#observer) return false;
    this.stop();
    return this.start();
  }

  stop(): boolean {
    if (!this.#observer) return false;
    this.#observer.disconnect();
    this.#observer = null;
    this.#pending = false;
    this.#root = null;
    return true;
  }

  #resolveRoot(): HTMLElement | null {
    return this.#document.body;
  }

  readonly #onMutations = (mutations: readonly MutationRecord[]) => {
    if (!this.#observer || this.#pending || !mutations.some(isTiebaContentMutation)) return;
    this.#pending = true;
    this.#document.defaultView?.queueMicrotask(() => {
      if (!this.#observer || !this.#pending) return;
      this.#pending = false;
      this.#onChange();
    });
  };
}

function isTiebaContentMutation(mutation: MutationRecord): boolean {
  if (mutation.type !== 'childList') return false;
  return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
    const element = toElement(node);
    return (
      element !== null &&
      element.closest(DOCODE_OWNED_ROOT_SELECTOR) === null &&
      matchesTiebaContent(element)
    );
  });
}

function matchesTiebaContent(element: Element): boolean {
  return (
    element.matches(THREAD_LINK_SELECTOR) ||
    element.matches(THREAD_SURFACE_SELECTOR) ||
    element.querySelector(THREAD_LINK_SELECTOR) !== null ||
    element.querySelector(THREAD_SURFACE_SELECTOR) !== null
  );
}

function toElement(node: Node): Element | null {
  const ElementConstructor = node.ownerDocument?.defaultView?.Element;
  return ElementConstructor && node instanceof ElementConstructor ? node : null;
}
