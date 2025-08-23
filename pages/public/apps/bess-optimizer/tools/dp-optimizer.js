/**
 * Deterministic optimal arbitrage via Dynamic Programming.
 * Prices are 5-min spot ($/MWh). All energy vars are MWh per interval.
 * 
 * This is a proper optimal control solution that finds the globally optimal
 * charge/discharge schedule for a given price series.
 */
function optimiseBESS_DP({
  prices,                 // array of numbers $/MWh
  dtHours = 5/60,         // 5-minute interval
  capacityMWh,            // total usable capacity
  powerMW,                // charge/discharge power limit (symmetrical)
  etaC = 0.97,            // charge efficiency
  etaD = 0.97,            // discharge efficiency
  soc0 = 0.5,             // initial SoC as fraction of capacity (0..1)
  socT = null,            // terminal SoC fraction (null = free with salvage)
  salvagePrice = null,    // $/MWh for leftover energy (null = auto-calculate)
  socSteps = null,        // number of discrete SoC levels (null = auto-scale)
  throughputCost = 0.0,   // $ per MWh of battery-side throughput (degradation)
  maxCycles = null,       // maximum cycles per day constraint
  rampRateMW = null       // maximum ramp rate MW/interval (null = no limit)
}) {
  const T = prices.length;
  const E = capacityMWh;
  
  // Auto-scale SoC steps based on C-rate to reduce discretization error
  if (socSteps === null) {
    const stepsPerInterval = Math.max(6, Math.ceil(capacityMWh / (powerMW * dtHours)));
    socSteps = Math.min(401, Math.max(121, stepsPerInterval * 8));
  }
  
  const dE = E / (socSteps - 1);                    // SoC step (MWh)
  const idxFromSoC = s => Math.max(0, Math.min(socSteps-1, Math.round(s/dE)));
  const socFromIdx = i => i * dE;

  // Power → max SoC change per step
  const maxChargeSoC = etaC * powerMW * dtHours;    // MWh added to SoC
  const maxDischSoC  = powerMW * dtHours;           // MWh removed from SoC
  const maxChargeK   = Math.max(1, Math.floor(maxChargeSoC / dE));
  const maxDischK    = Math.max(1, Math.floor(maxDischSoC  / dE));

  // Value function and policy
  const V = Array.from({ length: T + 1 }, () => new Float64Array(socSteps).fill(-1e15));
  const action = Array.from({ length: T }, () => new Int16Array(socSteps).fill(0)); // delta in "SoC steps" per interval

  // Terminal condition with cyclic boundary
  if (socT !== null) {
    // Fixed terminal SoC (legacy mode)
    const endIdx = idxFromSoC(E * socT);
    V[T][endIdx] = 0.0;
  } else {
    // Cyclic boundary condition: penalty for deviation from initial SoC
    // This encourages the battery to return to its starting state
    const startSoC = E * soc0;
    
    // Calculate a reference price for the penalty
    // Use median of early morning prices as a proxy for typical charging cost
    let referencePrice = 50; // Default fallback
    const morningPrices = [];
    for (let t = 0; t < Math.min(T, 60); t++) { // First 5 hours (60 intervals)
      if (prices[t] !== null && !isNaN(prices[t])) {
        morningPrices.push(prices[t]);
      }
    }
    if (morningPrices.length > 0) {
      morningPrices.sort((a, b) => a - b);
      referencePrice = morningPrices[Math.floor(morningPrices.length / 2)];
    }
    
    // Set terminal value with quadratic penalty for deviation
    for (let i = 0; i < socSteps; i++) {
      const soc = socFromIdx(i);
      const deviation = soc - startSoC;
      // Quadratic penalty to encourage return to initial state
      // Positive deviation (excess energy) has value, negative has cost
      if (deviation > 0) {
        // Excess energy valued at discharge efficiency * reference price
        V[T][i] = etaD * deviation * referencePrice * 0.8; // 80% of reference
      } else {
        // Energy deficit costs at charge efficiency * reference price
        V[T][i] = deviation * referencePrice / etaC * 1.2; // 120% of reference
      }
    }
  }

  // Backward DP
  for (let t = T - 1; t >= 0; t--) {
    const p = prices[t];
    for (let i = 0; i < socSteps; i++) {
      const soc = socFromIdx(i);

      let bestVal = -1e15;
      let bestK = 0;

      // allowed change in SoC this step: k * dE, with bounds
      const kChargeMax = Math.min(maxChargeK, Math.floor((E - soc) / dE));
      const kDischMax  = Math.min(maxDischK, Math.floor(soc / dE));

      // iterate discharge (negative k), hold (0), charge (positive k)
      for (let k = -kDischMax; k <= kChargeMax; k++) {
        const socNextIdx = i + k;
        const socNextVal = V[t + 1][socNextIdx];
        if (socNextVal <= -1e14) continue; // infeasible terminal path
        
        // TODO: Ramp rate constraint would be enforced here
        // if (rampRateMW !== null && t > 0) {
        //   const prevK = action[t-1][i];
        //   const rampMW = Math.abs((k - prevK) * dE / dtHours);
        //   if (rampMW > rampRateMW) continue; // Skip if violates ramp rate
        // }

        let reward = 0.0;
        if (k > 0) {
          // CHARGE: SoC increases by k*dE; grid energy = (k*dE)/etaC
          const gridIn = (k * dE) / etaC;
          const thr    = k * dE; // battery-side throughput
          reward -= p * gridIn;
          reward -= throughputCost * thr;
        } else if (k < 0) {
          // DISCHARGE: SoC decreases by |k|*dE; energy sold = etaD * |k|*dE
          const battOut = (-k) * dE;
          const sold    = etaD * battOut;
          const thr     = battOut; // battery-side throughput
          reward += p * sold;
          reward -= throughputCost * thr;
        }

        const val = reward + socNextVal;
        if (val > bestVal) {
          bestVal = val;
          bestK = k;
        }
      }

      V[t][i] = bestVal;
      action[t][i] = bestK;
    }
  }

  // Forward simulate optimal schedule from soc0
  const socSeries = new Float64Array(T + 1);
  socSeries[0] = Math.min(E, Math.max(0, E * soc0));
  const flows = []; // per-interval results
  let revenue = 0.0;
  let throughput = 0.0;
  let energyCharged = 0.0;
  let energyDischarged = 0.0;
  let cycleCount = 0.0;

  for (let t = 0; t < T; t++) {
    const i = idxFromSoC(socSeries[t]);
    const k = action[t][i];
    const dSoC = k * dE;

    let op = 'hold';
    let buyMWh = 0, sellMWh = 0, cash = 0;

    if (k > 0) {
      buyMWh = dSoC / etaC;                 // grid energy bought
      cash   = -prices[t] * buyMWh - throughputCost * dSoC;
      op = 'charge';
      energyCharged += buyMWh;
    } else if (k < 0) {
      const battOut = -dSoC;                // battery-side energy
      sellMWh = etaD * battOut;             // energy sold to grid
      cash    =  prices[t] * sellMWh - throughputCost * battOut;
      op = 'discharge';
      energyDischarged += sellMWh;
    }

    revenue   += cash;
    throughput+= Math.abs(dSoC);
    socSeries[t + 1] = socSeries[t] + dSoC;

    flows.push({
      t,
      price: prices[t],
      op,
      socMWh: socSeries[t + 1],
      buyMWh,
      sellMWh,
      cash,
      socFraction: socSeries[t + 1] / E
    });
  }

  // Reservation (best) prices from marginal values with smoothing
  const chargeThresh = new Float64Array(T);
  const dischargeThresh = new Float64Array(T);
  
  // Calculate for multiple SoC levels
  const socLevels = [0.2, 0.5, 0.8];
  const reservationBySoC = {};
  
  socLevels.forEach(level => {
    const idx = Math.floor((socSteps - 1) * level);
    const charge = new Float64Array(T);
    const discharge = new Float64Array(T);
    
    for (let t = 0; t < T; t++) {
      const vNext = V[t + 1];
      const i = idx;
      const m = (i < socSteps - 1 ? (vNext[i + 1] - vNext[i]) : (vNext[i] - vNext[i - 1])) / dE;
      charge[t] = etaC * m - throughputCost;
      discharge[t] = (m + throughputCost) / etaD;
    }
    
    reservationBySoC[level] = {
      charge: smoothReservationPrices(Array.from(charge)),
      discharge: smoothReservationPrices(Array.from(discharge))
    };
  });
  
  // Use mid-SoC as primary reservation prices
  const midIdx = Math.floor((socSteps - 1) / 2);
  for (let t = 0; t < T; t++) {
    const vNext = V[t + 1];
    const i = midIdx;
    const m = (i < socSteps - 1 ? (vNext[i + 1] - vNext[i]) : (vNext[i] - vNext[i - 1])) / dE;
    chargeThresh[t]    = etaC * m - throughputCost;
    dischargeThresh[t] = (m + throughputCost) / etaD;
  }

  // Smooth the primary reservation prices
  const smoothedCharge = smoothReservationPrices(Array.from(chargeThresh));
  const smoothedDischarge = smoothReservationPrices(Array.from(dischargeThresh));

  // Calculate cycles
  const cycles = throughput / (2 * E);

  // Calculate average prices (weighted by energy)
  let weightedChargePrice = 0;
  let weightedDischargePrice = 0;
  
  flows.forEach(f => {
    if (f.buyMWh > 0) {
      weightedChargePrice += f.price * f.buyMWh;
    }
    if (f.sellMWh > 0) {
      weightedDischargePrice += f.price * f.sellMWh;
    }
  });
  
  const avgChargePrice = energyCharged > 0 ? weightedChargePrice / energyCharged : 0;
  const avgDischargePrice = energyDischarged > 0 ? weightedDischargePrice / energyDischarged : 0;
  const effectiveSpread = avgDischargePrice - avgChargePrice;

  return {
    revenue,
    cycles,
    socSeries: Array.from(socSeries),
    flows,
    value0: V[0][idxFromSoC(socSeries[0])],
    reservation: {
      charge: smoothedCharge,
      discharge: smoothedDischarge,
      bySoC: reservationBySoC
    },
    energyCharged,
    energyDischarged,
    energyTraded: energyCharged + energyDischarged,
    avgChargePrice,
    avgDischargePrice,
    avgSpread: effectiveSpread,
    throughput,
    salvagePrice: salvagePrice,
    settings: { 
      dtHours, 
      capacityMWh: E, 
      powerMW, 
      etaC, 
      etaD, 
      soc0, 
      socT, 
      socSteps, 
      throughputCost,
      salvagePrice 
    },
    notes: 'DP optimum with salvage value; smoothed reservation prices at multiple SoC levels.'
  };
}

