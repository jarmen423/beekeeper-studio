import { mergeConfig } from 'vite';
import base from './vite.config.mjs';
import { resolve } from 'path';
import { rename, readFile, writeFile, readdir } from 'fs/promises';
import { createHash } from 'crypto';

export default mergeConfig(base, {
  publicDir: 'public-web',
  plugins: [{
    name: 'web-index',
    apply: 'build',
    async closeBundle() {
      await rename('dist/web/index-web.html', 'dist/web/index.html');
      const assets = (await readdir('dist/web/assets')).map(name => '/assets/' + name);
      const version = createHash('sha256').update(assets.join()).digest('hex').slice(0, 12);
      const worker = await readFile('dist/web/sw.js', 'utf8');
      await writeFile('dist/web/sw.js', worker.replace('__BUILD__', version).replace('/* ASSETS */', assets.map(name => JSON.stringify(name)).join(',')));
    },
  }],
  build: {
    outDir: 'dist/web',
    rollupOptions: { input: resolve('index-web.html'), output: { format: 'es' } },
  },
  server: {
    port: 3004,
    proxy: { '/api': 'http://127.0.0.1:7457', '/ws': { target: 'ws://127.0.0.1:7457', ws: true } },
  },
});
