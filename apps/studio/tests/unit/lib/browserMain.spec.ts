import { fetchApi, installBrowserMain, openBrowserLink } from '@/lib/browserMain';

jest.mock('@/lib/webPortBridge', () => ({ createPortBridge: () => ({ start: jest.fn(), stop: jest.fn() }) }));

describe('browser main API', () => {
  afterEach(() => jest.restoreAllMocks());
  it('accepts only safe external URL protocols', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    openBrowserLink('https://example.com');
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    openBrowserLink('javascript:alert(1)');
    openBrowserLink('file:///etc/passwd');
    openBrowserLink('not a URL');
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('sets platform globals, resolves server paths, and treats file prompt cancellation as empty', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ isWindows: true, homeDirectory: 'C:/Users/test' }) } as Response);
    installBrowserMain();
    await window.main.requestPlatformInfo();
    expect(await window.main.defaultExportPath('export.sql')).toBe('C:/Users/test/export.sql');
    expect(window.main.resolve('db.sqlite')).toBe('C:/Users/test/db.sqlite');
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    expect(window.main.showOpenDialogSync({})).toBeUndefined();
    expect(window.main.showSaveDialogSync({})).toBeUndefined();
    expect(await window.main.fileHelpers.save({ fileName: 'query.sql', content: '' })).toBe(false);
    window.main.setWindowTitle('Query');
    expect(document.title).toBe('Query');
  });
  it('reports expired authentication rather than attempting to load invalid JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(fetchApi('platform-info')).rejects.toThrow('Open the tokenized server URL');
  });
});
