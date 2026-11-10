import tls from 'tls';

process.env.BKS_WEB_SERVER = '1';
tls.DEFAULT_MIN_VERSION = 'TLSv1';

import('../backend/webServer').then(({ startWebServer }) => startWebServer()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
