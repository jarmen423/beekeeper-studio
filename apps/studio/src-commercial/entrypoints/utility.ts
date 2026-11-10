import rawLog from '@bksLogger';
import { init, initState } from '../backend/utilityCore';
import { removeState, state } from '@/handlers/handlerState';

const log = rawLog.scope('UtilityProcess');

process.parentPort.on('message', async ({ data, ports }) => {
  const { type, sId } = data;
  switch (type) {
    case 'init':
      if (ports && ports.length > 0) {
        log.info('RECEIVED PORT: ', ports[0]);
        await initState(sId, ports[0]);
      } else {
        await init();
        process.parentPort.postMessage({ type: 'ready' });
      }
      break;
    case 'close':
      log.info('REMOVING STATE FOR: ', sId);
      state(sId).port.close();
      await removeState(sId);
      break;
    default:
      log.error('UNRECOGNIZED MESSAGE TYPE RECEIVED FROM MAIN PROCESS');
  }
})
