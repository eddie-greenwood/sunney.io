// WebSocket Client for Real-time Price Updates
class WebSocketClient {
  constructor(options = {}) {
    this.url = options.url || 'wss://api.sunney.io/api/ws';
    this.regions = options.regions || ['NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1'];
    this.onPriceUpdate = options.onPriceUpdate || null;
    this.onTradeUpdate = options.onTradeUpdate || null;
    this.onConnect = options.onConnect || null;
    this.onDisconnect = options.onDisconnect || null;
    this.reconnectDelay = 5000;
    this.maxReconnectDelay = 30000;
    this.reconnectAttempts = 0;
    this.ws = null;
    this.connected = false;
  }

  async connect() {
    try {
      // Get auth token
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('No authentication token');
      }

      // Build WebSocket URL with auth and regions
      const wsUrl = new URL(this.url);
      wsUrl.searchParams.set('token', token);
      wsUrl.searchParams.set('regions', this.regions.join(','));

      // Create WebSocket connection
      this.ws = new WebSocket(wsUrl.toString());

      // Connection opened
      this.ws.addEventListener('open', () => {
        console.log('WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 5000;
        
        if (this.onConnect) {
          this.onConnect();
        }
        
        // Subscribe to regions
        this.send({
          type: 'SUBSCRIBE',
          regions: this.regions
        });
      });

      // Message received
      this.ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      // Connection closed
      this.ws.addEventListener('close', () => {
        console.log('WebSocket disconnected');
        this.connected = false;
        
        if (this.onDisconnect) {
          this.onDisconnect();
        }
        
        // Attempt reconnection
        this.scheduleReconnect();
      });

      // Error occurred
      this.ws.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
      });

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'INITIAL':
        // Initial prices on connection
        if (this.onPriceUpdate && data.prices) {
          Object.values(data.prices).forEach(price => {
            this.onPriceUpdate(price);
          });
        }
        break;
        
      case 'PRICE_UPDATE':
        // Real-time price update
        if (this.onPriceUpdate && data.regions) {
          data.regions.forEach(region => {
            this.onPriceUpdate({
              ...region,
              timestamp: data.timestamp,
              settlement_date: data.settlement_date
            });
          });
        }
        break;
        
      case 'TRADE_UPDATE':
        // Trading activity update
        if (this.onTradeUpdate && data.trade) {
          this.onTradeUpdate(data.trade);
        }
        break;
        
      case 'PING':
        // Respond to keepalive ping
        this.send({ type: 'PONG' });
        break;
        
      case 'ERROR':
        console.error('Server error:', data.message);
        break;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= 10) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    console.log(`Reconnecting in ${delay / 1000} seconds...`);
    this.reconnectAttempts++;

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  updateRegions(regions) {
    this.regions = regions;
    if (this.connected) {
      this.send({
        type: 'SUBSCRIBE',
        regions: this.regions
      });
    }
  }

  isConnected() {
    return this.connected;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketClient;
}