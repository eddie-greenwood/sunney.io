/**
 * Data Validation Module for AEMO Scraper
 * Integrated into main scraper worker - runs every 15 minutes
 */

import { TimeUtil } from '../../../shared/utils/time';

export interface ValidationResult {
  passed: boolean;
  issues: string[];
  warnings: string[];
  metrics: {
    latestDispatchAge: number;
    latestScadaAge: number;
    latestTradingAge: number;
    regionCount: number;
    generatorCount: number;
    fcasServiceCount: number;
    batteryCount: number;
    forecastHorizon: number;
    cacheHitRate: number;
  };
  timestamp: string;
}

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  GOOGLE_CHAT_WEBHOOK?: string;
}

/**
 * Main validation function
 */
export async function validateDataPipeline(env: Env): Promise<ValidationResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const metrics: any = {};
  
  try {
    // 1. Check data freshness
    const freshnessCheck = await checkDataFreshness(env);
    issues.push(...freshnessCheck.issues);
    warnings.push(...freshnessCheck.warnings);
    Object.assign(metrics, freshnessCheck.metrics);
    
    // 2. Check data completeness
    const completenessCheck = await checkDataCompleteness(env);
    issues.push(...completenessCheck.issues);
    warnings.push(...completenessCheck.warnings);
    Object.assign(metrics, completenessCheck.metrics);
    
    // 3. Check data consistency
    const consistencyCheck = await checkDataConsistency(env);
    issues.push(...consistencyCheck.issues);
    warnings.push(...consistencyCheck.warnings);
    
    // 4. Check forecasting data
    const forecastCheck = await checkForecastingData(env);
    issues.push(...forecastCheck.issues);
    warnings.push(...forecastCheck.warnings);
    Object.assign(metrics, forecastCheck.metrics);
    
    // 5. Check cache health
    const cacheCheck = await checkCacheHealth(env);
    warnings.push(...cacheCheck.warnings);
    metrics.cacheHitRate = cacheCheck.hitRate;
    
    // Store validation result
    await storeValidationResult(env, {
      passed: issues.length === 0,
      issues,
      warnings,
      metrics,
      timestamp: TimeUtil.nowUTC()
    });
    
    return {
      passed: issues.length === 0,
      issues,
      warnings,
      metrics,
      timestamp: TimeUtil.nowUTC()
    };
    
  } catch (error) {
    console.error('Validation error:', error);
    return {
      passed: false,
      issues: [`Validation system error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      warnings: [],
      metrics: {
        latestDispatchAge: 999,
        latestScadaAge: 999,
        latestTradingAge: 999,
        regionCount: 0,
        generatorCount: 0,
        fcasServiceCount: 0,
        batteryCount: 0,
        forecastHorizon: 0,
        cacheHitRate: 0
      },
      timestamp: TimeUtil.nowUTC()
    };
  }
}

/**
 * Check 1: Data Freshness
 */
async function checkDataFreshness(env: Env): Promise<any> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const metrics: any = {};
  
  // Check dispatch prices (should be < 10 minutes old)
  const dispatchResult = await env.DB.prepare(`
    SELECT 
      MAX(settlement_date) as latest,
      (julianday('now') - julianday(MAX(settlement_date))) * 24 * 60 as age_minutes
    FROM dispatch_prices
  `).first() as any;
  
  metrics.latestDispatchAge = dispatchResult?.age_minutes || 999;
  
  if (!dispatchResult?.latest || dispatchResult.age_minutes > 10) {
    issues.push(`CRITICAL: Dispatch data stale (${Math.round(dispatchResult?.age_minutes || 999)} minutes old)`);
  }
  
  // Check SCADA data (should be < 10 minutes old)
  const scadaResult = await env.DB.prepare(`
    SELECT 
      MAX(settlement_date) as latest,
      (julianday('now') - julianday(MAX(settlement_date))) * 24 * 60 as age_minutes
    FROM generator_scada
  `).first() as any;
  
  metrics.latestScadaAge = scadaResult?.age_minutes || 999;
  
  if (scadaResult && scadaResult.age_minutes > 10) {
    issues.push(`CRITICAL: SCADA data stale (${Math.round(scadaResult.age_minutes)} minutes old)`);
  }
  
  // Check trading prices (should be < 35 minutes old)
  const tradingResult = await env.DB.prepare(`
    SELECT 
      MAX(settlement_date) as latest,
      (julianday('now') - julianday(MAX(settlement_date))) * 24 * 60 as age_minutes
    FROM trading_prices
  `).first() as any;
  
  metrics.latestTradingAge = tradingResult?.age_minutes || 999;
  
  if (tradingResult && tradingResult.age_minutes > 35) {
    warnings.push(`Trading prices outdated (${Math.round(tradingResult.age_minutes)} minutes old)`);
  }
  
  return { issues, warnings, metrics };
}

/**
 * Check 2: Data Completeness
 */
async function checkDataCompleteness(env: Env): Promise<any> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const metrics: any = {};
  
  // Check all regions are reporting
  const regionResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT region) as region_count
    FROM dispatch_prices
    WHERE settlement_date >= datetime('now', '-10 minutes')
  `).first() as any;
  
  metrics.regionCount = regionResult?.region_count || 0;
  
  if (regionResult?.region_count < 5) {
    issues.push(`Missing regions: only ${regionResult?.region_count}/5 reporting`);
  }
  
  // Check generator count
  const generatorResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT duid) as generator_count
    FROM generator_scada
    WHERE settlement_date >= datetime('now', '-10 minutes')
  `).first() as any;
  
  metrics.generatorCount = generatorResult?.generator_count || 0;
  
  if (generatorResult?.generator_count < 400) {
    warnings.push(`Low generator count: ${generatorResult?.generator_count} (expected 400+)`);
  }
  
  // Check FCAS services
  const fcasResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT service) as service_count
    FROM fcas_prices
    WHERE settlement_date >= datetime('now', '-10 minutes')
  `).first() as any;
  
  metrics.fcasServiceCount = fcasResult?.service_count || 0;
  
  if (fcasResult?.service_count < 9) {
    issues.push(`Missing FCAS services: only ${fcasResult?.service_count}/9 reporting`);
  }
  
  // Check battery count
  const batteryResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT duid) as battery_count
    FROM battery_dispatch
    WHERE settlement_date >= datetime('now', '-10 minutes')
  `).first() as any;
  
  metrics.batteryCount = batteryResult?.battery_count || 0;
  
  if (batteryResult?.battery_count < 30) {
    warnings.push(`Low battery count: ${batteryResult?.battery_count} (expected 30+)`);
  }
  
  return { issues, warnings, metrics };
}

/**
 * Check 3: Data Consistency
 */
async function checkDataConsistency(env: Env): Promise<any> {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  // Check energy balance (generation ≈ demand)
  const balanceResult = await env.DB.prepare(`
    SELECT 
      SUM(demand) as total_demand,
      SUM(generation) as total_generation,
      ABS(SUM(generation) - SUM(demand)) / SUM(demand) * 100 as imbalance_pct
    FROM dispatch_prices
    WHERE settlement_date = (SELECT MAX(settlement_date) FROM dispatch_prices)
  `).first() as any;
  
  if (balanceResult?.imbalance_pct > 5) {
    warnings.push(`Energy imbalance: ${balanceResult.imbalance_pct.toFixed(1)}% difference between generation and demand`);
  }
  
  // Check price bounds
  const priceResult = await env.DB.prepare(`
    SELECT 
      MIN(price) as min_price,
      MAX(price) as max_price,
      COUNT(*) as count
    FROM dispatch_prices
    WHERE settlement_date >= datetime('now', '-1 hour')
      AND (price < -1000 OR price > 16600)
  `).first() as any;
  
  if (priceResult?.count > 0) {
    issues.push(`Price bounds violation: ${priceResult.count} prices outside [-$1,000, $16,600]`);
  }
  
  // Check battery SOC bounds
  const socResult = await env.DB.prepare(`
    SELECT 
      COUNT(*) as violations,
      MIN(soc_percent) as min_soc,
      MAX(soc_percent) as max_soc
    FROM battery_dispatch
    WHERE settlement_date >= datetime('now', '-1 hour')
      AND (soc_percent < 0 OR soc_percent > 100)
  `).first() as any;
  
  if (socResult?.violations > 0) {
    issues.push(`Battery SOC violation: ${socResult.violations} records outside [0%, 100%]`);
  }
  
  return { issues, warnings };
}

/**
 * Check 4: Forecasting Data
 */
async function checkForecastingData(env: Env): Promise<any> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const metrics: any = {};
  
  // Check P5MIN forecast horizon
  const p5minResult = await env.DB.prepare(`
    SELECT 
      COUNT(*) as forecast_count,
      MAX(interval_datetime) as latest_forecast
    FROM p5min_forecasts
    WHERE interval_datetime > datetime('now')
  `).first() as any;
  
  metrics.forecastHorizon = p5minResult?.forecast_count || 0;
  
  if (p5minResult?.forecast_count < 12) {
    warnings.push(`P5MIN forecast horizon short: only ${p5minResult?.forecast_count} intervals (expected 12+)`);
  }
  
  // Check PREDISPATCH data
  const predispatchResult = await env.DB.prepare(`
    SELECT 
      COUNT(*) as interval_count,
      MAX(interval_datetime) as latest
    FROM predispatch_forecasts
    WHERE interval_datetime > datetime('now')
  `).first() as any;
  
  if (predispatchResult?.interval_count < 96) {
    warnings.push(`PREDISPATCH incomplete: ${predispatchResult?.interval_count}/96 intervals`);
  }
  
  // Check ST PASA data
  const stpasaResult = await env.DB.prepare(`
    SELECT 
      COUNT(*) as interval_count,
      MAX(interval_datetime) as latest
    FROM stpasa_forecasts
    WHERE interval_datetime > datetime('now')
  `).first() as any;
  
  if (stpasaResult?.interval_count < 336) {
    warnings.push(`ST PASA incomplete: ${stpasaResult?.interval_count}/336 intervals`);
  }
  
  return { issues, warnings, metrics };
}

/**
 * Check 5: Cache Health
 */
async function checkCacheHealth(env: Env): Promise<any> {
  const warnings: string[] = [];
  let hitRate = 0;
  
  try {
    // Check if latest prices are cached
    const cachedPrices = await env.CACHE.get('prices:latest');
    if (!cachedPrices) {
      warnings.push('Latest prices not cached');
    } else {
      hitRate += 25;
    }
    
    // Check region-specific caches
    const regions = ['NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1'];
    for (const region of regions) {
      const regionCache = await env.CACHE.get(`prices:${region}`);
      if (regionCache) {
        hitRate += 15;
      }
    }
    
    // Check FCAS cache
    const fcasCache = await env.CACHE.get('fcas:latest');
    if (!fcasCache) {
      warnings.push('FCAS prices not cached');
    } else {
      hitRate += 25;
    }
    
  } catch (error) {
    warnings.push(`Cache health check failed: ${error}`);
  }
  
  return { warnings, hitRate: Math.min(100, hitRate) };
}

/**
 * Store validation result in database
 */
async function storeValidationResult(env: Env, result: ValidationResult): Promise<void> {
  try {
    // Create table if not exists
    await env.DB.prepare(`
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
      )
    `).run();
    
    // Insert validation result
    await env.DB.prepare(`
      INSERT INTO validation_log (
        timestamp, passed, issue_count, warning_count, 
        issues, warnings, metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      result.timestamp,
      result.passed ? 1 : 0,
      result.issues.length,
      result.warnings.length,
      JSON.stringify(result.issues),
      JSON.stringify(result.warnings),
      JSON.stringify(result.metrics)
    ).run();
    
    // Keep only last 7 days of logs
    await env.DB.prepare(`
      DELETE FROM validation_log 
      WHERE created_at < datetime('now', '-7 days')
    `).run();
    
  } catch (error) {
    console.error('Failed to store validation result:', error);
  }
}

