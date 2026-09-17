import type { CodiconName } from '../icons/codicon';
import {
  detectLinuxDoCapabilities,
  type ComposerCapability,
  type LinuxDoCapabilityDetection,
} from '../../linuxdo/capabilities';
import { extractTiebaTopic } from '../../tieba/topicAdapter';
import { extractTopicList, type TopicListExtraction } from '../../linuxdo/topicListAdapter';
import { extractTopic } from '../../linuxdo/topicAdapter';
import type { NativePostContentResolver, TopicExtraction } from '../../linuxdo/topicAdapter';
import type { LinuxDoRoute } from '../../linuxdo/routes';
import { extractTiebaThreadList } from '../../tieba/threadListAdapter';
import {
  createTopicDetailDocument,
  type TopicDetailDocument,
} from '../../views/topic/topicDetailDocument';
import {
  createTopicListDocument,
  type TopicListDocument,
} from '../../views/topicList/topicListDocument';

export type WorkbenchSurfaceStateKind = 'empty' | 'error' | 'loading' | 'ready' | 'unsupported';

export interface WorkbenchSurfaceState {
  readonly code: string | null;
  readonly description: string;
  readonly icon: CodiconName | null;
  readonly kind: WorkbenchSurfaceStateKind;
  readonly retryLabel: 'Refresh' | 'Retry' | null;
  readonly title: string;
}

export interface WorkbenchViewSnapshot {
  readonly nativeComposer: ComposerCapability | null;
  readonly surfaceState: WorkbenchSurfaceState;
  readonly topicDetailDocument: TopicDetailDocument | null;
  readonly topicListDocument: TopicListDocument | null;
}

export interface WorkbenchViewSnapshotOptions {
  readonly deferTopicListCompatibilityError?: boolean;
  readonly deferTopicCompatibilityError?: boolean;
  readonly likeStateOverrides?: ReadonlyMap<number, boolean> | undefined;
  readonly resolveNativeContent?: NativePostContentResolver | undefined;
}

const READY_STATE: WorkbenchSurfaceState = {
  code: null,
  description: '',
  icon: null,
  kind: 'ready',
  retryLabel: null,
  title: '',
};

export function createWorkbenchSurfaceState(
  document: Document,
  route: LinuxDoRoute,
): WorkbenchSurfaceState {
  return createWorkbenchViewSnapshot(document, route).surfaceState;
}

export function createWorkbenchViewSnapshot(
  document: Document,
  route: LinuxDoRoute,
  options: WorkbenchViewSnapshotOptions = {},
): WorkbenchViewSnapshot {
  if (route.site === 'tieba') return createTiebaViewSnapshot(document, route, options);

  if (route.kind === 'topic-list') {
    const extractedTopicList = extractTopicList(document, route);
    const extraction: TopicListExtraction =
      options.deferTopicListCompatibilityError && extractedTopicList.state === 'error'
        ? { issues: [], state: 'loading', topics: [] }
        : extractedTopicList;
    return {
      nativeComposer: null,
      surfaceState: createTopicListSurfaceState(extraction),
      topicDetailDocument: null,
      topicListDocument: createTopicListDocument(route, extraction),
    };
  }

  if (route.kind === 'topic') {
    const extractedTopic = extractTopic(document, route, {
      resolveNativeContent: options.resolveNativeContent,
    });
    const extraction: TopicExtraction =
      options.deferTopicCompatibilityError && extractedTopic.state === 'error'
        ? { issues: [], posts: [], state: 'loading', topic: null }
        : extractedTopic;
    const capabilities = detectLinuxDoCapabilities(document, route);
    const topicDetailDocument = createTopicDetailDocument(
      route,
      extraction,
      capabilities,
      options.likeStateOverrides,
    );
    const nativeComposer = capabilities.state === 'ready' ? capabilities.composer : null;
    switch (extraction.state) {
      case 'ready':
        return snapshot(READY_STATE, topicDetailDocument, nativeComposer);
      case 'loading':
        return snapshot(
          state(
            'loading',
            'topic-loading',
            'Loading topic…',
            'Waiting for Linux DO to finish rendering this topic.',
            'loading',
          ),
          topicDetailDocument,
          nativeComposer,
        );
      case 'error':
        return snapshot(
          state(
            'error',
            extraction.code,
            'Unable to read this topic',
            topicErrorDescription(extraction.code),
            'error',
            'Retry',
          ),
          topicDetailDocument,
          nativeComposer,
        );
    }
  }

  if (route.kind === 'search') return snapshot(READY_STATE);

  if (route.kind === 'unsupported') {
    return snapshot(
      state(
        'unsupported',
        route.reason,
        'Unsupported route',
        'DOCode does not support this Linux DO page. The original site remains available.',
        'warning',
      ),
    );
  }

  return snapshot(
    state(
      'unsupported',
      'view-not-implemented',
      'View not available',
      'This Linux DO view does not have a DOCode renderer yet. The original site remains available.',
      'info',
    ),
  );
}

