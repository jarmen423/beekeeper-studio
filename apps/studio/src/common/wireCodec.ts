type Value = null | boolean | string | number | [string, any?];
type Node = [string, any];

export function encodeMessage(message: any): string {
  const nodes: Node[] = [];
  const seen = new Map<object, number>();
  function encode(value: any): Value {
    if (value === undefined) return ['undefined'];
    if (typeof value === 'bigint') return ['bigint', value.toString()];
    if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
      return ['number', Object.is(value, -0) ? '-0' : String(value)];
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError('Value cannot be cloned');
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return ['ref', seen.get(value)];
    const id = nodes.length;
    seen.set(value, id);
    nodes.push(null);
    let node: Node;
    if (value instanceof Date) node = ['date', encode(value.getTime())];
    else if ((typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) || value instanceof Uint8Array) {
      node = ['bytes', Array.from(value)];
    }
    else if (value instanceof ArrayBuffer) node = ['buffer', Array.from(new Uint8Array(value))];
    else if (value instanceof Map) node = ['map', Array.from(value, ([k, v]) => [encode(k), encode(v)])];
    else if (value instanceof Set) node = ['set', Array.from(value, encode)];
    else if (value instanceof Error) {
      node = ['error', {
        name: value.name, message: value.message, stack: value.stack,
        properties: Object.entries(value).map(([k, v]) => [k, encode(v)]),
        cause: encode((value as Error & { cause?: any }).cause),
      }];
    } else if (Array.isArray(value)) node = ['array', Array.from(value, encode)];
    else node = ['object', Object.entries(value).map(([k, v]) => [k, encode(v)])];
    nodes[id] = node;
    return ['ref', id];
  }
  const root = encode(message);
  return JSON.stringify({ version: 1, root, nodes });
}

export function decodeMessage(json: string): any {
  const { version, root, nodes } = JSON.parse(json);
  if (version !== 1 || !Array.isArray(nodes)) throw new TypeError('Invalid wire message');
  const values = new Map<number, any>();
  function decode(value: Value): any {
    if (!Array.isArray(value)) return value;
    const [type, data] = value;
    if (type === 'undefined') return undefined;
    if (type === 'bigint') return BigInt(data);
    if (type === 'number') {
      if (!['NaN', 'Infinity', '-Infinity', '-0'].includes(data)) throw new TypeError('Invalid number');
      return Number(data);
    }
    if (type !== 'ref' || !Number.isInteger(data) || !nodes[data]) throw new TypeError('Invalid reference');
    if (values.has(data)) return values.get(data);
    const [kind, content] = nodes[data];
    let result: any;
    switch (kind) {
      case 'date': result = new Date(decode(content)); break;
      case 'bytes':
        result = typeof Buffer !== 'undefined' ? Buffer.from(content) : new Uint8Array(content);
        break;
      case 'buffer': result = new Uint8Array(content).buffer; break;
      case 'map': result = new Map(); break;
      case 'set': result = new Set(); break;
      case 'array': result = []; break;
      case 'object': result = {}; break;
      case 'error': result = new Error(content.message); break;
      default: throw new TypeError('Invalid wire node');
    }
    values.set(data, result);
    if (kind === 'map') content.forEach(([k, v]) => result.set(decode(k), decode(v)));
    else if (kind === 'set') content.forEach(v => result.add(decode(v)));
    else if (kind === 'array') content.forEach(v => result.push(decode(v)));
    else if (kind === 'object' || kind === 'error') {
      const entries = kind === 'error' ? content.properties : content;
      entries.forEach(([k, v]) => Object.defineProperty(result, k, {
        value: decode(v), enumerable: true, configurable: true, writable: true,
      }));
      if (kind === 'error') {
        result.name = content.name;
        result.stack = content.stack;
        result.cause = decode(content.cause);
      }
    }
    return result;
  }
  return decode(root);
}
