// JWT Cache Module - Reduces auth overhead at scale
export class JWTCache {
  private cache: KVNamespace;
  private readonly TTL = 300; // 5 minutes in seconds

  constructor(cache: KVNamespace) {
    this.cache = cache;
  }

  async get(token: string): Promise<any | null> {
    const key = this.hashToken(token);
    const cached = await this.cache.get(key, 'json');
    
    if (cached) {
      // Check if still valid
      const now = Date.now();
      if (cached.expires > now) {
        return cached.payload;
      }
      // Expired, delete it
      await this.cache.delete(key);
    }
    
    return null;
  }

  async set(token: string, payload: any): Promise<void> {
    const key = this.hashToken(token);
    const data = {
      payload,
      expires: Date.now() + (this.TTL * 1000)
    };
    
    await this.cache.put(key, JSON.stringify(data), {
      expirationTtl: this.TTL
    });
  }

  async invalidate(userId: string): Promise<void> {
    // Invalidate all tokens for a user (on logout)
    // In production, maintain a list of token keys per user
    const userKey = `user:${userId}:tokens`;
    const tokenList = await this.cache.get(userKey, 'json') || [];
    
    await Promise.all(
      tokenList.map(tokenKey => this.cache.delete(tokenKey))
    );
    
    await this.cache.delete(userKey);
  }

  private hashToken(token: string): string {
    // Use first 16 chars of token as key (they're unique enough)
    // Full token is too long for KV key
    return `jwt:${token.substring(0, 16)}`;
  }
}