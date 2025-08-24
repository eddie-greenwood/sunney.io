-- AEMO Scraper Database Schema
-- Initialize all required tables for the scraper

-- Main dispatch prices table
CREATE TABLE IF NOT EXISTS dispatch_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  price REAL NOT NULL,
  demand REAL,
  generation REAL,
  net_interchange REAL DEFAULT 0,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, settlement_date)
);

-- SCADA data for generators
CREATE TABLE IF NOT EXISTS generator_scada (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duid TEXT NOT NULL,
  scada_value REAL NOT NULL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(duid, settlement_date)
);

-- FCAS prices
CREATE TABLE IF NOT EXISTS fcas_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  service TEXT NOT NULL,
  price REAL NOT NULL,
  enablement_min REAL,
  enablement_max REAL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, service, settlement_date)
);

-- Battery dispatch data
CREATE TABLE IF NOT EXISTS battery_dispatch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duid TEXT NOT NULL,
  totalcleared REAL NOT NULL,
  soc_percent REAL,
  energy_mwh REAL,
  raise_6sec REAL DEFAULT 0,
  lower_6sec REAL DEFAULT 0,
  raise_60sec REAL DEFAULT 0,
  lower_60sec REAL DEFAULT 0,
  raise_5min REAL DEFAULT 0,
  lower_5min REAL DEFAULT 0,
  raise_reg REAL DEFAULT 0,
  lower_reg REAL DEFAULT 0,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(duid, settlement_date)
);

-- Trading prices (30-min intervals)
CREATE TABLE IF NOT EXISTS trading_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL,
  price REAL NOT NULL,
  cumulative_price REAL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, settlement_date)
);

-- P5MIN forecasts (5-min ahead)
CREATE TABLE IF NOT EXISTS p5min_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interval_datetime TEXT NOT NULL,
  region TEXT NOT NULL,
  rrp REAL,
  demand REAL,
  available_generation REAL,
  net_interchange REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(interval_datetime, region)
);

-- PREDISPATCH forecasts (2-day ahead)
CREATE TABLE IF NOT EXISTS predispatch_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interval_datetime TEXT NOT NULL,
  region TEXT NOT NULL,
  rrp REAL,
  demand REAL,
  available_generation REAL,
  dispatchable_generation REAL,
  net_interchange REAL,
  -- FCAS requirements
  raise_6sec_req REAL,
  lower_6sec_req REAL,
  raise_60sec_req REAL,
  lower_60sec_req REAL,
  raise_5min_req REAL,
  lower_5min_req REAL,
  raise_reg_req REAL,
  lower_reg_req REAL,
  -- FCAS prices
  raise_6sec_price REAL,
  lower_6sec_price REAL,
  raise_60sec_price REAL,
  lower_60sec_price REAL,
  raise_5min_price REAL,
  lower_5min_price REAL,
  raise_reg_price REAL,
  lower_reg_price REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(interval_datetime, region)
);

-- PREDISPATCH unit solutions
CREATE TABLE IF NOT EXISTS predispatch_unit_solutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interval_datetime TEXT NOT NULL,
  duid TEXT NOT NULL,
  traded_energy REAL,
  cleared_mw REAL,
  agc_status INTEGER,
  -- FCAS enablement
  raise_6sec REAL,
  lower_6sec REAL,
  raise_60sec REAL,
  lower_60sec REAL,
  raise_5min REAL,
  lower_5min REAL,
  raise_reg REAL,
  lower_reg REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(interval_datetime, duid)
);

-- ST PASA forecasts (7-day ahead)
CREATE TABLE IF NOT EXISTS stpasa_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interval_datetime TEXT NOT NULL,
  region TEXT NOT NULL,
  demand_forecast REAL,
  demand_10_percent REAL,
  demand_50_percent REAL,
  demand_90_percent REAL,
  scheduled_generation REAL,
  semi_scheduled_generation REAL,
  net_interchange REAL,
  reserve_requirement REAL,
  reserve_available REAL,
  surplus_reserve REAL,
  low_reserve_condition INTEGER,
  lack_of_reserve INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(interval_datetime, region)
);

-- Validation log
CREATE TABLE IF NOT EXISTS validation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  passed INTEGER NOT NULL,
  issue_count INTEGER NOT NULL,
  warning_count INTEGER NOT NULL,
  issues TEXT,
  warnings TEXT,
  metrics TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Generation by fuel type (aggregated)
CREATE TABLE IF NOT EXISTS generation_by_fuel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_type TEXT NOT NULL,
  total_mw REAL NOT NULL,
  unit_count INTEGER NOT NULL,
  settlement_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(fuel_type, settlement_date)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_dispatch_prices_settlement ON dispatch_prices(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_prices_region ON dispatch_prices(region, settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_generator_scada_settlement ON generator_scada(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_fcas_prices_settlement ON fcas_prices(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_battery_dispatch_settlement ON battery_dispatch(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_trading_prices_settlement ON trading_prices(settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_p5min_forecasts_interval ON p5min_forecasts(interval_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_predispatch_forecasts_interval ON predispatch_forecasts(interval_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_stpasa_forecasts_interval ON stpasa_forecasts(interval_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_validation_log_timestamp ON validation_log(timestamp DESC);