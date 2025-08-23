// Trading Room Durable Object for real-time WebSocket connections
// Handles live price broadcasting and trading updates

export class TradingRoom {
  state: DurableObjectState;
  sessions: Map<WebSocket, SessionInfo> = new Map();
  lastPrices: Map<string, any> = new Map();
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    // Restore state
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get('lastPrices');
      if (stored) {
        this.lastPrices = new Map(Object.entries(stored));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      await this.handleSession(server, request);
      
      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }
    
    // Broadcast price update (called by scraper worker)
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const data = await request.json();
      await this.broadcastPrices(data);
      return new Response('Broadcast sent', { status: 200 });
    }
    
    // Get current sessions count
    if (url.pathname === '/stats') {
      return new Response(JSON.stringify({
        sessions: this.sessions.size,
        lastUpdate: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Trading Room Active', { status: 200 });
  }

  async handleSession(ws: WebSocket, request: Request) {
    // Accept the WebSocket connection
    ws.accept();
    
    // Extract session info from query params
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const regions = url.searchParams.get('regions')?.split(',') || ['NSW1'];
    
    const sessionInfo: SessionInfo = {
      userId,
      regions,
      connectedAt: new Date().toISOString()
    };
    
    this.sessions.set(ws, sessionInfo);
    
    // Send initial prices
    const initialData = {
      type: 'INITIAL',
      prices: Object.fromEntries(this.lastPrices),
      timestamp: new Date().toISOString()
    };
    ws.send(JSON.stringify(initialData));
    
    // Handle messages
    ws.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        await this.handleMessage(ws, data);
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          message: 'Invalid message format'
        }));
      }
    });
    
    // Handle disconnection
    ws.addEventListener('close', () => {
      this.sessions.delete(ws);
    });
    
    // Send keepalive pings
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // Every 30 seconds
  }

  async handleMessage(ws: WebSocket, data: any) {
    const session = this.sessions.get(ws);
    if (!session) return;
    
    switch (data.type) {
      case 'SUBSCRIBE':
        // Update subscription preferences
        if (data.regions) {
          session.regions = data.regions;
          this.sessions.set(ws, session);
        }
        break;
        
      case 'PONG':
        // Client responded to ping
        break;
        
      case 'TRADE':
        // Broadcast trade to relevant users
        await this.broadcastTrade(data, session.userId);
        break;
        
      default:
        ws.send(JSON.stringify({
          type: 'ERROR',
          message: `Unknown message type: ${data.type}`
        }));
    }
  }

  async broadcastPrices(priceData: any) {
    // Store latest prices
    for (const region of priceData.regions) {
      this.lastPrices.set(region.region, region);
    }
    
    // Persist to storage
    await this.state.storage.put('lastPrices', Object.fromEntries(this.lastPrices));
    
    // Broadcast to all connected clients
    this.sessions.forEach((session, ws) => {
      // Filter prices by client's subscribed regions
      const relevantPrices = priceData.regions.filter(
        r => session.regions.includes(r.region)
      );
      
      if (relevantPrices.length > 0) {
        const message = {
          type: 'PRICE_UPDATE',
          timestamp: priceData.timestamp,
          settlement_date: priceData.settlement_date,
          regions: relevantPrices
        };
        
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          // Client disconnected, remove from sessions
          this.sessions.delete(ws);
        }
      }
    });
  }

  async broadcastTrade(trade: any, userId: string) {
    const message = {
      type: 'TRADE_UPDATE',
      trade: {
        ...trade,
        userId,
        timestamp: new Date().toISOString()
      }
    };
    
    // Broadcast to all sessions
    this.sessions.forEach((session, ws) => {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        this.sessions.delete(ws);
      }
    });
  }
}

interface SessionInfo {
  userId: string | null;
  regions: string[];
  connectedAt: string;
}

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARCHIVE: R2Bucket;
}