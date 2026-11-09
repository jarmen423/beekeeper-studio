/** @jest-environment node */
import { serverPaths } from '@/lib/webPaths';

describe('server paths', () => {
  it('joins and resolves POSIX paths without escaping roots', () => {
    const paths = serverPaths(false, '/home/test');
    expect(paths.join('/home', 'a', '..', 'b')).toBe('/home/b');
    expect(paths.resolve('../db.sqlite')).toBe('/home/db.sqlite');
    expect(paths.resolve('/../../db.sqlite')).toBe('/db.sqlite');
    expect(paths.join()).toBe('.');
    expect(paths.resolve('')).toBe('/home/test');
    expect(paths.basename('/tmp/a.sql', '.sql')).toBe('a');
    expect(paths.basename('')).toBe('');
  });
  it('accepts mixed Windows separators, drive roots, and UNC shares', () => {
    const paths = serverPaths(true, 'C:\\Users\\test');
    expect(paths.join('C:\\Users', 'test/a', '..', 'b')).toBe('C:/Users/test/b');
    expect(paths.resolve('..\\db.sqlite')).toBe('C:/Users/db.sqlite');
    expect(paths.resolve('D:\\data\\..\\db.sqlite')).toBe('D:/db.sqlite');
    expect(paths.resolve('\\data\\db.sqlite')).toBe('C:/data/db.sqlite');
    expect(paths.resolve('\\\\server\\share\\..\\db.sqlite')).toBe('//server/share/db.sqlite');
    expect(paths.basename('C:\\data\\a.sql', '.sql')).toBe('a');
  });
});
