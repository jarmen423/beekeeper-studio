/** @jest-environment node */
import { ConnHandlers } from '@commercial/backend/handlers/connHandlers';
import { newState, state, removeState } from '@/handlers/handlerState';

jest.mock('@commercial/backend/lib/connection-provider', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/db/authentication/azure', () => ({ AzureAuthService: {} }));
jest.mock('@/common/platform_info', () => ({ __esModule: true, default: { testMode: true, userDirectory: './tmp' } }));
jest.mock('@/common/bksConfig', () => ({ __esModule: true, default: {} }));

describe('disconnect handler', () => {
  const sId = 'disconnect-test';
  beforeEach(() => newState(sId));
  afterEach(() => removeState(sId));

  it('disconnects an existing connection', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    state(sId).connection = { disconnect } as any;
    await expect(ConnHandlers['conn/disconnect']({ sId })).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('succeeds in a fresh utility session without a connection', async () => {
    await expect(ConnHandlers['conn/disconnect']({ sId })).resolves.toBeUndefined();
    await expect(ConnHandlers['conn/disconnect']({ sId })).resolves.toBeUndefined();
  });

  it('preserves failures from an existing connection', async () => {
    state(sId).connection = { disconnect: jest.fn().mockRejectedValue(new Error('Driver failed')) } as any;
    await expect(ConnHandlers['conn/disconnect']({ sId })).rejects.toThrow('Driver failed');
  });
});
