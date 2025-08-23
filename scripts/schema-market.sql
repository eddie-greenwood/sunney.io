-- Sunney.io Market Database Schema

-- Dispatch prices (5-minute intervals)
CREATE TABLE IF NOT EXISTS dispatch_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL CHECK(region IN ('NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1')),
  price REAL NOT NULL,
  demand REAL NOT NULL,
  generation REAL,
  net_interchange REAL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, settlement_date)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_settlement ON dispatch_prices(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_region ON dispatch_prices(region, settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_created ON dispatch_prices(created_at DESC);

-- P5MIN prices (5-minute pre-dispatch)
CREATE TABLE IF NOT EXISTS p5min_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  price REAL NOT NULL,
  demand REAL NOT NULL,
  available_generation REAL,
  interval_datetime TEXT NOT NULL,
  run_datetime TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, interval_datetime, run_datetime)
);

CREATE INDEX IF NOT EXISTS idx_p5min_interval ON p5min_prices(interval_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_p5min_region ON p5min_prices(region, interval_datetime DESC);

-- Forward prices (Aurora data)
CREATE TABLE IF NOT EXISTS forward_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  date TEXT NOT NULL,
  interval INTEGER NOT NULL CHECK(interval >= 1 AND interval <= 48),
  price REAL NOT NULL,
  source TEXT DEFAULT 'aurora',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, date, interval)
);

CREATE INDEX IF NOT EXISTS idx_forward_date ON forward_prices(date);
CREATE INDEX IF NOT EXISTS idx_forward_region_date ON forward_prices(region, date);

-- FCAS prices (Frequency Control Ancillary Services)
CREATE TABLE IF NOT EXISTS fcas_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  service TEXT NOT NULL CHECK(service IN (
    'RAISE6SEC', 'RAISE60SEC', 'RAISE5MIN', 'RAISEREG',
    'LOWER6SEC', 'LOWER60SEC', 'LOWER5MIN', 'LOWERREG'
  )),
  price REAL NOT NULL,
  enablement_min REAL,
  enablement_max REAL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, service, settlement_date)
);

CREATE INDEX IF NOT EXISTS idx_fcas_settlement ON fcas_prices(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_fcas_service ON fcas_prices(service, settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_fcas_region ON fcas_prices(region, settlement_date DESC);

-- Demand forecast
CREATE TABLE IF NOT EXISTS demand_forecast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  forecast_date TEXT NOT NULL,
  forecast_demand REAL NOT NULL,
  temperature_forecast REAL,
  run_datetime TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, forecast_date, run_datetime)
);

CREATE INDEX IF NOT EXISTS idx_demand_forecast_date ON demand_forecast(forecast_date);
CREATE INDEX IF NOT EXISTS idx_demand_forecast_region ON demand_forecast(region, forecast_date);

-- Interconnector flows
CREATE TABLE IF NOT EXISTS interconnector_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interconnector TEXT NOT NULL,
  from_region TEXT NOT NULL,
  to_region TEXT NOT NULL,
  flow_mw REAL NOT NULL,
  limit_mw REAL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(interconnector, settlement_date)
);

CREATE INDEX IF NOT EXISTS idx_interconnector_settlement ON interconnector_flows(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_interconnector_name ON interconnector_flows(interconnector);

-- Trading positions (for simulator)
CREATE TABLE IF NOT EXISTS trading_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  region TEXT NOT NULL,
  position_type TEXT NOT NULL CHECK(position_type IN ('LONG', 'SHORT')),
  entry_price REAL NOT NULL,
  quantity REAL NOT NULL,
  entry_time TEXT NOT NULL,
  exit_price REAL,
  exit_time TEXT,
  pnl REAL,
  status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CLOSED')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trading_user ON trading_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_status ON trading_positions(status);
CREATE INDEX IF NOT EXISTS idx_trading_entry ON trading_positions(entry_time DESC);

-- Trading performance
CREATE TABLE IF NOT EXISTS trading_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  total_pnl REAL DEFAULT 0,
  best_trade REAL DEFAULT 0,
  worst_trade REAL DEFAULT 0,
  win_rate REAL DEFAULT 0,
  avg_win REAL DEFAULT 0,
  avg_loss REAL DEFAULT 0,
  sharpe_ratio REAL,
  max_drawdown REAL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_performance_user ON trading_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_performance_pnl ON trading_performance(total_pnl DESC);

-- BESS optimization results
CREATE TABLE IF NOT EXISTS bess_optimizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  region TEXT NOT NULL,
  capacity_mwh REAL NOT NULL,
  power_mw REAL NOT NULL,
  efficiency REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_revenue REAL NOT NULL,
  total_cycles INTEGER,
  avg_soc REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bess_user ON bess_optimizations(user_id);
CREATE INDEX IF NOT EXISTS idx_bess_created ON bess_optimizations(created_at DESC);

-- Market alerts
CREATE TABLE IF NOT EXISTS market_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  region TEXT,
  threshold REAL,
  current_value REAL,
  message TEXT,
  severity TEXT CHECK(severity IN ('INFO', 'WARNING', 'CRITICAL')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_type ON market_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON market_alerts(created_at DESC);

-- Data quality metrics
CREATE TABLE IF NOT EXISTS data_quality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_count INTEGER,
  last_updated TEXT,
  missing_intervals INTEGER DEFAULT 0,
  quality_score REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quality_table ON data_quality(table_name);
CREATE INDEX IF NOT EXISTS idx_quality_created ON data_quality(created_at DESC);