function createTiebaViewSnapshot(
  document: Document,
  route: LinuxDoRoute,
  options: WorkbenchViewSnapshotOptions,
): WorkbenchViewSnapshot {
  if (route.kind === 'topic-list') {
    const extractedThreadList = extractTiebaThreadList(document);
    const extraction: TopicListExtraction =
      options.deferTopicListCompatibilityError && extractedThreadList.state === 'error'
        ? { issues: [], state: 'loading', topics: [] }
        : extractedThreadList;
    return {
      nativeComposer: null,
      surfaceState: createTiebaThreadListSurfaceState(extraction),
      topicDetailDocument: null,
      topicListDocument: createTopicListDocument(route, extraction),
    };
  }

  if (route.kind === 'topic') {
    const extractedTopic = extractTiebaTopic(document, route);
    const extraction: TopicExtraction =
      options.deferTopicCompatibilityError && extractedTopic.state === 'error'
        ? { issues: [], posts: [], state: 'loading', topic: null }
        : extractedTopic;
    return {
      nativeComposer: null,
      surfaceState: createTiebaTopicSurfaceState(extraction),
      topicDetailDocument: createTopicDetailDocument(route, extraction, TIEBA_TOPIC_DETECTION),
      topicListDocument: null,
    };
  }

  if (route.kind === 'unsupported') {
    return snapshot(
      state(
        'unsupported',
        route.reason,
        'Unsupported Tieba page',
        'DOCode renders the Tieba home feed only. The original page remains available.',
        'warning',
      ),
    );
  }

  return snapshot(
    state(
      'unsupported',
      'view-not-implemented',
      'View not available',
      'This Tieba view does not have a DOCode renderer yet. The original page remains available.',
      'info',
    ),
  );
}

// Tieba pages expose no Linux DO native-action surface, so every capability is
// reported as unsupported while the mirrored thread content stays readable.
const TIEBA_TOPIC_DETECTION: LinuxDoCapabilityDetection = {
  code: 'unsupported-route',
  diagnostics: [{ code: 'unsupported-route', feature: 'current-user', postNumber: null }],
  state: 'unsupported',
};

function createTiebaTopicSurfaceState(extraction: TopicExtraction): WorkbenchSurfaceState {
  switch (extraction.state) {
    case 'ready':
      return READY_STATE;
    case 'loading':
      return state(
        'loading',
        'topic-loading',
        'Loading thread…',
        'Waiting for Tieba to finish rendering this thread.',
        'loading',
      );
    case 'error':
      return state(
        'error',
        extraction.code,
        'Unable to read this thread',
        'Tieba did not expose this thread in a readable shape.',
        'error',
        'Retry',
      );
  }
}

function createTiebaThreadListSurfaceState(extraction: TopicListExtraction): WorkbenchSurfaceState {
  switch (extraction.state) {
    case 'ready':
      return READY_STATE;
    case 'loading':
      return state(
        'loading',
        'topic-list-loading',
        'Loading threads…',
        'Waiting for Tieba to finish rendering the feed.',
        'loading',
      );
    case 'empty':
      return state(
        'empty',
        'topic-list-empty',
        'No threads',
        'Tieba exposed no threads on this page. Sign in on Tieba when the feed looks empty.',
        'info',
        'Refresh',
      );
    case 'error':
      return state(
        'error',
        extraction.code,
        'Unable to read threads',
        'Tieba did not expose its thread feed in a readable shape.',
        'error',
        'Retry',
      );
  }
}

function createTopicListSurfaceState(extraction: TopicListExtraction): WorkbenchSurfaceState {
  switch (extraction.state) {
    case 'ready':
      return READY_STATE;
    case 'loading':
      return state(
        'loading',
        'topic-list-loading',
        'Loading topics…',
        'Waiting for Linux DO to finish rendering this view.',
        'loading',
      );
    case 'empty':
      return state(
        'empty',
        'topic-list-empty',
        'No topics',
        'Linux DO returned no topics for this view.',
        'info',
        'Refresh',
      );
    case 'error':
      return state(
        'error',
        extraction.code,
        'Unable to read topics',
        topicListErrorDescription(extraction.code),
        'error',
        'Retry',
      );
  }
}

function snapshot(
  surfaceState: WorkbenchSurfaceState,
  topicDetailDocument: TopicDetailDocument | null = null,
  nativeComposer: ComposerCapability | null = null,
): WorkbenchViewSnapshot {
  return { nativeComposer, surfaceState, topicDetailDocument, topicListDocument: null };
}

function state(
  kind: Exclude<WorkbenchSurfaceStateKind, 'ready'>,
  code: string,
  title: string,
  description: string,
  icon: CodiconName,
  retryLabel: WorkbenchSurfaceState['retryLabel'] = null,
): WorkbenchSurfaceState {
  return { code, description, icon, kind, retryLabel, title };
}

function topicListErrorDescription(code: string): string {
  return code === 'topic-rows-unreadable'
    ? 'The Linux DO topic rows could not be read safely.'
    : 'Linux DO did not expose the expected topic list.';
}

function topicErrorDescription(code: string): string {
  switch (code) {
    case 'post-stream-not-found':
      return 'Linux DO did not expose the expected post stream.';
    case 'post-stream-unreadable':
      return 'The Linux DO post stream could not be read safely.';
    case 'topic-metadata-not-found':
      return 'Linux DO did not expose readable topic metadata.';
    default:
      return 'The current Linux DO topic could not be read safely.';
  }
}
