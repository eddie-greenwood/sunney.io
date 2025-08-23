// Tiered Cache Manager for Scalability
// Implements KV → Cache API → D1 hierarchy

export class CacheManager {
  private kv: KVNamespace;
  private cacheApi: Cache;
  
  constructor(kv: KVNamespace) {
    this.kv = kv;
    this.cacheApi = caches.default;
  }

  // Tiered get: Try KV first, then Cache API, then miss
  async get(key: string, request?: Request): Promise<any | null> {
    // Tier 1: KV (fastest, <10ms)
    const kvData = await this.kv.get(key, 'json');
    if (kvData) {
      return { data: kvData, source: 'kv' };
    }

    // Tier 2: Cache API (fast, <50ms)
    if (request) {
      const cacheResponse = await this.cacheApi.match(request);
      if (cacheResponse) {
        const data = await cacheResponse.json();
        // Promote to KV for next time
        await this.kv.put(key, JSON.stringify(data), {
          expirationTtl: 60 // 1 minute in KV
        });
        return { data, source: 'cache-api' };
      }
    }

    // Cache miss
    return null;
  }

  // Tiered set: Write to both KV and Cache API
  async set(
    key: string, 
    data: any, 
    ttl: number = 60,
    request?: Request,
    response?: Response
  ): Promise<void> {
    // Write to KV (Tier 1)
    await this.kv.put(key, JSON.stringify(data), {
      expirationTtl: ttl
    });

    // Write to Cache API (Tier 2) if we have request/response
    if (request && response) {
      // Clone response and add cache headers
      const cacheResponse = new Response(JSON.stringify(data), {
        status: response.status,
        headers: {
          ...response.headers,
          'Cache-Control': `public, max-age=${ttl}`,
          'X-Cache-Tier': 'cache-api'
        }
      });

      await this.cacheApi.put(request, cacheResponse);
    }
  }

  // Invalidate across all tiers
  async invalidate(pattern: string): Promise<void> {
    // Invalidate KV entries
    // Note: KV doesn't support wildcard delete, so track keys
    const keys = await this.listKeys(pattern);
    await Promise.all(keys.map(key => this.kv.delete(key)));

    // Cache API doesn't support pattern invalidation directly
    // Would need to track URLs for complete invalidation
  }

  // Track keys for invalidation (simple implementation)
  private async listKeys(pattern: string): Promise<string[]> {
    // In production, maintain a set of keys in KV
    const indexKey = `index:${pattern}`;
    const index = await this.kv.get(indexKey, 'json') || [];
    return index;
  }

  // Add key to tracking index
  async trackKey(key: string, pattern: string): Promise<void> {
    const indexKey = `index:${pattern}`;
    const index = await this.kv.get(indexKey, 'json') || [];
    if (!index.includes(key)) {
      index.push(key);
      await this.kv.put(indexKey, JSON.stringify(index), {
        expirationTtl: 3600 // 1 hour
      });
    }
  }
}

// Request coalescing to prevent duplicate queries
export class RequestCoalescer {
  private pending: Map<string, Promise<any>> = new Map();
  
  async coalesce<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // Check if request is already in flight
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    // Start new request
    const promise = fetcher().finally(() => {
      // Clean up after completion
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}