#!/usr/bin/env node
/** Synthetic-only demo server. Never read LDAP settings or expose on public host ports. */
import { createOfflineDemoServer } from '../src/demo/http.js';

const server = createOfflineDemoServer();
server.requestTimeout = 120000;
server.listen(8789, '0.0.0.0', () => {
  console.log('Signaturee offline demo on :8789 (host port must bind loopback only)');
});
