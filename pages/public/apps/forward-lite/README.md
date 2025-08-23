# Forward Lite - Financial Modeling Tool

## Overview
Advanced forward curve analysis and financial modeling tool for energy contract valuation and risk assessment.

## Features
- **Forward Curves**: Aurora-based forward price projections
- **Contract Valuation**: PPA and hedge contract pricing
- **Scenario Analysis**: Multiple price scenarios
- **Risk Metrics**: VaR and CVaR calculations
- **Settlement Modeling**: Cap and swap contract settlements

## Forward Curve Analysis

### Data Sources
- **Aurora Model**: Long-term price forecasts
- **Historical Calibration**: Back-tested against actuals
- **Weather Adjustments**: Climate scenario impacts

### Time Horizons
- **Short-term**: 1-3 months (5-min granularity)
- **Medium-term**: 3-12 months (30-min granularity)
- **Long-term**: 1-10 years (monthly averages)

## Contract Types

### Power Purchase Agreements (PPA)
- Fixed price contracts
- Floor and ceiling structures
- Green certificates included
- Shaped vs baseload

### Hedge Contracts
- **Swaps**: Fixed for floating
- **Caps**: Maximum price protection
- **Collars**: Price range protection
- **Options**: Call/put structures

## Financial Calculations

### Net Present Value (NPV)
```
NPV = Σ(Cash Flow_t / (1 + r)^t)
```

### Value at Risk (VaR)
```
VaR_95% = μ - 1.645 × σ
```

### Contract Value
```
Swap Value = Σ(Fixed Price - Forward Price) × Volume × Hours
```

## Scenario Analysis

### Price Scenarios
1. **Base Case**: Central forecast
2. **High Renewable**: Increased solar/wind
3. **Gas Shortage**: Elevated gas prices
4. **Carbon Price**: Various $/tCO2 levels
5. **Demand Growth**: High/low scenarios

### Sensitivity Analysis
- Price elasticity
- Volume risk
- Basis risk
- Credit risk

## Risk Management

### Metrics Displayed
- **Expected Value**: Probability-weighted outcome
- **Standard Deviation**: Volatility measure
- **Sharpe Ratio**: Risk-adjusted return
- **Maximum Drawdown**: Worst-case loss
- **Greeks**: Delta, Gamma, Vega

### Hedging Strategies
- Natural hedges
- Cross-commodity hedges
- Dynamic hedging
- Portfolio optimization

## Using the Tool

### Step 1: Select Region
Choose from NSW1, VIC1, QLD1, SA1, TAS1

### Step 2: Define Contract
- Type (Swap, Cap, PPA, etc.)
- Volume (MW)
- Tenor (start and end dates)
- Strike price

### Step 3: Run Analysis
- Generate forward curves
- Calculate valuations
- Assess risks

### Step 4: Export Results
- PDF reports
- Excel models
- API integration

## Advanced Features

### Monte Carlo Simulation
- 10,000 iterations
- Correlated price paths
- Confidence intervals

### Machine Learning
- LSTM price predictions
- Pattern recognition
- Anomaly detection

### Portfolio Analysis
- Multiple contracts
- Correlation matrix
- Efficient frontier

## Inputs Required

### Contract Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| Notional | Contract size | 50 MW |
| Tenor | Contract period | 2 years |
| Strike | Fixed price | $65/MWh |
| Profile | Load shape | Baseload |

### Market Data
- Current spot prices
- Forward curves
- Volatility estimates
- Correlation matrices

## Outputs

### Valuation Report
- Mark-to-market value
- P&L attribution
- Risk metrics
- Sensitivity tables

### Visualizations
- Forward curve charts
- Payoff diagrams
- Distribution plots
- Heatmaps

## Best Practices

1. **Data Quality**
   - Verify forward curves monthly
   - Cross-check with broker quotes
   - Adjust for market events

2. **Model Validation**
   - Backtest regularly
   - Compare with market prices
   - Document assumptions

3. **Risk Limits**
   - Set VaR limits
   - Monitor exposures daily
   - Stress test portfolios

## Integration

### API Endpoints
```
GET /api/forward/{region}
POST /api/forward/contract/value
GET /api/forward/scenarios
```

### Export Formats
- JSON for systems
- CSV for Excel
- PDF for reports

## Support
Contact: support@sunney.io