/**
 * Send Google Chat alert for validation failures
 */
export async function sendGoogleChatAlert(webhookUrl: string, result: ValidationResult): Promise<void> {
  try {
    const icon = result.passed ? '✅' : '🚨';
    
    const message = {
      cards: [{
        header: {
          title: `${icon} AEMO Data Validation ${result.passed ? 'Passed' : 'Failed'}`,
          subtitle: `Sunney.io Scraper - ${TimeUtil.nowAEST()}`
        },
        sections: [
          {
            widgets: [
              {
                textParagraph: {
                  text: `<b>Status:</b> ${result.passed ? '✅ All checks passed' : '❌ Validation failed'}`
                }
              },
              ...(result.issues.length > 0 ? [{
                textParagraph: {
                  text: `<b>🔴 Critical Issues (${result.issues.length}):</b>\n${result.issues.map(i => `• ${i}`).join('\n')}`
                }
              }] : []),
              ...(result.warnings.length > 0 ? [{
                textParagraph: {
                  text: `<b>⚠️ Warnings (${result.warnings.length}):</b>\n${result.warnings.slice(0, 5).map(w => `• ${w}`).join('\n')}${result.warnings.length > 5 ? `\n• ... and ${result.warnings.length - 5} more` : ''}`
                }
              }] : []),
              {
                keyValue: {
                  topLabel: 'Metrics',
                  content: `Regions: ${result.metrics.regionCount || 0}/5 | Generators: ${result.metrics.generatorCount || 0} | Cache Hit: ${result.metrics.cacheHitRate || 0}%`
                }
              },
              {
                keyValue: {
                  topLabel: 'Data Age',
                  content: `Dispatch: ${Math.round(result.metrics.latestDispatchAge || 999)}min | SCADA: ${Math.round(result.metrics.latestScadaAge || 999)}min`
                }
              }
            ]
          },
          {
            widgets: [{
              buttons: [{
                textButton: {
                  text: 'VIEW DASHBOARD',
                  onClick: {
                    openLink: {
                      url: 'https://sunney.io/dashboards/nem-live'
                    }
                  }
                }
              }, {
                textButton: {
                  text: 'CHECK LOGS',
                  onClick: {
                    openLink: {
                      url: 'https://dash.cloudflare.com'
                    }
                  }
                }
              }]
            }]
          }
        ]
      }]
    };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });
    
    if (!response.ok) {
      console.error('Failed to send Google Chat alert:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error sending Google Chat alert:', error);
  }
}