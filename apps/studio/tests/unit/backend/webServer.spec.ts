/** @jest-environment node */
import http from 'http';
import { once } from 'events';
import { WebSocket } from 'ws';
import { startWebServer, isSecureRequest } from '@commercial/backend/webServer';
import { encodeMessage, decodeMessage } from '@/common/wireCodec';
import { runHandler } from '@commercial/backend/utilityCore';
import { state } from '@/handlers/handlerState';
import platformInfo from '@/common/platform_info';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

jest.mock('@/common/platform_info', () => ({
  __esModule: true,
  default: { userDirectory: require('os').homedir(), appVersion: 'test', isDevelopment: true },
}));
jest.mock('@/common/bksConfig', () => ({ __esModule: true, default: { source: { test: true } } }));
jest.mock('@commercial/backend/utilityCore', () => ({
  init: jest.fn(), runHandler: jest.fn().mockResolvedValue(undefined), shutdown: jest.fn(),
}));
jest.mock('@/migration', () => ({ __esModule: true, default: jest.fn() }));

function request(port: number, route: string, cookie = '', body?: string, origin?: string, headers = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: body === undefined ? 'GET' : 'POST', headers: { ...headers, Cookie: cookie, ...(origin ? { Origin: origin } : {}) } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
    req.end(body);
  });
}

