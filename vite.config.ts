import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiDevProxyPlugin } from './dev-server/ai-proxy-plugin';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Loaded here, at config time in Vite's Node process, and copied onto
  // process.env for aiDevProxyPlugin's handlers to read (via
  // api/_shared/anthropic-client.ts's process.env['ANTHROPIC_API_KEY']
  // lookup) — deliberately NOT returned from this function or passed
  // through Vite's `define`/`envPrefix`, either of which is how a variable
  // ends up embedded in the client bundle. See docs/backend-spec.md section 8.
  const env = loadEnv(mode, process.cwd(), '');
  if (env['ANTHROPIC_API_KEY']) {
    process.env['ANTHROPIC_API_KEY'] = env['ANTHROPIC_API_KEY'];
  }

  return {
    plugins: [react(), aiDevProxyPlugin()],
    build: {
      // three.js makes the single client bundle ~695 kB (~188 kB gzip). That's a
      // known, accepted size (lazy-loading Mode3D is a documented option, see
      // docs/PROJECT_MAP.md section 11), so the default 500 kB warning is just noise.
      chunkSizeWarningLimit: 900,
    },
  };
});
