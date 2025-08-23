# NEM Live Dashboard

## Overview
Real-time visualization of Australian National Electricity Market data with live price updates every 5 minutes.

## Features
- **Live Prices**: Current spot prices for all NEM regions
- **Demand Tracking**: Real-time demand and generation data
- **Price Charts**: Historical price trends over 24 hours
- **Regional Comparison**: Side-by-side region analysis
- **Interconnector Flows**: Power flows between regions

## Data Display

### Main Metrics
- **Spot Price**: Current $/MWh for each region
- **Demand**: Current load in MW
- **Available Generation**: Total generation capacity
- **Net Interchange**: Import/export between regions

### Regions Covered
- **NSW1**: New South Wales
- **VIC1**: Victoria
- **QLD1**: Queensland
- **SA1**: South Australia
- **TAS1**: Tasmania

## Chart Types

### Price Chart
- 24-hour rolling window
- 5-minute intervals
- Color-coded by region
- Interactive tooltips

### Demand Chart
- Actual vs forecast demand
- Peak indicators
- Temperature correlation

## Update Frequency
- **Prices**: Every 5 minutes (dispatch interval)
- **Demand**: Every 5 minutes
- **Forecasts**: Every 30 minutes

## Color Coding

### Price Ranges
- 🟢 Green: < $50/MWh (Low)
- 🟡 Yellow: $50-100/MWh (Normal)
- 🟠 Orange: $100-300/MWh (High)
- 🔴 Red: > $300/MWh (Extreme)

### Trends
- ⬆️ Up Arrow: Price increasing
- ⬇️ Down Arrow: Price decreasing
- ➡️ Flat: Stable price

## Keyboard Shortcuts
- `R`: Refresh data
- `F`: Toggle fullscreen
- `1-5`: Focus on region (1=NSW, 2=VIC, etc.)
- `Space`: Pause/resume updates

## Data Sources
- **Primary**: AEMO dispatch data
- **Secondary**: Pre-dispatch forecasts
- **Updates**: WebSocket for real-time

## Performance Tips
- Chrome/Edge recommended for best performance
- Close unnecessary tabs to reduce CPU usage
- Use ethernet connection for stability

## Troubleshooting

### Data Not Updating
1. Check internet connection
2. Refresh browser (Ctrl+F5)
3. Clear browser cache
4. Check AEMO website status

### Chart Not Displaying
1. Enable JavaScript
2. Allow WebGL in browser
3. Update browser to latest version

## Export Options
- **CSV**: Download historical data
- **PNG**: Export charts as images
- **PDF**: Generate reports