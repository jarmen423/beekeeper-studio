import { encodeMessage, decodeMessage } from '@/common/wireCodec';

const roundTrip = (value: any) => decodeMessage(encodeMessage(value));

describe('wire codec', () => {
  it('preserves primitive, empty and special values', () => {
    for (const value of [null, undefined, true, '', 0, -0, NaN, Infinity, -Infinity, BigInt('9007199254740993')]) {
      expect(Object.is(roundTrip(value), value)).toBe(true);
    }
    expect(roundTrip({ empty: [], missing: undefined, object: {} })).toEqual({ empty: [], missing: undefined, object: {} });
    expect(Object.keys(roundTrip({ missing: undefined }))).toEqual(['missing']);
  });

  it('preserves dates, binary views and containers', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const result = roundTrip({ date, invalid: new Date(NaN), bytes: Buffer.from([0, 255]), view: new Uint8Array([9, 0, 255, 8]).subarray(1, 3), map: new Map([[date, new Set([undefined, BigInt(1)])]]) });
    expect(result.date).toEqual(date);
    expect(Number.isNaN(result.invalid.getTime())).toBe(true);
    expect(Array.from(result.bytes)).toEqual([0, 255]);
    expect(Array.from(result.view)).toEqual([0, 255]);
    expect(result.map.get(result.date)).toEqual(new Set([undefined, BigInt(1)]));
  });

  it('preserves errors, shared references, cycles and tag-like user objects', () => {
    const error = Object.assign(new TypeError('failure'), { code: 'TEST', cause: new Error('cause') });
    const value: any = { error, tag: ['ref', 0], __protoKey: { version: 1, root: null, nodes: [] } };
    value.self = value;
    const result = roundTrip(value);
    expect(result.self).toBe(result);
    expect(result.tag).toEqual(['ref', 0]);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.name).toBe('TypeError');
    expect(result.error.message).toBe('failure');
    expect(result.error.code).toBe('TEST');
    expect(result.error.cause.message).toBe('cause');
    expect(result.error.stack).toBe(error.stack);
  });

  it('decodes binary as Uint8Array without a browser Buffer polyfill', () => {
    const json = encodeMessage(Buffer.from([0, 255]));
    const original = globalThis.Buffer;
    try {
      globalThis.Buffer = undefined;
      const result = decodeMessage(json);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([0, 255]);
    } finally {
      globalThis.Buffer = original;
    }
  });

  it('rejects malformed input and uncloneable values', () => {
    expect(() => decodeMessage('')).toThrow();
    expect(() => decodeMessage('{}')).toThrow('Invalid wire message');
    expect(() => decodeMessage('{"version":1,"root":["ref",5],"nodes":[]}')).toThrow('Invalid reference');
    expect(() => roundTrip(() => undefined)).toThrow('cannot be cloned');
  });
});
