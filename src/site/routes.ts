import { isTiebaLocation } from '../linuxdo/host';
import { recognizeLinuxDoRoute, type LinuxDoRoute } from '../linuxdo/routes';
import { recognizeTiebaLocation, tiebaLocationToWorkbenchRoute } from '../tieba/routes';

/**
 * Recognizes a workbench route for every supported site. Linux DO keeps its
 * existing recognizer untouched; Tieba locations are mapped onto the shared
 * route vocabulary with the `site: 'tieba'` marker.
 */
export function recognizeSiteRoute(input: string | URL): LinuxDoRoute {
  const url = toUrl(input);
  if (url && isTiebaLocation(url)) {
    return tiebaLocationToWorkbenchRoute(recognizeTiebaLocation(url));
  }
  return recognizeLinuxDoRoute(input);
}

function toUrl(input: string | URL): URL | null {
  if (input instanceof URL) return input;
  try {
    return new URL(input);
  } catch {
    return null;
  }
}