/**
 * Smooth reservation prices to reduce flip-flopping
 * Uses median filter with window size k
 */
function smoothReservationPrices(arr, k = 3) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const w = arr.slice(Math.max(0, i - k), Math.min(arr.length, i + k + 1))
                 .filter(Number.isFinite)
                 .sort((a, b) => a - b);
    out[i] = w.length ? w[Math.floor(w.length / 2)] : arr[i];
  }
  return out;
}

/**
 * Calibrate throughput cost using bisection to achieve target cycles
 */
function calibrateThroughputCost(prices, targetCycles, dpArgs) {
  const targetThroughput = 2 * dpArgs.capacityMWh * targetCycles;
  let lo = 0, hi = 200; // $/MWh search bracket
  
  // Binary search for the right throughput cost
  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2;
    const result = optimiseBESS_DP({ 
      ...dpArgs, 
      prices, 
      throughputCost: mid 
    });
    
    if (result.throughput > targetThroughput) {
      lo = mid; // Need higher cost to reduce throughput
    } else {
      hi = mid; // Need lower cost to increase throughput
    }
  }
  
  return (lo + hi) / 2;
}

/**
 * Clean and validate price data
 * @param {Array} prices - Raw price data
 * @param {Object} options - Processing options
 * @param {boolean} options.clamp - Whether to clamp prices to market limits (default: false)
 * @param {boolean} options.despike - Whether to apply median filter (default: false)
 */
