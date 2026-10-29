#!/usr/bin/env node
/** Local template workbench; sample identity, no LDAP connection. */
import { createOfflineDemoServer } from '../src/demo/http.js';
import { loadLocalWorkbench } from '../src/demo/workbench.js';

// Validate startup config/templates before opening a browser port.
// Files are reloaded per request so local changes appear on refresh.
try {
  await loadLocalWorkbench();
} catch (err) {
  // Print only sanitized type/category plus a configured relative filename.
  console.error('FAIL:', err?.code || 'WORKBENCH_CONFIG_INVALID',
    typeof err?.filename === 'string' ? err.filename : '');
  process.exit(1);
}
const server = createOfflineDemoServer({
  loadContext: loadLocalWorkbench, mode: 'offline-workbench',
});
server.requestTimeout = 120000;
server.listen(8789, '0.0.0.0', () => {
  console.log('Signaturee offline template workbench ready (publish host port on loopback only).');
});