describe('web server transport', () => {
  it('trusts TLS and HTTPS forwarding only from loopback proxies', () => {
    const secure = (remoteAddress: string, forwarded?: string, encrypted = false) => isSecureRequest({
      socket: { remoteAddress, encrypted } as any,
      headers: forwarded ? { 'x-forwarded-proto': forwarded } : {},
    });
    expect(secure('192.0.2.1', undefined, true)).toBe(true);
    for (const host of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(secure(host, 'https')).toBe(true);
    expect(secure('127.0.0.1')).toBe(false);
    expect(secure('192.0.2.1', 'https')).toBe(false);
    expect(secure(undefined, 'https')).toBe(false);
    expect(secure('127.0.0.1', 'http')).toBe(false);
    expect(secure('127.0.0.1', 'https, http')).toBe(false);
  });
  it('persists generated tokens and serves static files with SPA fallback and cache policy', async () => {
    const oldToken = process.env.BKS_WEB_TOKEN;
    const oldPort = process.env.BKS_WEB_PORT;
    const oldHost = process.env.BKS_WEB_HOST;
    const oldDirectory = platformInfo.userDirectory;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bks-web-unit-'));
    platformInfo.userDirectory = directory;
    delete process.env.BKS_WEB_TOKEN;
    process.env.BKS_WEB_PORT = String(30000 + Math.floor(Math.random() * 20000));
    process.env.BKS_WEB_HOST = '127.0.0.1';
    let app: Awaited<ReturnType<typeof startWebServer>>;
    try {
      await writeFile(path.join(directory, 'index.html'), '<html>test</html>');
      await writeFile(path.join(directory, 'sw.js'), 'self.test = true;');
      await writeFile(path.join(directory, 'app.webmanifest'), '{}');
      app = await startWebServer(directory);
      const port = Number(process.env.BKS_WEB_PORT);
      const token = await readFile(path.join(directory, 'web-server-token'), 'utf8');
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const index = await request(port, '/');
      expect(index.body).toBe('<html>test</html>');
      expect(index.headers['cache-control']).toBe('no-cache');
      expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
      expect((await request(port, '/nested/spa/route')).body).toBe(index.body);
      expect((await request(port, '/sw.js')).headers['cache-control']).toBe('no-cache');
      expect((await request(port, '/app.webmanifest')).headers['content-type']).toBe('application/manifest+json');
      expect((await request(port, '/%2e%2e%5cprivate')).status).toBe(403);
      await app.stop();
      app = await startWebServer(directory);
      expect(await readFile(path.join(directory, 'web-server-token'), 'utf8')).toBe(token);
      expect((await request(port, '/api/username?token=' + token)).status).toBe(303);
    } finally {
      await app?.stop();
      platformInfo.userDirectory = oldDirectory;
      await rm(directory, { recursive: true, force: true });
      for (const [key, value] of Object.entries({ BKS_WEB_TOKEN: oldToken, BKS_WEB_PORT: oldPort, BKS_WEB_HOST: oldHost })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('authenticates API and WS, strips tokens, rejects bad origins and pins session IDs', async () => {
    const oldToken = process.env.BKS_WEB_TOKEN;
    const oldPort = process.env.BKS_WEB_PORT;
    const oldHost = process.env.BKS_WEB_HOST;
    process.env.BKS_WEB_TOKEN = 'test token; not a cookie';
    process.env.BKS_WEB_PORT = String(30000 + Math.floor(Math.random() * 20000));
    process.env.BKS_WEB_HOST = '127.0.0.1';
    const port = Number(process.env.BKS_WEB_PORT);
    let app: Awaited<ReturnType<typeof startWebServer>>;
    let ws: WebSocket;
    try {
      app = await startWebServer();
      expect((await request(port, '/api/platform-info')).status).toBe(401);
      expect((await request(port, '/api/platform-info?token=wrong')).status).toBe(401);
      const login = await request(port, '/api/platform-info?token=' + encodeURIComponent(process.env.BKS_WEB_TOKEN));
      expect(login.status).toBe(303);
      expect(login.headers.location).toBe('/api/platform-info');
      expect(login.headers['set-cookie'][0]).toContain('HttpOnly; SameSite=Strict; Path=/');
      expect(login.headers['set-cookie'][0]).toContain('Max-Age=34560000');
      expect(login.headers['set-cookie'][0]).not.toContain('; Secure');
      const secureLogin = await request(port, '/?token=' + encodeURIComponent(process.env.BKS_WEB_TOKEN), '', undefined, undefined, { 'X-Forwarded-Proto': 'https' });
      expect(secureLogin.headers['set-cookie'][0]).toContain('Max-Age=34560000; Secure');
      const cookie = login.headers['set-cookie'][0].split(';')[0];
      expect((await request(port, '/api/platform-info', cookie)).status).toBe(200);
      expect((await request(port, '/api/bks-config-source', cookie)).body).toBe('{"test":true}');
      expect((await request(port, '/api/missing', cookie)).status).toBe(404);
      const origin = `http://127.0.0.1:${port}`;
      const directory = await mkdtemp(path.join(os.tmpdir(), 'bks-web-save-'));
      try {
        const file = path.join(directory, 'query.sql');
        const body = encodeMessage({ path: file, content: 'select 1' });
        expect((await request(port, '/api/save-file', '', body, origin)).status).toBe(401);
        expect((await request(port, '/api/save-file', cookie, body, 'http://evil.example')).status).toBe(403);
        expect((await request(port, '/api/save-file', cookie, body)).status).toBe(403);
        expect((await request(port, '/api/save-file', cookie, body, origin)).status).toBe(200);
        expect(await readFile(file, 'utf8')).toBe('select 1');
        expect((await request(port, '/api/save-file', cookie, encodeMessage({ path: file, content: '' }), origin)).status).toBe(200);
        expect(await readFile(file, 'utf8')).toBe('');
        expect((await request(port, '/api/save-file', cookie, encodeMessage({ path: 'relative', content: '' }), origin)).status).toBe(400);
        expect((await request(port, '/api/save-file', cookie, 'invalid', origin)).status).toBe(400);
      } finally { await rm(directory, { recursive: true, force: true }); }
      const rejected = async (headers: Record<string, string>) => {
        return new Promise<number>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
          socket.on('unexpected-response', (_request, response) => {
            response.resume();
            socket.terminate();
            resolve(response.statusCode);
          });
          socket.on('error', () => {});
          socket.on('open', () => { socket.close(); reject(new Error('Unexpected upgrade')); });
        });
      }
      expect(await rejected({ Origin: origin })).toBe(401);
      expect(await rejected({ Origin: 'http://evil.example', Cookie: cookie })).toBe(403);
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin, Cookie: cookie } });
      const [message] = await once(ws, 'message');
      const init = decodeMessage(message.toString());
      expect(init.type).toBe('init');
      expect(typeof init.sId).toBe('string');
      const received = new Promise<void>(resolve => {
        (runHandler as jest.Mock).mockImplementationOnce(async (id, name, args) => {
          expect(id).toBe('1');
          expect(name).toBe('test/handler');
          expect(args.sId).toBe(init.sId);
          resolve();
        });
      });
      ws.send(encodeMessage({ id: '1', name: 'test/handler', args: { sId: 'another-session' } }));
      await received;
      const closed = once(ws, 'close');
      ws.send('not json');
      expect((await closed)[0]).toBe(1007);
      await new Promise(resolve => setImmediate(resolve));
      expect(state(init.sId)).toBeUndefined();
    } finally {
      ws?.terminate();
      await app?.stop();
      for (const [key, value] of Object.entries({ BKS_WEB_TOKEN: oldToken, BKS_WEB_PORT: oldPort, BKS_WEB_HOST: oldHost })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
