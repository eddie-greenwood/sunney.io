// Sunney.io API Client
// Centralized API calls for all apps

class SunneyAPI {
    constructor() {
        this.auth = window.sunneyAuth;
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute default
    }

    // Prices API
    async getLatestPrices() {
        const cacheKey = 'prices:latest';
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const data = await this.auth.apiCall('/api/prices/latest');
        this.setCache(cacheKey, data, 60000); // Cache for 1 minute
        return data;
    }

    async getPriceHistory(region, hours = 24) {
        return await this.auth.apiCall(`/api/prices/history/${region}?hours=${hours}`);
    }

    // Forward Prices API
    async getForwardPrices(region, date) {
        const params = date ? `?date=${date}` : '';
        return await this.auth.apiCall(`/api/forward/${region}${params}`);
    }

    async getAllForwardPrices() {
        const cacheKey = 'forward:all';
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const regions = ['NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1'];
        const promises = regions.map(region => this.getForwardPrices(region));
        const results = await Promise.all(promises);
        
        const data = {};
        regions.forEach((region, i) => {
            data[region] = results[i];
        });

        this.setCache(cacheKey, data, 300000); // Cache for 5 minutes
        return data;
    }

    // FCAS API
    async getFCASPrices() {
        const cacheKey = 'fcas:latest';
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const data = await this.auth.apiCall('/api/fcas/latest');
        this.setCache(cacheKey, data, 60000);
        return data;
    }

    // Demand API
    async getDemandForecast(region = 'NSW1') {
        return await this.auth.apiCall(`/api/demand/forecast?region=${region}`);
    }

    // Trading API
    async getTradingPositions() {
        return await this.auth.apiCall('/api/trading/positions');
    }

    async openPosition(region, positionType, entryPrice, quantity) {
        return await this.auth.apiCall('/api/trading/position', {
            method: 'POST',
            body: JSON.stringify({
                region,
                position_type: positionType,
                entry_price: entryPrice,
                quantity
            })
        });
    }

    async closePosition(positionId, exitPrice) {
        return await this.auth.apiCall(`/api/trading/close/${positionId}`, {
            method: 'POST',
            body: JSON.stringify({ exit_price: exitPrice })
        });
    }

    async getTradingLeaderboard() {
        return await this.auth.apiCall('/api/trading/leaderboard');
    }

    // BESS Optimization API
    async optimizeBESS(params) {
        return await this.auth.apiCall('/api/bess/optimize', {
            method: 'POST',
            body: JSON.stringify(params)
        });
    }

    async getBESSHistory() {
        return await this.auth.apiCall('/api/bess/history');
    }

    // WebSocket for real-time data
    connectWebSocket(onMessage) {
        const wsUrl = window.location.hostname === 'localhost'
            ? 'ws://localhost:8788/ws'
            : 'wss://api.sunney.io/ws';

        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            // Send auth token
            this.ws.send(JSON.stringify({
                type: 'AUTH',
                token: this.auth.token
            }));
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            onMessage(data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            // Reconnect after 5 seconds
            setTimeout(() => this.connectWebSocket(onMessage), 5000);
        };

        return this.ws;
    }

    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
        }
    }

    // Cache management
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && cached.expires > Date.now()) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCache(key, data, timeout = this.cacheTimeout) {
        this.cache.set(key, {
            data,
            expires: Date.now() + timeout
        });
    }

    clearCache() {
        this.cache.clear();
    }

    // Utility functions
    formatPrice(price) {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(price);
    }

    formatDateTime(dateString) {
        return new Date(dateString).toLocaleString('en-AU', {
            timeZone: 'Australia/Sydney',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    getRegionColor(region) {
        const colors = {
            'NSW1': '#FF6B6B',
            'VIC1': '#4ECDC4',
            'QLD1': '#45B7D1',
            'SA1': '#96CEB4',
            'TAS1': '#FFEAA7'
        };
        return colors[region] || '#95A5A6';
    }
}

// Initialize API client globally
window.sunneyAPI = new SunneyAPI();