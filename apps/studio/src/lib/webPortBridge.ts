import { decodeMessage, encodeMessage } from '@/common/wireCodec';

export function createPortBridge(deliver: (port: MessagePort, sId: string, utilDied: boolean) => void,
  socketFactory = () => new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`),
  channelFactory = () => new MessageChannel()) {
  let socket: WebSocket;
  let port: MessagePort;
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  let started = false;
  let connected = false;
  let delay = 500;
  const pending = new Set<string>();
  const reject = (id: string) => port?.postMessage({ type: 'error', id, error: 'Server connection lost. Reconnect to the database.', errorName: 'Error' });
  function connect() {
    socket = socketFactory();
    const initTimeout = setTimeout(() => socket.close(), 15000);
    let initialized = false;
    socket.onmessage = event => {
      try {
        const message = decodeMessage(event.data);
        if (!initialized) {
          if (message?.type !== 'init' || typeof message.sId !== 'string') throw new Error('Invalid session');
          clearTimeout(initTimeout);
          initialized = true;
          delay = 500;
          port?.close();
          const channel = channelFactory();
          port = channel.port2;
          port.onmessage = ({ data }) => {
            if (socket.readyState !== WebSocket.OPEN) return reject(data.id);
            try {
              socket.send(encodeMessage(data));
              pending.add(data.id);
            } catch {
              reject(data.id);
            }
          };
          port.start();
          deliver(channel.port1, message.sId, connected);
          connected = true;
        } else {
          pending.delete(message.id);
          port.postMessage(message);
        }
      } catch {
        socket.close(1007, 'Invalid server message');
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(initTimeout);
      pending.forEach(reject);
      pending.clear();
      if (!stopped) {
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      }
    };
  }
  return {
    start() { if (!started) { started = true; connect(); } },
    stop() { stopped = true; clearTimeout(timer); socket?.close(); port?.close(); },
  };
}
