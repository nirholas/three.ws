export function createIpRateLimiter({
  limit,
  windowMs,
  maxEntries = 5000,
  cleanupIntervalMs = 30 * 1000,
}) {
  const records = new Map();
  let lastCleanupAt = 0;

  function cleanup(now) {
    if (now - lastCleanupAt < cleanupIntervalMs && records.size <= maxEntries) {
      return;
    }
    lastCleanupAt = now;

    const cutoff = now - windowMs;
    for (const [ip, record] of records) {
      if (record.windowStart < cutoff) {
        records.delete(ip);
      }
    }

    if (records.size <= maxEntries) {
      return;
    }

    const overflow = records.size - maxEntries;
    const oldest = Array.from(records.entries())
      .sort((a, b) => a[1].windowStart - b[1].windowStart);
    for (let i = 0; i < overflow; i++) {
      const entry = oldest[i];
      if (!entry) break;
      records.delete(entry[0]);
    }
  }

  function check(ip) {
    const now = Date.now();
    cleanup(now);

    const key = (ip || 'unknown').trim() || 'unknown';
    const record = records.get(key);

    if (!record || now - record.windowStart > windowMs) {
      records.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (record.count >= limit) {
      return false;
    }

    record.count += 1;
    return true;
  }

  return {
    check,
    size: () => records.size,
  };
}
