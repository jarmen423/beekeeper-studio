/** @jest-environment node */
jest.mock('@bksLogger', () => ({ __esModule: true, default: { scope: () => ({ info: jest.fn() }) } }));

describe('SQL Anywhere native driver loading', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => jest.dontMock('sqlanywhere'));

  it('does not load the native driver when creating a pool', () => {
    const load = jest.fn(() => { throw new Error('Missing native binary'); });
    jest.doMock('sqlanywhere', load);
    const { SqlAnywherePool: Pool } = jest.requireActual('@commercial/backend/lib/db/clients/anywhere/SqlAnywherePool');
    expect(() => new Pool({})).not.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it('creates connections with the available native driver', () => {
    const raw = {};
    jest.doMock('sqlanywhere', () => ({ createConnection: jest.fn(() => raw) }));
    const { SqlAnywhereConn, SqlAnywherePool } = jest.requireActual('@commercial/backend/lib/db/clients/anywhere/SqlAnywherePool');
    const pool = new SqlAnywherePool({});
    const connection = new SqlAnywhereConn({ test: true }, pool);
    expect(connection.rawConnection).toBe(raw);
    expect(connection.pool).toBe(pool);
  });

  it('reports a clear error only when an unavailable driver is used', async () => {
    jest.doMock('sqlanywhere', () => { throw new Error('Missing native binary'); });
    const { SqlAnywherePool: Pool } = jest.requireActual('@commercial/backend/lib/db/clients/anywhere/SqlAnywherePool');
    const pool = new Pool({});
    await expect(pool.connect()).rejects.toThrow('SQL Anywhere driver is unavailable.');
    expect(pool.pool).toEqual([]);
  });
});
