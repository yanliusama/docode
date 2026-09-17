import { describe, expect, it } from 'vitest';

import {
  getSupportedSite,
  isLinuxDoUrl,
  isSupportedLocation,
  isSupportedUrl,
  isTiebaLocation,
  isTiebaUrl,
  SUPPORTED_SITE_MATCH_PATTERNS,
  TIEBA_MATCH_PATTERN,
  TIEBA_ORIGIN,
} from '../../src/linuxdo/host';

describe('Tieba host boundary', () => {
  it('accepts only the supported HTTPS origin', () => {
    expect(isTiebaLocation({ protocol: 'https:', hostname: 'tieba.baidu.com' })).toBe(true);
    expect(isTiebaLocation({ protocol: 'http:', hostname: 'tieba.baidu.com' })).toBe(false);
    expect(isTiebaLocation({ protocol: 'https:', hostname: 'www.tieba.baidu.com' })).toBe(false);
    expect(isTiebaLocation({ protocol: 'https:', hostname: 'tieba.baidu.com', port: '8443' })).toBe(
      false,
    );
    expect(isTiebaLocation({ protocol: 'https:', hostname: 'example.com' })).toBe(false);
  });

  it('keeps the canonical origin and content-script match explicit', () => {
    expect(TIEBA_ORIGIN).toBe('https://tieba.baidu.com');
    expect(TIEBA_MATCH_PATTERN).toBe('https://tieba.baidu.com/*');
    expect(SUPPORTED_SITE_MATCH_PATTERNS).toEqual([
      'https://linux.do/*',
      'https://tieba.baidu.com/*',
    ]);
  });

  it('classifies URLs against the supported site set', () => {
    expect(isTiebaUrl('https://tieba.baidu.com/?menu=true')).toBe(true);
    expect(isTiebaUrl('https://linux.do/latest')).toBe(false);
    expect(isLinuxDoUrl('https://linux.do/latest')).toBe(true);
    expect(isSupportedUrl('https://tieba.baidu.com/p/123')).toBe(true);
    expect(isSupportedUrl('https://linux.do/latest')).toBe(true);
    expect(isSupportedUrl('https://example.com/latest')).toBe(false);
    expect(isSupportedUrl('not a URL')).toBe(false);
  });

  it('reports which supported site owns a location', () => {
    expect(getSupportedSite({ protocol: 'https:', hostname: 'linux.do' })).toBe('linuxdo');
    expect(getSupportedSite({ protocol: 'https:', hostname: 'tieba.baidu.com' })).toBe('tieba');
    expect(getSupportedSite({ protocol: 'https:', hostname: 'example.com' })).toBeNull();
    expect(isSupportedLocation({ protocol: 'https:', hostname: 'tieba.baidu.com' })).toBe(true);
  });
});
