import log from './rendererLogger';

log.transports.ipc = (() => {}) as typeof log.transports.ipc;

export default log;