function cleanPrices(prices, options = {}) {
  const { clamp = false, despike = false } = options;
  const FLOOR = -1000;
  const CAP = 16600;
  
  // First pass: handle nulls and NaNs
  let cleaned = prices.map(p => {
    if (p === null || isNaN(p)) return 0;
    if (clamp) {
      return Math.max(FLOOR, Math.min(CAP, p));
    }
    return p;
  });
  
  // Optional: 3-point median filter for de-spiking
  if (despike) {
    const filtered = new Array(cleaned.length);
    for (let i = 0; i < cleaned.length; i++) {
      if (i === 0 || i === cleaned.length - 1) {
        filtered[i] = cleaned[i];
      } else {
        const window = [cleaned[i-1], cleaned[i], cleaned[i+1]].sort((a,b) => a-b);
        filtered[i] = window[1]; // median
      }
    }
    return filtered;
  }
  
  return cleaned;
}

/**
 * Post-process to enforce minimum run length
 */
function enforceMinRun(flows, minRunIntervals = 3) {
  let i = 0;
  const processed = [...flows];
  
  while (i < processed.length) {
    const currentOp = processed[i].op;
    
    if (currentOp !== 'hold') {
      // Find the end of this operation run
      let runLength = 1;
      while (i + runLength < processed.length && 
             processed[i + runLength].op === currentOp) {
        runLength++;
      }
      
      // If run is too short, convert to hold
      if (runLength < minRunIntervals) {
        for (let j = i; j < i + runLength; j++) {
          processed[j].op = 'hold';
          processed[j].buyMWh = 0;
          processed[j].sellMWh = 0;
          processed[j].cash = 0;
        }
      }
      
      i += runLength;
    } else {
      i++;
    }
  }
  
  return processed;
}

/**
 * Calculate realistic degradation cost from battery economics
 */
function calculateDegradationCost(packCostPerKWh, usableDoD, cycleLife, omPerMWh = 5) {
  // throughputCost ($/MWh) = (PackCost $/kWh) / (UsableDoD * CycleLife) * 1000 + O&M
  const degradation = (packCostPerKWh / (usableDoD * cycleLife)) * 1000;
  return degradation + omPerMWh;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    optimiseBESS_DP,
    calibrateThroughputCost,
    cleanPrices,
    enforceMinRun,
    calculateDegradationCost,
    smoothReservationPrices
  };
}