import http from 'http';
import { createReadStream } from 'fs';
import { mkdir, readFile, writeFile, stat, realpath } from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import platformInfo from '@/common/platform_info';
import bksConfig from '@/common/bksConfig';
import { decodeMessage, encodeMessage } from '@/common/wireCodec';
import { newState, removeState, state } from '@/handlers/handlerState';
import { init, runHandler, shutdown } from './utilityCore';
import Migration from '@/migration';
import yargs from 'yargs-parser';
import type { TLSSocket } from 'tls';

export function isSecureRequest(request: Pick<http.IncomingMessage, 'socket' | 'headers'>) {
  if ((request.socket as TLSSocket).encrypted) return true;
  const remote = request.socket.remoteAddress;
  const loopback = remote === '::1' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1';
  return loopback && request.headers['x-forwarded-proto'] === 'https';
}

const cookieName = 'bks_web_token';
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.map': 'application/json',
};

async function loadToken() {
  if (process.env.BKS_WEB_TOKEN) return process.env.BKS_WEB_TOKEN;
  const file = path.join(platformInfo.userDirectory, 'web-server-token');
  try {
    await writeFile(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const token = (await readFile(file, 'utf8')).trim();
  if (!token) throw new Error('Empty web server token file');
  return token;
}

export async function startWebServer(webRoot = path.resolve(__dirname, 'web')) {
  const args = yargs(process.argv.slice(2));
  const host = String(args.host || process.env.BKS_WEB_HOST || '127.0.0.1');
  const port = Number(args.port || process.env.BKS_WEB_PORT || 7457);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid web server port');
  await mkdir(platformInfo.userDirectory, { recursive: true });
  const token = await loadToken();
  const tokenHash = createHash('sha256').update(token).digest();
  function validToken(value: string) {
    return timingSafeEqual(tokenHash, createHash('sha256').update(value || '').digest());
  }
  function authenticated(request: http.IncomingMessage) {
    const cookie = request.headers.cookie?.split(';').map(v => v.trim())
      .find(v => v.startsWith(cookieName + '='));
    try {
      return validToken(decodeURIComponent(cookie?.slice(cookieName.length + 1) || ''));
    } catch {
      return false;
    }
  }
  await init(async connection => {
    await new Migration(connection, platformInfo.isDevelopment ? 'development' : 'production').run();
  });
  const root = path.resolve(webRoot);
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.searchParams.has('token')) {
        if (!validToken(url.searchParams.get('token'))) {
          response.writeHead(401).end('Unauthorized');
          return;
        }
        response.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000${isSecureRequest(request) ? '; Secure' : ''}`);
        response.setHeader('Cache-Control', 'no-store');
        url.searchParams.delete('token');
        response.writeHead(303, { Location: '/' + url.pathname.replace(/^\/+/, '') + url.search }).end();
        return;
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/ws') {
        response.setHeader('Cache-Control', 'no-store');
        if (!authenticated(request)) {
          response.writeHead(401).end('Unauthorized');
          return;
        }
        if (url.pathname === '/api/save-file' && request.method === 'POST') {
          const origin = request.headers.origin;
          if (!origin || !['http:', 'https:'].includes(new URL(origin).protocol) || new URL(origin).host !== request.headers.host) {
            response.writeHead(403).end('Invalid origin');
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) {
              response.writeHead(413).end('File too large');
              return;
            }
            chunks.push(chunk);
          }
          const options = decodeMessage(Buffer.concat(chunks).toString());
          if (typeof options.path !== 'string' || !path.isAbsolute(options.path) ||
            !(typeof options.content === 'string' || options.content instanceof Uint8Array)) {
            response.writeHead(400).end('An absolute server path and file content are required');
            return;
          }
          await writeFile(options.path, options.content, { encoding: options.encoding || 'utf8' });
          response.writeHead(200).end('Saved');
          return;
        }
        if (request.method !== 'GET') {
          response.writeHead(405).end();
          return;
        }
        const routes = {
          '/api/platform-info': platformInfo,
          '/api/bks-config-source': bksConfig.source,
          '/api/username': os.userInfo().username,
        };
        if (!Object.hasOwn(routes, url.pathname)) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(routes[url.pathname]));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const candidate = path.resolve(root, '.' + pathname);
      if (!candidate.startsWith(root + path.sep) && candidate !== root) {
        response.writeHead(403).end();
        return;
      }
      let file = candidate;
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) file = path.join(root, 'index.html');
      const resolved = await realpath(file);
      const resolvedRoot = await realpath(root);
      if (!resolved.startsWith(resolvedRoot + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const name = path.basename(file);
      response.setHeader('Cache-Control', ['sw.js', 'index.html'].includes(name) ? 'no-cache' : 'public, max-age=3600');
      response.setHeader('Content-Type', mimeTypes[path.extname(file)] || 'application/octet-stream');
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const sessions = new Map<string, Promise<void>>();
  server.on('upgrade', (request, socket, head) => {
    const reject = (status: number) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    };
    if (request.url !== '/ws') return reject(404);
    if (!authenticated(request)) return reject(401);
    try {
      const origin = new URL(request.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) return reject(403);
    } catch { return reject(403); }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', (ws: WebSocket) => {
    const sId = randomUUID();
    newState(sId);
    const pending = new Set<Promise<any>>();
    const send = (message: any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encodeMessage(message));
    };
    state(sId).port = { postMessage: send, close: () => ws.close(), start: () => {}, on: () => {} };
    send({ type: 'init', sId });
    ws.on('error', error => console.error('WebSocket error:', error.message));
    ws.on('message', message => {
      try {
        const data = decodeMessage(message.toString());
        if (!data || typeof data.id !== 'string' || typeof data.name !== 'string' ||
          !data.args || typeof data.args !== 'object' || Array.isArray(data.args)) throw new Error('Invalid request');
        const task = runHandler(data.id, data.name, { ...data.args, sId });
        pending.add(task);
        task.catch(error => console.error(error)).finally(() => pending.delete(task));
      } catch {
        ws.close(1007, 'Invalid request');
      }
    });
    let finish: () => void;
    sessions.set(sId, new Promise(resolve => { finish = resolve; }));
    ws.on('close', async () => {
      try {
        const session = state(sId);
        session.connectionAbortController?.abort();
        session.transactionTimeouts.forEach(clearTimeout);
        session.watcher = null;
        await Promise.allSettled(Array.from(pending));
        await session.server?.disconnect();
        await removeState(sId);
      } catch (error) {
        console.error(error);
      } finally {
        finish();
        sessions.delete(sId);
      }
    });
  });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    process.removeListener('SIGINT', handleStop);
    process.removeListener('SIGTERM', handleStop);
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close();
    wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
    await Promise.allSettled(Array.from(sessions.values()));
    wss.close();
    await shutdown();
    clearTimeout(timeout);
  }
  function handleStop() {
    stop().catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  process.once('SIGINT', handleStop);
  process.once('SIGTERM', handleStop);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const urlHost = host.includes(':') ? `[${host}]` : host;
  console.log(`Web server: http://${urlHost}:${port}/?token=${encodeURIComponent(token)}`);
  return { server, wss, stop };
}
