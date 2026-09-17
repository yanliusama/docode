export const LINUX_DO_ORIGIN = 'https://linux.do' as const;
export const LINUX_DO_MATCH_PATTERN = 'https://linux.do/*' as const;
export const TIEBA_ORIGIN = 'https://tieba.baidu.com' as const;
export const TIEBA_MATCH_PATTERN = 'https://tieba.baidu.com/*' as const;

type LocationIdentity = Pick<Location, 'hostname' | 'protocol'> & { readonly port?: string };

export type SupportedSite = 'linuxdo' | 'tieba';

/** Content-script match patterns for every site the workbench supports. */
export const SUPPORTED_SITE_MATCH_PATTERNS = [LINUX_DO_MATCH_PATTERN, TIEBA_MATCH_PATTERN] as const;

export function isLinuxDoLocation(location: LocationIdentity): boolean {
  return (
    location.protocol === 'https:' &&
    location.hostname === 'linux.do' &&
    (location.port === undefined || location.port === '')
  );
}

export function isLinuxDoUrl(value: string): boolean {
  try {
    return isLinuxDoLocation(new URL(value));
  } catch {
    return false;
  }
}

export function isTiebaLocation(location: LocationIdentity): boolean {
  return (
    location.protocol === 'https:' &&
    location.hostname === 'tieba.baidu.com' &&
    (location.port === undefined || location.port === '')
  );
}

export function isTiebaUrl(value: string): boolean {
  try {
    return isTiebaLocation(new URL(value));
  } catch {
    return false;
  }
}

export function getSupportedSite(location: LocationIdentity): SupportedSite | null {
  if (isLinuxDoLocation(location)) return 'linuxdo';
  if (isTiebaLocation(location)) return 'tieba';
  return null;
}

export function isSupportedLocation(location: LocationIdentity): boolean {
  return getSupportedSite(location) !== null;
}

export function isSupportedUrl(value: string): boolean {
  try {
    return isSupportedLocation(new URL(value));
  } catch {
    return false;
  }
}
