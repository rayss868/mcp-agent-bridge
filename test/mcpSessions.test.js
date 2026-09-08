import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionRegistry } from '../src/mcpSessions.js';

function deferredTransport() {
  return {
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
    }
  };
}

test('expires inactive sessions and closes their transport', async () => {
  const transport = deferredTransport();
  const registry = createSessionRegistry({ ttlMs: 15 });

  registry.set('session-1', transport);
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(registry.get('session-1'), undefined);
  assert.equal(transport.closeCalls, 1);
  await registry.close();
});

test('touches sessions when they are accessed', async () => {
  const transport = deferredTransport();
  const registry = createSessionRegistry({ ttlMs: 30 });

  registry.set('session-1', transport);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(registry.get('session-1'), transport);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(registry.get('session-1'), transport);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(registry.get('session-1'), undefined);
  assert.equal(transport.closeCalls, 1);
  await registry.close();
});
