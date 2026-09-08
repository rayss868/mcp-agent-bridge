export function createSessionRegistry({ ttlMs }) {
  const sessions = new Map();
  let closed = false;

  const closeTransport = (transport) => Promise.resolve()
    .then(() => transport.close())
    .catch((error) => {
      console.error(`[mcp-agent-bridge] session transport close failed: ${error.message}`);
    });

  const scheduleExpiry = (sessionId, entry) => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      if (sessions.get(sessionId) !== entry) return;
      sessions.delete(sessionId);
      await closeTransport(entry.transport);
    }, ttlMs);
    entry.timer.unref?.();
  };

  const set = (sessionId, transport) => {
    if (closed) throw new Error('Session registry is closed');

    const previous = sessions.get(sessionId);
    if (previous) clearTimeout(previous.timer);

    const entry = { transport, timer: null };
    sessions.set(sessionId, entry);
    scheduleExpiry(sessionId, entry);
    return transport;
  };

  const get = (sessionId) => {
    const entry = sessions.get(sessionId);
    if (!entry) return undefined;
    scheduleExpiry(sessionId, entry);
    return entry.transport;
  };

  const remove = (sessionId) => {
    const entry = sessions.get(sessionId);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    sessions.delete(sessionId);
    return entry.transport;
  };

  const close = async () => {
    if (closed) return;
    closed = true;

    const entries = [...sessions.values()];
    for (const entry of entries) clearTimeout(entry.timer);
    sessions.clear();
    await Promise.all(entries.map((entry) => closeTransport(entry.transport)));
  };

  return {
    set,
    get,
    remove,
    close,
    get size() {
      return sessions.size;
    }
  };
}
