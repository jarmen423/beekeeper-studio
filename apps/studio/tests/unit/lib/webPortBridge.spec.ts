/** @jest-environment node */
import { createPortBridge } from '@/lib/webPortBridge';
import { encodeMessage, decodeMessage } from '@/common/wireCodec';

describe('browser utility bridge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const setup = () => {
    const sockets: any[] = [];
    const channels: any[] = [];
    const deliver = jest.fn();
    const bridge = createPortBridge(deliver, () => {
      const socket: any = { readyState: 1, send: jest.fn(), close: jest.fn(() => socket.onclose()) };
      sockets.push(socket);
      return socket;
    }, () => {
      const channel: any = { port1: {}, port2: { postMessage: jest.fn(), start: jest.fn(), close: jest.fn() } };
      channels.push(channel);
      return channel;
    });
    return { bridge, sockets, channels, deliver };
  };
  it('waits for init and transfers codec messages in both directions', () => {
    const { bridge, sockets, channels, deliver } = setup();
    bridge.start(); bridge.start();
    expect(sockets).toHaveLength(1);
    expect(deliver).not.toHaveBeenCalled();
    sockets[0].onmessage({ data: encodeMessage({ type: 'init', sId: 'first' }) });
    expect(deliver).toHaveBeenCalledWith(channels[0].port1, 'first', false);
    const request = { id: 'one', name: 'query', args: { value: 1n } };
    channels[0].port2.onmessage({ data: request });
    expect(decodeMessage(sockets[0].send.mock.calls[0][0])).toEqual(request);
    const reply = { type: 'reply', id: 'one', data: new Date(0) };
    sockets[0].onmessage({ data: encodeMessage(reply) });
    expect(channels[0].port2.postMessage).toHaveBeenCalledWith(reply);
    bridge.stop();
  });
  it('rejects pending calls on drops, reconnects with a new port and reports utilDied', () => {
    const { bridge, sockets, channels, deliver } = setup();
    bridge.start();
    sockets[0].onmessage({ data: encodeMessage({ type: 'init', sId: 'one' }) });
    channels[0].port2.onmessage({ data: { id: 'pending', args: {} } });
    sockets[0].readyState = 3;
    sockets[0].onclose();
    expect(channels[0].port2.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', id: 'pending' }));
    jest.advanceTimersByTime(500);
    sockets[1].onmessage({ data: encodeMessage({ type: 'init', sId: 'two' }) });
    expect(deliver).toHaveBeenLastCalledWith(channels[1].port1, 'two', true);
    expect(channels[0].port2.close).toHaveBeenCalled();
    bridge.stop();
    jest.advanceTimersByTime(30000);
    expect(sockets).toHaveLength(2);
  });
  it('closes malformed sessions and backs off when the server is unavailable', () => {
    const { bridge, sockets, deliver } = setup();
    bridge.start();
    sockets[0].onmessage({ data: '{}' });
    expect(sockets[0].close).toHaveBeenCalledWith(1007, 'Invalid server message');
    expect(deliver).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    sockets[1].onerror();
    jest.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    bridge.stop();
  });
});
