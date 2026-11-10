export function serverPaths(windows: boolean, home: string) {
  const slashes = (value: string) => windows ? value.replace(/\\/g, '/') : value;
  function normalize(value: string) {
    value = slashes(value);
    const root = windows ? value.match(/^(?:[a-z]:\/|\/\/[^/]+\/[^/]+\/?|\/)/i)?.[0] || '' : value.startsWith('/') ? '/' : '';
    const parts: string[] = [];
    for (const part of value.slice(root.length).split('/')) {
      if (!part || part === '.') continue;
      if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (part === '..' && !root || part !== '..') parts.push(part);
    }
    return (root.replace(/\/$/, '') + (root ? '/' : '') + parts.join('/')) || '.';
  }
  const join = (...parts: string[]) => normalize(parts.filter(Boolean).join('/'));
  function resolve(...parts: string[]) {
    let result = home;
    for (const raw of parts) {
      const part = slashes(raw);
      if (/^[a-z]:\//i.test(part) && windows || part.startsWith('//') && windows || !windows && part.startsWith('/')) result = part;
      else if (windows && part.startsWith('/')) result = (result.match(/^[a-z]:/i)?.[0] || '') + part;
      else result = join(result, part);
    }
    return normalize(result);
  }
  function basename(value: string, ext = '') {
    const name = slashes(value).replace(/\/+$/, '').split('/').pop() || '';
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  }
  return { join, resolve, basename };
}
