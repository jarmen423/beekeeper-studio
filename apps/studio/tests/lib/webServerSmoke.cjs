/* eslint-disable @typescript-eslint/no-var-requires */
const { spawn } = require('child_process');
const { once } = require('events');
const { mkdtemp, rm } = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const Module = require('module');
const { WebSocket } = require('ws');
const esbuild = require('esbuild');

const cwd = path.resolve(__dirname, '../..');
const compiled = esbuild.buildSync({
  entryPoints: [path.join(cwd, 'src/common/wireCodec.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text;
const codecModule = new Module(__filename);
codecModule._compile(compiled, __filename);
const { encodeMessage, decodeMessage } = codecModule.exports;

function request(url, cookie = '') {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { Cookie: cookie } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}

async function main() {
  const windows = process.platform === 'win32';
  const child = spawn(windows ? process.env.ComSpec : 'yarn',
    windows ? ['/d', '/s', '/c', 'yarn web:serve'] : ['web:serve'],
    { cwd, env: { ...process.env, BKS_LOG_LEVEL: 'warn' } });
  let ws;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bks-web-smoke-'));
  try {
    const startup = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 30000);
      child.stdout.on('data', chunk => {
        const value = chunk.toString();
        process.stdout.write(value);
        output += value;
        const match = output.match(/Web server: (http:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(new URL(match[1])); }
      });
      child.stderr.on('data', chunk => process.stderr.write(chunk));
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited before token URL: ' + code)); });
      child.once('error', reject);
    });
    const origin = startup.origin;
    assert.equal((await request(origin + '/api/platform-info')).status, 401);
    console.log('API without token: 401');
    const login = await request(origin + '/api/platform-info' + startup.search);
    assert.equal(login.status, 303);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await request(origin + login.headers.location, cookie)).status, 200);
    console.log('API with token cookie after redirect: 200');
    const rejected = new WebSocket(origin.replace('http:', 'ws:') + '/ws', {
      headers: { Origin: 'http://bad.example', Cookie: cookie },
    });
    const badOrigin = await new Promise((resolve, reject) => {
      rejected.on('unexpected-response', (_request, response) => {
        response.resume(); rejected.terminate(); resolve(response.statusCode);
      });
      rejected.on('error', () => {});
      rejected.on('open', () => { rejected.close(); reject(new Error('Bad Origin accepted')); });
    });
    assert.equal(badOrigin, 403);
    console.log('WS bad Origin: 403');
    ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin, Cookie: cookie } });
    const [raw] = await once(ws, 'message');
    const init = decodeMessage(raw.toString());
    assert.equal(init.type, 'init');
    console.log('WS init:', init);
    let id = 0;
    const call = (name, args = {}) => {
      const requestId = String(++id);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Handler timed out: ' + name)), 15000);
        const listener = message => {
          const reply = decodeMessage(message.toString());
          if (reply.id !== requestId) return;
          clearTimeout(timeout);
          ws.off('message', listener);
          if (reply.type === 'error') reject(new Error(reply.error));
          else resolve(reply.data);
        };
        ws.on('message', listener);
        ws.send(encodeMessage({ id: requestId, name, args: { ...args, sId: init.sId } }));
      });
    }
    await call('conn/create', {
      osUser: os.userInfo().username,
      config: { connectionType: 'sqlite', defaultDatabase: path.join(directory, 'query.sqlite') },
    });
    await call('conn/connect');
    const result = await call('conn/executeQuery', {
      queryText: "select 1 as one, x'00ff' as bytes, NULL as empty",
      options: {},
    });
    console.dir(result, { depth: null });
    assert.equal(result[0].rows[0].one, 1n);
    assert.deepEqual(Array.from(result[0].rows[0].bytes), [0, 255]);
    await call('conn/disconnect');
    console.log('Real SQLite query: PASS');
  } finally {
    ws?.terminate();
    if (child.exitCode === null) {
      if (windows) await new Promise(resolve => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']).once('exit', resolve));
      else child.kill('SIGTERM');
    }
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
