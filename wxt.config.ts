import { defineConfig } from 'wxt';

import { LINUX_DO_MATCH_PATTERN, TIEBA_MATCH_PATTERN } from './src/linuxdo/host';

const GECKO_EXTENSION_ID = 'docode-tieba@linux.do';
const GECKO_MINIMUM_VERSION = '128.0';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'DOCode Tieba',
    description: "Do not try Ctrl+S here, it's not effective. Tieba edition.",
    permissions: ['storage'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
      default_title: 'DOCode Tieba',
    },
    web_accessible_resources: [
      {
        matches: [LINUX_DO_MATCH_PATTERN, TIEBA_MATCH_PATTERN],
        resources: ['docode.webmanifest'],
      },
    ],
    commands: {
      'toggle-docode': {
        description: 'Toggle DOCode workbench',
        suggested_key: {
          default: 'Alt+Shift+D',
          mac: 'MacCtrl+Shift+D',
        },
      },
    },
    // Firefox needs a stable add-on id to install an unsigned XPI, and the
    // MAIN-world reply bridge only exists from Firefox 128 onwards.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: { required: ['none'] },
              id: GECKO_EXTENSION_ID,
              strict_min_version: GECKO_MINIMUM_VERSION,
            },
          },
        }
      : {}),
  }),
  vite: () => ({ build: { sourcemap: false } }),
});
