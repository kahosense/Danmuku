import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Netflix AI Danmaku (Dev)',
  version: '0.0.0',
  description: 'AI-generated virtual audience danmaku overlay for Netflix (development build).',
  minimum_chrome_version: '114',
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png'
    }
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['https://www.netflix.com/watch/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ],
  permissions: ['scripting', 'storage', 'tabs', 'activeTab', 'alarms'],
  host_permissions: ['https://www.netflix.com/*'],
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  web_accessible_resources: [
    {
      resources: ['assets/*', 'content/*'],
      matches: ['https://www.netflix.com/*']
    }
  ]
});
