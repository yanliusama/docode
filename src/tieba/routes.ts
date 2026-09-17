import { isTiebaLocation } from '../linuxdo/host';
import type { LinuxDoRoute } from '../linuxdo/routes';

interface TiebaRouteBase {
  readonly hash: string;
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
}

/**
 * Tieba locations that the adapter layer can tell apart. Only the home feed is
 * rendered by the workbench today; forum and thread pages are recognized so the
 * runtime can report them precisely while still falling back to the native site.
 */
export type TiebaLocation =
  | (TiebaRouteBase & { readonly kind: 'forum'; readonly forumName: string | null })
  | (TiebaRouteBase & { readonly kind: 'home' })
  | (TiebaRouteBase & { readonly kind: 'thread'; readonly page: number; readonly threadId: number })
  | (TiebaRouteBase & {
      readonly kind: 'unsupported';
      readonly reason: 'malformed-path' | 'unsupported-origin' | 'unsupported-path';
    });

export type TiebaLocationFamily = TiebaLocation['kind'];

const HOME_FILE_NAMES = ['index.html', 'index.htm'] as const;

export function recognizeTiebaLocation(input: string | URL): TiebaLocation {
  const url = toUrl(input);
  if (!url) return unsupportedLocation('malformed-path', String(input));

  const base = routeBase(url);
  if (!isTiebaLocation(url)) {
    return { ...base, kind: 'unsupported', reason: 'unsupported-origin' };
  }

  const segments = decodePathSegments(url.pathname);
  if (!segments) return { ...base, kind: 'unsupported', reason: 'malformed-path' };

  if (segments.length === 0) return { ...base, kind: 'home' };
  if (segments.length === 1 && HOME_FILE_NAMES.some((name) => name === segments[0])) {
    return { ...base, kind: 'home' };
  }
  if (segments.length === 1 && segments[0] === 'f') {
    return { ...base, forumName: normalizeForumName(url.searchParams.get('kw')), kind: 'forum' };
  }
  if (segments[0] === 'p') {
    const threadId = toPositiveInteger(segments[1]);
    if (segments.length !== 2 || threadId === null) {
      return { ...base, kind: 'unsupported', reason: 'malformed-path' };
    }
    return {
      ...base,
      kind: 'thread',
      page: toPositiveInteger(url.searchParams.get('pn')) ?? 1,
      threadId,
    };
  }
  return { ...base, kind: 'unsupported', reason: 'unsupported-path' };
}

/**
 * Maps a recognized Tieba location onto the workbench route vocabulary. The home
 * feed travels as a `topic-list`/`latest` route and thread pages travel as
 * `topic` routes, both carrying the `site: 'tieba'` marker so site-specific
 * renderers can pick them up; every other Tieba page degrades to the unsupported
 * surface, which keeps the native site reachable.
 */
export function tiebaLocationToWorkbenchRoute(location: TiebaLocation): LinuxDoRoute {
  const { hash, href, pathname, search } = location;
  if (location.kind === 'home') {
    return { hash, href, kind: 'topic-list', pathname, search, site: 'tieba', view: 'latest' };
  }
  if (location.kind === 'thread') {
    return {
      hash,
      href,
      kind: 'topic',
      pathname,
      postNumber: null,
      search,
      site: 'tieba',
      topicId: location.threadId,
      topicSlug: 'thread',
    };
  }
  return {
    hash,
    href,
    kind: 'unsupported',
    pathname,
    reason: location.kind === 'unsupported' ? location.reason : 'unsupported-path',
    search,
    site: 'tieba',
  };
}

export function getTiebaLocationFamily(location: TiebaLocation): TiebaLocationFamily {
  return location.kind;
}

function normalizeForumName(value: string | null): string | null {
  const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function decodePathSegments(pathname: string): string[] | null {
  try {
    return pathname
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function routeBase(url: URL): TiebaRouteBase {
  return {
    hash: url.hash,
    href: url.href,
    pathname: url.pathname,
    search: url.search,
  };
}

function toPositiveInteger(value: string | undefined | null): number | null {
  if (!value || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toUrl(input: string | URL): URL | null {
  if (input instanceof URL) return input;
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function unsupportedLocation(
  reason: Extract<TiebaLocation, { readonly kind: 'unsupported' }>['reason'],
  href: string,
): TiebaLocation {
  return { hash: '', href, kind: 'unsupported', pathname: '', reason, search: '' };
}
