# BESS Optimizer

## Overview
Battery Energy Storage System (BESS) optimization tool for maximizing revenue in the NEM.

## Features
- **Historical Analysis**: Backtest strategies on past data
- **Forward Looking**: Optimize using forward price curves
- **Multi-Service**: Co-optimize energy and FCAS markets
- **Degradation Modeling**: Account for battery wear
- **Revenue Forecasting**: Project monthly/annual returns

## Optimization Modes

### 1. Energy Arbitrage
Charge during low prices, discharge during high prices.

**Settings:**
- Capacity (MWh): Total battery storage
- Power (MW): Charge/discharge rate
- Efficiency (%): Round-trip efficiency
- Cycles/day: Maximum daily cycles

### 2. FCAS Co-optimization
Participate in both energy and frequency control markets.

**Services:**
- RAISE6SEC: 6-second raise
- LOWER6SEC: 6-second lower
- RAISE5MIN: 5-minute raise
- LOWER5MIN: 5-minute lower

### 3. Network Support
Provide grid stability services during peak demand.

## Optimization Algorithm

### Dynamic Programming Approach
```
For each time interval:
  For each state of charge:
    Calculate optimal action (charge/discharge/idle)
    Maximize: Revenue - Cost - Degradation
```

### Constraints
- SOC limits: 10% - 90%
- Ramp rates: Max MW/min
- Cycling limits: Daily/annual
- Network constraints: Connection limits

## Input Parameters

### Battery Specifications
| Parameter | Typical Range | Unit |
|-----------|--------------|------|
| Capacity | 50-400 | MWh |
| Power | 25-200 | MW |
| Efficiency | 85-95 | % |
| Degradation | 0.01-0.05 | %/cycle |
| C-rate | 0.25-2.0 | per hour |

### Market Settings
- Region: NSW1, VIC1, QLD1, SA1, TAS1
- Time Period: Historical or forward
- Services: Energy, FCAS, or both
- Price Scenarios: Base, high, low

## Revenue Calculations

### Energy Revenue
```
Revenue = Σ(Discharge × Price - Charge × Price) × Efficiency
```

### FCAS Revenue
```
Revenue = Σ(Availability × FCAS_Price × Enablement_Probability)
```

### Total Revenue
```
Total = Energy_Revenue + FCAS_Revenue - Degradation_Cost
```

## Results Interpretation

### Key Metrics
- **Annual Revenue**: Total expected revenue
- **ROI**: Return on investment
- **Payback Period**: Years to recover capital
- **Utilization**: Average daily cycles
- **Service Split**: Energy vs FCAS revenue

### Visualization
- **Daily Schedule**: Charge/discharge pattern
- **SOC Profile**: Battery state over time
- **Revenue Breakdown**: By service type
- **Sensitivity Analysis**: Impact of parameters

## Advanced Features

### Weather Integration
Incorporates weather forecasts for better predictions:
- Solar generation forecasts
- Temperature impacts on demand
- Wind generation variability

### Machine Learning
Uses historical patterns to improve forecasts:
- Price prediction models
- Demand forecasting
- Volatility estimation

### Risk Management
- Value at Risk (VaR) calculations
- Scenario analysis
- Hedge recommendations

## Best Practices

1. **Conservative Assumptions**
   - Use 90% efficiency for real-world losses
   - Include 10% capacity margin for safety
   - Account for auxiliary power consumption

2. **Cycling Management**
   - Limit to 1.5 cycles/day for longevity
   - Reserve capacity for high-value events
   - Balance revenue vs degradation

3. **Market Timing**
   - Focus on morning/evening peaks
   - Watch for price volatility signals
   - Consider seasonal patterns

## Export Options

### Reports
- PDF summary report
- Excel detailed analysis
- CSV raw data export

### Integration
- API endpoints for automation
- Webhook notifications
- Calendar integration for scheduling

## Troubleshooting

### Common Issues
1. **Low Revenue**: Check efficiency settings
2. **High Degradation**: Reduce cycling limits
3. **Infeasible Solution**: Relax constraints

### Support
Contact support@sunney.io for assistance.