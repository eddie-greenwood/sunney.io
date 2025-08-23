# Trading Simulator

## Overview
Real-time NEM energy trading simulator for training and strategy development.

## Features
- **Live Market Data**: Real-time prices from all NEM regions
- **Position Management**: Open/close long and short positions
- **P&L Tracking**: Real-time profit/loss calculations
- **Risk Management**: Position limits and stop-loss features
- **Leaderboard**: Compare performance with other traders
- **Historical Analysis**: Review past trades and performance

## How to Use

### Opening a Position
1. Select a region (NSW1, VIC1, QLD1, SA1, TAS1)
2. Choose position type (Long or Short)
3. Enter quantity (MW)
4. Click "Open Position"

### Closing a Position
1. Find your open position in the positions table
2. Click "Close" button
3. Position closes at current market price

### Trading Strategies
- **Long**: Buy when you expect prices to rise
- **Short**: Sell when you expect prices to fall
- **Arbitrage**: Trade between regions with price differences

## Technical Details

### API Endpoints Used
- `GET /api/prices/latest` - Current market prices
- `GET /api/trading/positions` - Your positions
- `POST /api/trading/position` - Open new position
- `POST /api/trading/close/{id}` - Close position
- `GET /api/trading/leaderboard` - Top traders

### WebSocket Connection
Real-time price updates via WebSocket:
```javascript
ws://api.sunney.io/ws
```

### Position Calculations
```
Long P&L = (Exit Price - Entry Price) × Quantity
Short P&L = (Entry Price - Exit Price) × Quantity
```

## Risk Management

### Position Limits
- Maximum 10 open positions
- Maximum 100 MW per position
- Daily loss limit: $10,000

### Stop Loss
Positions automatically close if:
- Loss exceeds 20% of entry value
- Market volatility exceeds threshold

## Performance Metrics
- **Win Rate**: Percentage of profitable trades
- **Average Win/Loss**: Average profit per winning/losing trade
- **Sharpe Ratio**: Risk-adjusted returns
- **Max Drawdown**: Largest peak-to-trough decline

## Tips for Success
1. Start with small positions to learn
2. Watch price patterns across regions
3. Consider time-of-day effects (peak vs off-peak)
4. Monitor weather forecasts for renewable impact
5. Use stop-losses to limit downside

## Keyboard Shortcuts
- `Space`: Pause/resume live updates
- `B`: Quick buy (long)
- `S`: Quick sell (short)
- `C`: Close all positions
- `R`: Refresh data