import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseTLS } from '../server/database-tls.js';

test('remote database connections require certificate and hostname verification', () => {
  assert.deepEqual(databaseTLS({ DB_HOST: '127.0.0.1' }), {});
  assert.deepEqual(databaseTLS({ DB_SOCKET: '/tmp/test-mysql.sock' }), {});
  const options = databaseTLS({ DB_HOST: 'database.example.com' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  assert.throws(() => databaseTLS({ DB_HOST: 'database.example.com', DB_TLS: 'false' }), /require verified TLS/);
  assert.throws(() => databaseTLS({ DB_HOST: '192.0.2.10' }), /certificate hostname/);
  assert.equal(databaseTLS({ DB_HOST: 'localhost', DB_TLS: 'required' }).ssl.verifyIdentity, true);
});
