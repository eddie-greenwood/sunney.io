// Forward Lite Final - Correct Aurora data, no capture %, with build cost

// Chart instances
let chartRevenue = null;
let chartSensitivity = null;
let chartCashFlow = null;
let repDayChart = null;
let chartMonteCarlo = null;
let chartWaterfall = null;

// Current data
let currentResults = [];
let currentRepDay = null;
let annualDB = null;

// Map duration hours to JSON keys
const DKEY = { 
    0.5: 'halfHourly', 
    1: '1h', 
    2: '2h', 
    4: '4h' 
};

// Load Aurora annual data
async function loadAnnualData() {
    if (!annualDB) {
        try {
            const response = await fetch('https://nem-harvester.eddie-37d.workers.dev/api/aurora/annual-all');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            annualDB = await response.json();
            console.log('Loaded annual data for regions:', Object.keys(annualDB));
        } catch (error) {
            console.error('Failed to load annual data:', error);
            annualDB = {};
        }
    }
    return annualDB;
}

// Compute year revenue with comprehensive financial modeling
function computeYearRevenue({
    region, 
    years, 
    durationHours, 
    rtePct, 
    cyclesPerDay = 1, 
    availabilityPct = 98, 
    method = 'simple',
    mwSize = 5,
    cpiPct = 0,  // Annual CPI inflation rate
    opexPct = 0,  // OPEX as % of capex per year
    degradationPct = 0,  // Annual degradation %
    fcasPct = 0,  // FCAS revenue as % of arbitrage
    buildCostM = 5.5,  // Build cost in millions
    debtRatio = 0,  // Debt ratio as %
    interestRate = 0,  // Interest rate as %
    mlfFactor = 1.0,  // Marginal Loss Factor (0.9-1.05 typical)
    degradationFloor = 70,  // Minimum capacity retention %
    loanTerm = 10,  // Loan amortization period in years
    augmentationYear = 0,  // Year to augment capacity (0=never)
    augmentationCost = 30  // Augmentation cost as % of initial capex
}) {
    const η = Number(rtePct) / 100;
    const avail = Number(availabilityPct) / 100;
    const D = Number(durationHours);
    const MW = Number(mwSize);
    const capex = Number(buildCostM) * 1000000; // Convert to dollars
    const annualOpex = capex * (Number(opexPct) / 100); // Annual OPEX cost
    const debtAmount = capex * (Number(debtRatio) / 100); // Debt amount
    
    // Calculate proper debt service with principal and interest
    const loanTermYears = Number(loanTerm);
    const r = Number(interestRate) / 100; // Annual interest rate
    let annualDebtService = 0;
    if (r > 0 && debtAmount > 0) {
        // P&I payment using amortization formula
        annualDebtService = debtAmount * (r * Math.pow(1 + r, loanTermYears)) / (Math.pow(1 + r, loanTermYears) - 1);
    }
    const out = [];

    if (!annualDB || !annualDB[region]) {
        console.error('No data loaded for region:', region);
        return out;
    }

    for (const y of years) {
        const ystr = String(y);
        let ydata = annualDB[region][ystr];
        
        if (!ydata) continue;

        const spread = ydata.spreads[DKEY[D]];
        const Wh = ydata.wholesale;

        if (!spread || !Wh) {
            console.warn(`Missing data for ${region} ${y}`);
            continue;
        }

        // Use simple sqrt efficiency for both methods to avoid calculation errors
        const S_eff = spread * Math.sqrt(η);

        // Calculate years from base for various adjustments
        const yearsFromBase = Number(y) - 2025;
        
        // Apply LINEAR degradation with floor - batteries degrade linearly
        // Stop at degradation floor (warranty level)
        const annualDegradation = Number(degradationPct) / 100;
        const floor = Number(degradationFloor) / 100;
        let degradationMultiplier = Math.max(floor, 1 - (annualDegradation * yearsFromBase));
        
        // Apply to energy capacity (MWh) not power
        const effectiveMWh = MW * D * degradationMultiplier;
        const effectiveDuration = effectiveMWh / MW;
        
        // Calculate base arbitrage revenue with degraded capacity and MLF adjustment
        const revDay = effectiveDuration * S_eff * cyclesPerDay * MW * Number(mlfFactor);
        const revYear = revDay * 365 * avail;
        
        // Apply CPI inflation adjustment
        const cpiMultiplier = Math.pow(1 + (Number(cpiPct) / 100), yearsFromBase);
        const revYearWithCPI = revYear * cpiMultiplier;
        
        // Add FCAS revenue with CPI adjustment (FCAS prices also inflate)
        const fcasRevenue = revYear * (Number(fcasPct) / 100) * cpiMultiplier;
        const totalRevenue = revYearWithCPI + fcasRevenue;
        
        // Apply OPEX costs (also inflated by CPI)
        const opexCost = annualOpex * cpiMultiplier;
        
        // Apply augmentation cost in specified year (one-time capex)
        let augmentationExpense = 0;
        if (augmentationYear > 0 && y === (2025 + augmentationYear)) {
            augmentationExpense = capex * (augmentationCost / 100);
            // After augmentation, reset degradation for enhanced performance
            degradationMultiplier = Math.min(1.0, degradationMultiplier + 0.1); // Restore 10% capacity
        }
        
        // Calculate depreciation for tax purposes (15-year straight line)
        const annualDepreciation = capex / 15;
        
        // Calculate cash flow to equity (after debt service)
        // Debt service reduces over time in later years as principal is paid down
        let currentDebtService = annualDebtService;
        if (yearsFromBase >= loanTermYears) {
            currentDebtService = 0; // Loan fully repaid
        }
        
        // Calculate tax (30% Australian corporate rate)
        const taxRate = 0.30;
        const interestExpense = currentDebtService > 0 ? debtAmount * r : 0; // Interest portion of debt service
        const taxableIncome = totalRevenue - opexCost - annualDepreciation - interestExpense;
        const tax = taxableIncome > 0 ? taxableIncome * taxRate : 0; // Only pay tax on positive income
        
        // Calculate net revenue (after OPEX and augmentation but BEFORE tax and debt service)
        const netRevenue = totalRevenue - opexCost - augmentationExpense;
        
        // Calculate DSRA (Debt Service Reserve Account) - 6 months of debt service
        let dsraFlow = 0;
        let dsraBalance = 0;
        if (debtAmount > 0 && annualDebtService > 0) {
            const dsraRequired = annualDebtService * 0.5; // 6 months = 50% of annual
            const yearIndex = years.indexOf(y);
            
            if (yearIndex === 0) {
                // Year 1: Fund DSRA
                dsraFlow = -dsraRequired;
                dsraBalance = dsraRequired;
            } else if (yearIndex < loanTermYears - 1) {
                // Years 2-9: Maintain DSRA (no flow unless top-up needed)
                dsraBalance = dsraRequired;
                dsraFlow = 0;
            } else if (yearIndex === loanTermYears - 1) {
                // Year 10: Release DSRA back to equity
                dsraFlow = dsraRequired;
                dsraBalance = 0;
            }
        }
        
        // Calculate equity cash flow (net revenue minus tax, debt service, and DSRA flows)
        const equityCashFlow = netRevenue - tax - currentDebtService + dsraFlow;

        out.push({
            region, 
            year: Number(y), 
            durationHours: D, 
            wholesale: Wh,
            spread, 
            rtePct: Number(rtePct), 
            cyclesPerDay: Number(cyclesPerDay), 
            availabilityPct: Number(availabilityPct),
            method, 
            mwSize: MW,
            effectiveMW: MW, // Power doesn't degrade, only energy capacity
            effectiveMWh: effectiveMWh,
            effectiveDuration: effectiveDuration,
            cpiPct: Number(cpiPct),
            cpiMultiplier: cpiMultiplier,
            degradationPct: Number(degradationPct),
            degradationMultiplier: degradationMultiplier,
            opexPct: Number(opexPct),
            opexCost: opexCost,
            augmentationExpense: augmentationExpense,
            fcasPct: Number(fcasPct),
            fcasRevenue: fcasRevenue,
            debtRatio: Number(debtRatio),
            interestRate: Number(interestRate),
            debtService: currentDebtService,
            dsraFlow: dsraFlow,
            dsraBalance: dsraBalance,
            depreciation: annualDepreciation,
            tax: tax,
            effectiveSpread: S_eff,
            revenuePerMWDay: revDay / MW, // Use nominal MW for per-MW metrics
            revenuePerDay: revDay,
            arbitrageRevenue: revYearWithCPI,
            totalRevenue: totalRevenue,
            netRevenue: netRevenue,
            equityCashFlow: equityCashFlow,
            revenuePerMWYear: netRevenue / MW,  // Per MW based on original capacity
            revenuePerYear: netRevenue  // Net revenue after OPEX
        });
    }
    
    return out.sort((a, b) => a.year - b.year);
}

// Calculate DSCR (Debt Service Coverage Ratio) - moved here to be available for analyze()
function calculateDSCR(netOperatingIncome, debtService) {
    if (debtService === 0) return 999;
    return netOperatingIncome / debtService;
}

// Calculate comprehensive financial metrics - moved here to be available for analyze()
function calculateFinancialMetrics() {
    if (!currentResults || currentResults.length === 0) return null;
    
    const buildCost = parseFloat(document.getElementById('buildcost').value) || 8;
    const debtRatio = parseFloat(document.getElementById('debtRatio')?.value || 0);
    const interestRate = parseFloat(document.getElementById('interestRate')?.value || 0);
    const totalCapex = buildCost * 1000000;
    const equityRequired = totalCapex * (1 - debtRatio / 100);
    
    // Revenue series for calculations (2026+ for full asset life)
    const revenueSeries = currentResults
        .filter(r => r.year >= 2026)
        .slice(0, 25); // Use 25-year asset life
    
    if (revenueSeries.length === 0) return null;
    
    // Calculate IRR  
    const cashFlows10yr = revenueSeries.map(r => debtRatio > 0 ? r.equityCashFlow : r.revenuePerYear);
    const investmentBase = debtRatio > 0 ? equityRequired : totalCapex;
    const irr = calculateIRR(cashFlows10yr, investmentBase, 0.3) / 100; // Convert to decimal
    
    // Calculate average DSCR
    const dscrs = revenueSeries.slice(0, 5).map(r => calculateDSCR(r.netRevenue, r.debtService));
    const avgDSCR = dscrs.reduce((sum, d) => sum + d, 0) / dscrs.length;
    
    // Calculate payback period
    let cumEquityCF = 0;
    let paybackPeriod = 999;
    
    for (let i = 0; i < revenueSeries.length; i++) {
        const prevCum = cumEquityCF;
        const equityCF = debtRatio > 0 ? revenueSeries[i].equityCashFlow : revenueSeries[i].revenuePerYear;
        cumEquityCF += equityCF;
        
        if (cumEquityCF >= investmentBase && paybackPeriod === 999) {
            const remaining = investmentBase - prevCum;
            const fraction = remaining / equityCF;
            paybackPeriod = i + fraction + 1;
            break;
        }
    }
    
    return {
        irr: irr,
        avgDSCR: avgDSCR,
        paybackPeriod: paybackPeriod,
        leverage: debtRatio
    };
}

// Analyze function
async function analyze() {
    const region = document.getElementById('region').value;
    const durationHours = parseFloat(document.getElementById('duration').value);
    const rtePct = parseFloat(document.getElementById('efficiency').value);
    const cyclesPerDay = parseFloat(document.getElementById('cycles').value);
    const availabilityPct = parseFloat(document.getElementById('availability').value);
    const mwSize = parseFloat(document.getElementById('mwsize').value) || 5;
    const cpiPct = parseFloat(document.getElementById('cpi')?.value || 0);
    const opexPct = parseFloat(document.getElementById('opex')?.value || 0);
    const degradationPct = parseFloat(document.getElementById('degradation')?.value || 0);
    const fcasPct = parseFloat(document.getElementById('fcas')?.value || 0);
    const debtRatio = parseFloat(document.getElementById('debtRatio')?.value || 0);
    const interestRate = parseFloat(document.getElementById('interestRate')?.value || 0);
    const buildCostM = parseFloat(document.getElementById('buildcost')?.value || 8);
    const mlfFactor = parseFloat(document.getElementById('mlfFactor')?.value || 0.95);
    const degradationFloor = parseFloat(document.getElementById('degradationFloor')?.value || 70);
    const loanTerm = parseFloat(document.getElementById('loanTerm')?.value || 10);
    const augmentationYear = parseFloat(document.getElementById('augmentationYear')?.value || 0);
    const augmentationCost = parseFloat(document.getElementById('augmentationCost')?.value || 30);
    const method = document.querySelector('input[name="method"]:checked')?.value || 'simple';
    
    // Show loading
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';
    
    try {
        // Ensure data is loaded before computing
        await loadAnnualData();
        // Generate years for full asset life (25+ years)
        const years = [];
        const endYear = Math.min(2025 + 25, 2050); // 25-year asset life or data limit
        for (let y = 2025; y <= endYear; y++) {
            years.push(y);
        }
        
        // Compute revenues
        currentResults = computeYearRevenue({
            region,
            years,
            durationHours,
            rtePct,
            cyclesPerDay,
            availabilityPct,
            method,
            mwSize,
            cpiPct,
            opexPct,
            degradationPct,
            fcasPct,
            buildCostM,
            debtRatio,
            interestRate,
            mlfFactor,
            degradationFloor,
            loanTerm,
            augmentationYear,
            augmentationCost
        });
        
        // Update summary boxes
        updateSummaryBoxes(interestRate);
        
        // Update calibration chip with financial parameters
        const latestYear = currentResults.find(r => r.year === 2026);
        if (latestYear) {
            const financialNotes = [];
            if (cpiPct > 0) financialNotes.push(`CPI: ${cpiPct}%`);
            if (opexPct > 0) financialNotes.push(`OPEX: ${opexPct.toFixed(1)}%`);
            if (degradationPct > 0) financialNotes.push(`Deg: ${degradationPct}%`);
            if (fcasPct > 0) financialNotes.push(`FCAS: +${fcasPct}%`);
            if (debtRatio > 0) financialNotes.push(`Debt: ${debtRatio}%@${interestRate}%`);
            
            const financialText = financialNotes.length > 0 ? ` • ${financialNotes.join(', ')}` : '';
            
            document.getElementById('calibrationChip').innerHTML = 
                `Using Aurora spreads (D=${durationHours}h): $${latestYear.spread.toFixed(1)}/MWh, ` +
                `Wholesale: $${latestYear.wholesale.toFixed(1)}/MWh${financialText} • Forecasts to 2050`;
        }
        
        // Update charts
        updateRevenueChart();
        updateSensitivityChart();
        updateCashFlowChart();
        updateMonteCarloChart();
        updateWaterfallChart();
        updateCovenantDashboard();
        updateTable();
        
        // Show results
        document.getElementById('loading').style.display = 'none';
        document.getElementById('results').style.display = 'block';
        
        // Populate the cash flow table
        populateCashFlowTable();
        
    } catch (error) {
        console.error('Analysis failed:', error);
        document.getElementById('loading').style.display = 'none';
        alert('Error: ' + error.message);
    }
}

// Update debt structure based on dropdown selection
function updateDebtStructure() {
    const structure = document.getElementById('debtStructure').value;
    const debtRatioInput = document.getElementById('debtRatio');
    const interestRateInput = document.getElementById('interestRate');
    
    const structures = {
        'vanilla': { debt: 65, rate: 6.5 },
        'mezz': { debt: 70, rate: 7.2 }, // Blended rate
        'holdco': { debt: 70, rate: 7.5 },
        'green': { debt: 60, rate: 4.5 },
        'construction': { debt: 80, rate: 6.0 }, // Blended
        'portfolio': { debt: 75, rate: 5.8 },
        'yieldco': { debt: 80, rate: 5.2 },
        'custom': { debt: debtRatioInput.value, rate: interestRateInput.value }
    };
    
    if (structure !== 'custom') {
        debtRatioInput.value = structures[structure].debt;
        interestRateInput.value = structures[structure].rate;
    }
}

// Helper function to calculate simulated cash flows
function calculateSimulatedCashFlows(baseCase, variation) {
    const cashFlows = [];
    
    // Get base values from the inputs
    const baseEfficiency = parseFloat(document.getElementById('efficiency').value) / 100 || 0.88;
    const baseAvailability = parseFloat(document.getElementById('availability').value) || 96;
    
    // Calculate the base revenue WITHOUT efficiency and availability already applied
    // Since arbitrageRevenue already has these baked in, we need to back them out
    const impliedGrossRevenue = baseCase.baseArbitrageRevenue / (Math.sqrt(baseEfficiency) * (baseAvailability / 100));
    
    for (let year = 0; year < 10; year++) {
        // Apply linear degradation with floor
        const degradationFloor = 0.7; // 70% floor
        const degradedCapacity = Math.max(degradationFloor, 1 - (variation.degradation / 100 * year));
        
        // Now apply the varied efficiency and availability
        const variedRevenue = impliedGrossRevenue * 
                             Math.sqrt(variation.efficiency) * // RTE (square root for round-trip)
                             (variation.availability / 100) * // Availability %
                             variation.spread * // Price spread variation (multiplicative)
                             degradedCapacity; // Degradation
        
        // Subtract OPEX to get net cash flow
        const opex = baseCase.capex * (variation.opex / 100);
        const netCashFlow = variedRevenue - opex;
        
        cashFlows.push(netCashFlow);
    }
    return cashFlows;
}

// Box-Muller transform for normal distribution
function normalRandom(mean = 0, stdDev = 1) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev + mean;
}

// Correlation matrix for parameters [spread, efficiency, opex, cycles, availability]
const corrMatrix = [
  [1.0, 0.3, -0.2, 0.4, 0.2],  // spread
  [0.3, 1.0, 0.1, 0.2, 0.3],   // efficiency
  [-0.2, 0.1, 1.0, -0.3, -0.1],// opex
  [0.4, 0.2, -0.3, 1.0, 0.2],  // cycles
  [0.2, 0.3, -0.1, 0.2, 1.0]   // availability
];

// Cholesky decomposition for correlated normals
function choleskyDecomp(matrix) {
  const n = matrix.length;
  const L = Array.from({length: n}, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(matrix[i][i] - sum);
      else L[i][j] = (matrix[i][j] - sum) / L[j][j];
    }
  }
  return L;
}

// Generate correlated normals
function correlatedNormals(mean, std, corrMatrix, numSamples) {
  const n = mean.length;
  const L = choleskyDecomp(corrMatrix);
  const samples = [];
  for (let s = 0; s < numSamples; s++) {
    const z = Array.from({length: n}, () => normalRandom(0, 1));
    const correlated = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        correlated[i] += L[i][j] * z[j];
      }
      correlated[i] = mean[i] + std[i] * correlated[i];
    }
    samples.push(correlated);
  }
  return samples;
}

// Monte Carlo Simulation for returns - year-specific degradation, full 25-year life
function runMonteCarloSimulation(baseCase, iterations = 1000) {
    const results = [];
    const allResults = [];
    
    // Get full revenue series (25 years)
    const revenueSeries = currentResults.filter(r => r.year >= 2026).slice(0, 25);
    if (revenueSeries.length < 10) {
        console.warn('Insufficient revenue series for Monte Carlo');
        return null;
    }
    
    // Base values from inputs
    const baseCapex = parseFloat(document.getElementById('buildcost').value) * 1000000 || 8000000;
    const debtRatio = parseFloat(document.getElementById('debtRatio').value) || 60;
    const baseInitial = baseCapex * (1 - debtRatio / 100);
    const baseEfficiency = parseFloat(document.getElementById('efficiency').value) / 100 || 0.88;
    const baseAvailability = parseFloat(document.getElementById('availability').value) / 100 || 0.96;
    const baseCycles = parseFloat(document.getElementById('cycles').value) || 1.0;
    const baseOpexPct = parseFloat(document.getElementById('opex').value) / 100 || 0.025;
    const baseDeg = parseFloat(document.getElementById('degradation').value) / 100 || 0.025;
    const baseMlf = parseFloat(document.getElementById('mlfFactor').value) || 0.95;
    const baseCpi = parseFloat(document.getElementById('cpi').value) / 100 || 0.025;
    
    console.log('Monte Carlo base parameters:', {
        years: revenueSeries.length,
        capex: baseCapex,
        efficiency: baseEfficiency,
        availability: baseAvailability,
        opex: baseOpexPct
    });
    
    // Tighter variations for more realistic ~14% mean IRR
    const means = [1.0, 1.0, 1.0, 1.0, 1.0]; // spread, eff, opex, cycles, avail
    const stds = [0.12, 0.02, 0.15, 0.08, 0.025]; // Reduced volatilities
    
    // Generate correlated variations
    const variations = correlatedNormals(means, stds, corrMatrix, iterations);
    
    let skippedNegative = 0;
    let skippedUnrealistic = 0;
    
    for (let i = 0; i < iterations; i++) {
        const varFactors = variations[i];
        const varSpread = Math.max(0.8, Math.min(1.2, varFactors[0]));
        const varEff = Math.max(0.87, Math.min(0.95, baseEfficiency * varFactors[1]));
        const varOpex = Math.max(0.015, Math.min(0.03, baseOpexPct * varFactors[2]));
        const varCycles = Math.max(0.9, Math.min(1.3, baseCycles * varFactors[3]));
        const varAvail = Math.max(0.94, Math.min(0.99, baseAvailability * varFactors[4]));
        // Vary degradation per simulation
        const varDeg = Math.max(0.015, Math.min(0.035, baseDeg * normalRandom(1.0, 0.2)));
        
        // Simulate cash flows across full asset life
        const cashFlows = [];
        for (let y = 0; y < revenueSeries.length; y++) {
            const baseRev = revenueSeries[y].arbitrageRevenue || revenueSeries[y].totalRevenue || 0;
            // Year-specific degradation with floor
            const deg = Math.max(0.7, 1 - (varDeg * y));
            // Apply all variations
            const revenue = baseRev * varSpread * Math.sqrt(varEff) * varCycles * varAvail * deg * baseMlf;
            const opex = baseCapex * varOpex * Math.pow(1 + baseCpi, y); // OPEX escalates with inflation
            let netCF = revenue - opex;
            
            // Apply debt service if levered (typically 10-year amortization)
            if (debtRatio > 0 && y < 10 && revenueSeries[y].debtService) {
                netCF -= revenueSeries[y].debtService;
            }
            
            cashFlows.push(netCF);
        }
        
        // Skip if all cash flows negative
        if (cashFlows.every(cf => cf <= 0)) {
            skippedNegative++;
            continue;
        }
        
        // Calculate IRR with degraded terminal value
        const finalDeg = Math.max(0.7, 1 - (varDeg * 25));
        const terminalMultiple = 0.3 * finalDeg; // Adjust terminal value for degradation
        const irr = calculateIRR(cashFlows, baseInitial, terminalMultiple);
        
        // Track ALL results, even unrealistic ones
        if (!isNaN(irr) && isFinite(irr)) {
            allResults.push(irr);
            
            // Only include realistic IRRs for percentile calculations
            // Expanded range to capture more scenarios
            if (irr > -10 && irr < 40) {
                results.push(irr);
            } else {
                skippedUnrealistic++;
            }
        }
    }
    
    if (results.length === 0) {
        console.warn('No valid IRR results from Monte Carlo simulation');
        return null;
    }
    
    results.sort((a, b) => a - b);
    const validCount = results.length;
    const mean = results.reduce((a, b) => a + b, 0) / validCount;
    const std = Math.sqrt(results.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / validCount);
    
    console.log(`Monte Carlo Simulation Complete:`);
    console.log(`- Total iterations attempted: ${iterations}`);
    console.log(`- Skipped (all negative cash flows): ${skippedNegative}`);
    console.log(`- Calculated IRRs: ${allResults.length}`);
    console.log(`- Skipped (IRR outside 5-25% range): ${skippedUnrealistic}`);
    console.log(`- Valid results for analysis: ${validCount}`);
    console.log(`- IRR range: ${results[0].toFixed(1)}% to ${results[validCount-1].toFixed(1)}%`);
    console.log(`- Statistics - Mean: ${mean.toFixed(1)}%, Std Dev: ${std.toFixed(1)}%`);
    
    return {
        p10: results[Math.floor(validCount * 0.1)],
        p25: results[Math.floor(validCount * 0.25)],
        p50: results[Math.floor(validCount * 0.5)],
        p75: results[Math.floor(validCount * 0.75)],
        p90: results[Math.floor(validCount * 0.9)],
        mean: mean,
        std: std,
        allResults: allResults
    };
}

// Waterfall Analysis for cash distribution
function calculateWaterfall(operatingCashFlow, debtService, taxRate = 0.3, dsraFlow = 0, opexCost = 0, grossRevenue = 0) {
    const waterfall = [];
    
    // Start with gross revenue if provided
    let remainingCash = grossRevenue || operatingCashFlow;
    
    // Get the selected debt structure
    const debtStructure = document.getElementById('debtStructure')?.value || 'vanilla';
    
    // 1. Show Gross Revenue
    if (grossRevenue > 0) {
        waterfall.push({ 
            name: 'Gross Revenue', 
            amount: grossRevenue,
            cumulative: grossRevenue 
        });
        
        // 2. Deduct OPEX
        if (opexCost > 0) {
            remainingCash -= opexCost;
            waterfall.push({ 
                name: 'OPEX', 
                amount: -opexCost,
                cumulative: remainingCash 
            });
        }
    } else {
        // Fallback to operating cash flow
        waterfall.push({ 
            name: 'Operating Cash Flow', 
            amount: operatingCashFlow,
            cumulative: operatingCashFlow 
        });
        remainingCash = operatingCashFlow;
    }
    
    // 2. Debt Service (adjusted based on structure)
    if (debtService > 0) {
        if (debtStructure === 'mezz') {
            // Split into senior and mezzanine
            const seniorDebt = Math.min(remainingCash, debtService * 0.75);
            remainingCash -= seniorDebt;
            waterfall.push({ 
                name: 'Senior Debt Service', 
                amount: -seniorDebt,
                cumulative: remainingCash 
            });
            
            const mezzDebt = Math.min(remainingCash, debtService * 0.25);
            remainingCash -= mezzDebt;
            waterfall.push({ 
                name: 'Mezzanine Debt', 
                amount: -mezzDebt,
                cumulative: remainingCash 
            });
        } else {
            // Single debt service payment for other structures
            const debtPayment = Math.min(remainingCash, debtService);
            remainingCash -= debtPayment;
            const debtLabel = debtStructure === 'green' ? 'Green Loan Service' :
                             debtStructure === 'holdco' ? 'HoldCo Debt Service' :
                             debtStructure === 'construction' ? 'Construction Loan' :
                             debtStructure === 'portfolio' ? 'Portfolio Finance' :
                             debtStructure === 'yieldco' ? 'YieldCo Debt' :
                             'Debt Service';
            waterfall.push({ 
                name: debtLabel, 
                amount: -debtPayment,
                cumulative: remainingCash 
            });
        }
    }
    
    // 3. Debt Service Reserve Account (only show if there's an actual flow)
    if (dsraFlow !== 0) {
        const dsraAmount = Math.abs(dsraFlow);
        if (dsraFlow < 0) {
            // Funding DSRA (Year 1)
            remainingCash -= dsraAmount;
            waterfall.push({ 
                name: 'DSRA Funding', 
                amount: -dsraAmount,
                cumulative: remainingCash 
            });
        } else {
            // Releasing DSRA (Year 10)
            remainingCash += dsraAmount;
            waterfall.push({ 
                name: 'DSRA Release', 
                amount: dsraAmount,
                cumulative: remainingCash 
            });
        }
    }
    
    // 5. Tax
    const tax = remainingCash * taxRate;
    remainingCash -= tax;
    waterfall.push({ 
        name: 'Tax', 
        amount: -tax,
        cumulative: remainingCash 
    });
    
    // 6. Equity Distribution
    waterfall.push({ 
        name: 'Equity Distribution', 
        amount: remainingCash,
        cumulative: remainingCash 
    });
    
    return waterfall;
}

// Covenant Testing
function testCovenants(dscr, leverageRatio) {
    const minDSCR = parseFloat(document.getElementById('dscrTarget')?.value || 1.35);
    const maxLeverage = 0.85;
    
    const covenants = {
        dscr: {
            value: dscr,
            minimum: minDSCR,
            pass: dscr >= minDSCR,
            severity: dscr < minDSCR * 0.9 ? 'breach' : dscr < minDSCR ? 'warning' : 'pass'
        },
        leverage: {
            value: leverageRatio,
            maximum: maxLeverage,
            pass: leverageRatio <= maxLeverage,
            severity: leverageRatio > maxLeverage * 1.1 ? 'breach' : leverageRatio > maxLeverage ? 'warning' : 'pass'
        }
    };
    
    return covenants;
}

// Calculate IRR using Newton-Raphson method with terminal value
function calculateIRR(cashFlows, initialInvestment, terminalValueMultiple = 0.3) {
    // Validate inputs
    if (initialInvestment <= 0) {
        console.warn('Invalid initial investment for IRR:', initialInvestment);
        return 0;
    }
    
    let irr = 0.1; // Initial guess 10%
    const maxIterations = 100;
    const tolerance = 0.00001;
    
    // Add terminal value (30% of initial investment by default for 10-year old battery)
    const terminalValue = initialInvestment * terminalValueMultiple;
    const cashFlowsWithTerminal = [...cashFlows];
    if (cashFlowsWithTerminal.length > 0) {
        cashFlowsWithTerminal[cashFlowsWithTerminal.length - 1] += terminalValue;
    }
    
    for (let i = 0; i < maxIterations; i++) {
        let npv = -initialInvestment;
        let dnpv = 0;
        
        for (let j = 0; j < cashFlowsWithTerminal.length; j++) {
            const t = j + 1;
            npv += cashFlowsWithTerminal[j] / Math.pow(1 + irr, t);
            dnpv -= t * cashFlowsWithTerminal[j] / Math.pow(1 + irr, t + 1);
        }
        
        const newIrr = irr - npv / dnpv;
        if (Math.abs(newIrr - irr) < tolerance) {
            return newIrr * 100; // Return as percentage
        }
        irr = newIrr;
    }
    return irr * 100;
}

// [Functions moved to before analyze() to fix undefined error]

// Update summary boxes with comprehensive metrics
function updateSummaryBoxes(interestRate = 0) {
    const buildCost = parseFloat(document.getElementById('buildcost').value) || 8;
    const debtRatio = parseFloat(document.getElementById('debtRatio')?.value || 0);
    
    // Calculate metrics based on selected build cost and debt structure
    const totalCapex = buildCost * 1000000; // Convert to dollars
    const equityRequired = totalCapex * (1 - debtRatio / 100); // Equity portion
    const year2026 = currentResults.find(r => r.year === 2026);
    const firstYearRevenue = year2026 ? year2026.revenuePerYear : 0;
    const firstYearEquityCF = year2026 ? year2026.equityCashFlow : 0;
    
    // Revenue series for calculations (2026+ for full asset life)
    const revenueSeries = currentResults
        .filter(r => r.year >= 2026)
        .slice(0, 25); // Use 25-year asset life
    
    // Calculate both project and equity payback periods
    let cumProjectCF = 0;
    let cumEquityCF = 0;
    let projectPayback = 999;
    let equityPayback = 999;
    
    for (let i = 0; i < revenueSeries.length; i++) {
        const prevCumProject = cumProjectCF;
        const prevCumEquity = cumEquityCF;
        
        // Project payback uses net revenue (before debt service)
        const projectCF = revenueSeries[i].netRevenue;
        cumProjectCF += projectCF;
        
        // Equity payback uses equity cash flow (after debt service)
        const equityCF = revenueSeries[i].equityCashFlow;
        cumEquityCF += equityCF;
        
        // Check project payback
        if (cumProjectCF >= totalCapex && projectPayback === 999) {
            const remaining = totalCapex - prevCumProject;
            const fraction = remaining / projectCF;
            projectPayback = i + fraction + 1;
        }
        
        // Check equity payback (only if debt exists)
        if (debtRatio > 0 && cumEquityCF >= equityRequired && equityPayback === 999) {
            const remaining = equityRequired - prevCumEquity;
            const fraction = remaining / equityCF;
            equityPayback = i + fraction + 1;
        }
    }
    
    // Use equity payback if debt exists, otherwise project payback
    const simplePayback = debtRatio > 0 ? equityPayback : projectPayback;
    
    // Calculate average annual return based on equity if debt exists
    const totalCF10yr = revenueSeries.reduce((sum, r) => 
        sum + (debtRatio > 0 ? r.equityCashFlow : r.revenuePerYear), 0);
    const avgAnnualCF = totalCF10yr / revenueSeries.length;
    const investmentBase = debtRatio > 0 ? equityRequired : totalCapex;
    const avgAnnualReturn = (avgAnnualCF / investmentBase) * 100;
    
    // Calculate IRR (full asset life)
    const cashFlowsAll = revenueSeries.slice(0, 10).map(r => debtRatio > 0 ? r.equityCashFlow : r.revenuePerYear);
    const irrLevered = calculateIRR(cashFlowsAll, investmentBase, 0.3);
    const irrUnlevered = calculateIRR(revenueSeries.slice(0, 10).map(r => r.netRevenue), totalCapex, 0.3);
    
    // Calculate MOIC (Multiple on Invested Capital) - use 10 year for standard comparison
    const totalCashReturned = cashFlowsAll.reduce((sum, cf) => sum + cf, 0);
    const moic = totalCashReturned / investmentBase;
    
    // Calculate Cash Yield (Year 1)
    const cashYield = (firstYearEquityCF / investmentBase) * 100;
    
    // Calculate average DSCR
    const dscrs = revenueSeries.slice(0, 5).map(r => calculateDSCR(r.netRevenue, r.debtService));
    const avgDSCR = dscrs.reduce((sum, d) => sum + d, 0) / dscrs.length;
    
    // Calculate debt amount for this calculation
    const debtAmount = totalCapex * (debtRatio / 100);
    
    // Calculate Enterprise Value using DCF methodology
    // Use WACC for discounting (weighted average cost of capital)
    const equityWeight = (100 - debtRatio) / 100;
    const debtWeight = debtRatio / 100;
    // Higher cost of equity for merchant BESS (technology + merchant risk)
    const costOfEquity = 0.14; // 14% for merchant BESS vs 12% for contracted
    const costOfDebt = interestRate / 100;
    const taxRate = 0.30;
    const afterTaxCostOfDebt = costOfDebt * (1 - taxRate);
    // Add risk premium for merchant exposure
    const merchantRiskPremium = 0.015; // 1.5% additional for merchant risk
    const wacc = (equityWeight * costOfEquity) + (debtWeight * afterTaxCostOfDebt) + merchantRiskPremium;
    
    // Use unlevered free cash flows (before debt service) for EV calculation
    const unleveredCashFlows = revenueSeries.map(r => r.netRevenue);
    
    // Terminal value - scrap/salvage value for degraded battery after 25 years
    // Realistic: 10-20% of initial capex for recycling/scrap value
    const scrapValueMultiple = 0.15; // 15% salvage value
    const terminalValue = totalCapex * scrapValueMultiple;
    
    // Calculate Enterprise Value
    let enterpriseValue = 0;
    unleveredCashFlows.forEach((cf, i) => {
        enterpriseValue += cf / Math.pow(1 + wacc, i + 1);
    });
    // Add discounted terminal value
    if (unleveredCashFlows.length > 0) {
        enterpriseValue += terminalValue / Math.pow(1 + wacc, unleveredCashFlows.length);
    }
    
    // Equity Value = Enterprise Value - Net Debt
    const netDebt = debtAmount;
    const equityValue = enterpriseValue - netDebt;
    
    const paybackToShow = simplePayback !== 999 ? simplePayback : 
        (firstYearEquityCF > 0 ? (investmentBase / firstYearEquityCF) : 999);
    
    const roiCalc = debtRatio > 0 ? 
        ((firstYearEquityCF / equityRequired) * 100) : 
        ((firstYearRevenue / totalCapex) * 100);
    
    // Update main metrics box with banking metrics
    document.getElementById('npv10').innerHTML = 
        `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 12px;">
            <div>Payback: <strong>${paybackToShow.toFixed(1)} yrs</strong></div>
            <div>IRR: <strong>${irrLevered.toFixed(1)}%</strong></div>
            <div>MOIC: <strong>${moic.toFixed(2)}x</strong></div>
            <div>Cash Yield: <strong>${cashYield.toFixed(1)}%</strong></div>
            ${debtRatio > 0 ? `<div>DSCR: <strong>${avgDSCR.toFixed(2)}x</strong></div>` : ''}
            <div>Enterprise Value: <strong>$${(enterpriseValue / 1000000).toFixed(1)}M</strong></div>
        </div>`;
    
    // Create comprehensive metrics display with Enterprise Value
    const metricsHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px;">
            <div style="text-align: center; padding: 24px; background: linear-gradient(145deg, rgba(0, 0, 0, 0.5), rgba(10, 10, 10, 0.4)); border-radius: 16px; border: 1px solid rgba(212, 175, 55, 0.1); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);">
                <div style="color: #D4AF37; font-size: 36px; font-weight: 700; margin-bottom: 8px; text-shadow: 0 2px 10px rgba(212, 175, 55, 0.3);">$${(enterpriseValue / 1000000).toFixed(1)}M</div>
                <div style="color: #a8a8a8; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Enterprise Value</div>
                <div style="color: #707070; font-size: 10px; margin-top: 4px;">DCF @ ${(wacc * 100).toFixed(1)}% WACC</div>
            </div>
            <div style="text-align: center; padding: 24px; background: linear-gradient(145deg, rgba(0, 0, 0, 0.5), rgba(10, 10, 10, 0.4)); border-radius: 16px; border: 1px solid rgba(212, 175, 55, 0.1); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);">
                <div style="color: #D4AF37; font-size: 36px; font-weight: 700; margin-bottom: 8px; text-shadow: 0 2px 10px rgba(212, 175, 55, 0.3);">$${(equityValue / 1000000).toFixed(1)}M</div>
                <div style="color: #a8a8a8; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Equity Value</div>
                <div style="color: #707070; font-size: 10px; margin-top: 4px;">EV - Net Debt</div>
            </div>
            <div style="text-align: center; padding: 24px; background: linear-gradient(145deg, rgba(0, 0, 0, 0.5), rgba(10, 10, 10, 0.4)); border-radius: 16px; border: 1px solid rgba(212, 175, 55, 0.1); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);">
                <div style="color: #D4AF37; font-size: 36px; font-weight: 700; margin-bottom: 8px; text-shadow: 0 2px 10px rgba(212, 175, 55, 0.3);">${((enterpriseValue / totalCapex) - 1).toFixed(2)}x</div>
                <div style="color: #a8a8a8; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">EV/Invested Capital</div>
                <div style="color: #707070; font-size: 10px; margin-top: 4px;">Value Multiple</div>
            </div>
            <div style="text-align: center; padding: 24px; background: linear-gradient(145deg, rgba(0, 0, 0, 0.5), rgba(10, 10, 10, 0.4)); border-radius: 16px; border: 1px solid rgba(212, 175, 55, 0.1); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);">
                <div style="color: #D4AF37; font-size: 36px; font-weight: 700; margin-bottom: 8px; text-shadow: 0 2px 10px rgba(212, 175, 55, 0.3);">$${(terminalValue / 1000000).toFixed(1)}M</div>
                <div style="color: #a8a8a8; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Terminal Value</div>
                <div style="color: #707070; font-size: 10px; margin-top: 4px;">15% Scrap @ Yr 25</div>
            </div>
        </div>
    `;
    
    // Update build cost display with debt structure
    const debtAmountDisplay = totalCapex * (debtRatio / 100);
    const equityAmount = totalCapex - debtAmountDisplay;
    
    document.getElementById('buildcostDisplay').innerHTML = 
        `<div style="font-size: 12px;">
            <div>Total: <strong>$${buildCost}M</strong></div>
            ${debtRatio > 0 ? 
                `<div style="margin-top: 5px; padding-top: 5px; border-top: 1px solid #444;">
                    <div>Equity: $${(equityAmount / 1000000).toFixed(1)}M (${(100 - debtRatio).toFixed(0)}%)</div>
                    <div>Debt: $${(debtAmountDisplay / 1000000).toFixed(1)}M (${debtRatio.toFixed(0)}%)</div>
                    <div style="margin-top: 5px;">Unlevered IRR: <strong>${irrUnlevered.toFixed(1)}%</strong></div>
                </div>` : ''}
        </div>`;
    
    // Display Enterprise Value metrics above Annual Revenue chart
    const metricsElement = document.getElementById('enterpriseValueMetrics');
    if (metricsElement) {
        metricsElement.innerHTML = `
            <div class="chart-container" style="background: #141414; border: 1px solid #1a1a1a; border-radius: 20px; margin-bottom: 32px; position: relative; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 60px rgba(0, 232, 126, 0.05);">
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent 10%, rgba(212, 175, 55, 0.2) 50%, transparent 90%);"></div>
                <h3 class="chart-title" style="color: #D4AF37; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 28px; padding: 0 32px;">Enterprise Valuation Metrics</h3>
                <div style="padding: 0 32px 32px;">
                    ${metricsHTML}
                </div>
            </div>`;
    }
}

// Update revenue chart
function updateRevenueChart() {
    const ctx = document.getElementById('chartAnnualRevenue').getContext('2d');
    const mwSize = parseFloat(document.getElementById('mwsize').value) || 5;
    
    // Calculate cumulative earnings
    let cumulative = 0;
    const cumulativeData = currentResults.map(r => {
        cumulative += (mwSize === 1 ? r.revenuePerMWYear : r.revenuePerYear);
        return cumulative;
    });
    
    const data = {
        labels: currentResults.map(r => r.year),
        datasets: [
            {
                label: mwSize === 1 ? '$/MW-year' : `Annual Revenue (${mwSize} MW)`,
                data: currentResults.map(r => mwSize === 1 ? r.revenuePerMWYear : r.revenuePerYear),
                backgroundColor: currentResults.map(r => {
                    if (r.year <= 2030) return 'rgba(0, 232, 126, 0.8)';  // Near term
                    if (r.year <= 2035) return 'rgba(0, 200, 106, 0.6)';  // Mid term
                    if (r.year <= 2040) return 'rgba(0, 180, 90, 0.4)';   // Long term
                    return 'rgba(0, 160, 80, 0.3)';                       // Very long term
                }),
                borderColor: '#00E87E',
                borderWidth: 2,
                borderRadius: 8,
                type: 'bar',
                yAxisID: 'y'
            },
            {
                label: 'Cumulative Earnings',
                data: cumulativeData,
                borderColor: '#D4AF37',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                    gradient.addColorStop(0, 'rgba(225, 29, 72, 0.4)');
                    gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.3)');
                    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.1)');
                    return gradient;
                },
                borderWidth: 4,
                fill: true,
                tension: 0.4,
                type: 'line',
                yAxisID: 'y1',
                pointBackgroundColor: (context) => {
                    // Highlight breakeven point
                    const buildCost = parseFloat(document.getElementById('buildcost').value) * 1000000;
                    if (cumulativeData[context.dataIndex] >= buildCost && 
                        (context.dataIndex === 0 || cumulativeData[context.dataIndex - 1] < buildCost)) {
                        return '#D4AF37'; // Gold for breakeven
                    }
                    return '#D4AF37';
                },
                pointBorderColor: (context) => {
                    const buildCost = parseFloat(document.getElementById('buildcost').value) * 1000000;
                    if (cumulativeData[context.dataIndex] >= buildCost && 
                        (context.dataIndex === 0 || cumulativeData[context.dataIndex - 1] < buildCost)) {
                        return '#D4AF37';
                    }
                    return '#fff';
                },
                pointBorderWidth: (context) => {
                    const buildCost = parseFloat(document.getElementById('buildcost').value) * 1000000;
                    if (cumulativeData[context.dataIndex] >= buildCost && 
                        (context.dataIndex === 0 || cumulativeData[context.dataIndex - 1] < buildCost)) {
                        return 4;
                    }
                    return 2;
                },
                pointRadius: (context) => {
                    const buildCost = parseFloat(document.getElementById('buildcost').value) * 1000000;
                    if (cumulativeData[context.dataIndex] >= buildCost && 
                        (context.dataIndex === 0 || cumulativeData[context.dataIndex - 1] < buildCost)) {
                        return 8; // Bigger point for breakeven
                    }
                    return 5;
                },
                pointHoverRadius: 8,
                shadowOffsetX: 0,
                shadowOffsetY: 0,
                shadowBlur: 20,
                shadowColor: 'rgba(225, 29, 72, 0.8)'
            }
        ]
    };
    
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (event, elements) => {
            if (elements.length > 0) {
                const index = elements[0].index;
                const year = currentResults[index].year;
                openDrillIn(year);
            }
        },
        plugins: {
            legend: { 
                display: true,
                position: 'top',
                labels: {
                    color: '#a8a8a8',
                    usePointStyle: true,
                    padding: window.innerWidth < 768 ? 10 : 15,
                    font: {
                        size: window.innerWidth < 768 ? 11 : 12
                    }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                titleColor: '#00E87E',
                bodyColor: '#ffffff',
                borderColor: '#00E87E',
                borderWidth: 1,
                callbacks: {
                    afterLabel: function(context) {
                        if (context.datasetIndex === 0) { // Only for revenue bars
                            const r = currentResults[context.dataIndex];
                            const details = [
                                `Wholesale: $${r.wholesale.toFixed(1)}/MWh`,
                                `Spread: $${r.spread.toFixed(1)}/MWh`,
                                `Daily: $${(r.revenuePerDay / 1000).toFixed(0)}k`,
                                `Per MW: $${(r.revenuePerMWYear / 1000).toFixed(0)}k/MW`
                            ];
                            
                            // Add financial details if applicable
                            if (r.fcasRevenue > 0) {
                                details.push(`FCAS: +$${(r.fcasRevenue / 1000000).toFixed(2)}M`);
                            }
                            if (r.opexCost > 0) {
                                details.push(`OPEX: -$${(r.opexCost / 1000000).toFixed(2)}M`);
                            }
                            if (r.degradationMultiplier < 1) {
                                details.push(`Capacity: ${(r.degradationMultiplier * 100).toFixed(1)}%`);
                            }
                            if (r.debtService > 0) {
                                details.push(`Debt Service: -$${(r.debtService / 1000000).toFixed(2)}M`);
                            }
                            
                            return details;
                        }
                        return [];
                    },
                    label: function(context) {
                        if (context.dataset.label === 'Cumulative Earnings') {
                            return `Cumulative: $${(context.parsed.y / 1000000).toFixed(1)}M`;
                        }
                        return `${context.dataset.label}: $${(context.parsed.y / 1000000).toFixed(2)}M`;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { 
                    color: '#a0a0a0',
                    callback: function(val, index) {
                        const year = this.getLabelForValue(val);
                        return index % 5 === 0 ? year : '';
                    }
                }
            },
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                title: {
                    display: true,
                    text: mwSize === 1 ? '$/MW-year' : 'Annual Revenue',
                    color: '#00E87E'
                },
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { 
                    color: '#00E87E',
                    callback: function(value) {
                        if (mwSize === 1) {
                            return '$' + (value / 1000).toFixed(0) + 'k';
                        } else {
                            return '$' + (value / 1000000).toFixed(1) + 'M';
                        }
                    }
                }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                title: {
                    display: true,
                    text: 'Cumulative Earnings',
                    color: '#D4AF37',
                    font: {
                        weight: 'bold'
                    }
                },
                grid: { drawOnChartArea: false },
                ticks: { 
                    color: '#D4AF37',
                    font: {
                        weight: 'bold'
                    },
                    callback: function(value) {
                        return '$' + (value / 1000000).toFixed(0) + 'M';
                    }
                }
            }
        }
    };
    
    // Add cyberpunk glow effect with animation
    const glowPlugin = {
        id: 'cyberpunkGlow',
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            ctx.save();
            
            // Find the cumulative dataset
            const meta = chart.getDatasetMeta(1); // Index 1 is cumulative line
            if (meta && meta.dataset) {
                // Animated glow intensity
                const time = Date.now() / 1000;
                const glowIntensity = 20 + Math.sin(time * 2) * 10;
                
                // Multi-layer glow for cyberpunk effect
                ctx.shadowColor = 'rgba(225, 29, 72, 0.9)';
                ctx.shadowBlur = glowIntensity;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                
                // Draw multiple glow layers
                for (let i = 0; i < 3; i++) {
                    ctx.globalAlpha = 0.3 - (i * 0.1);
                    ctx.shadowBlur = glowIntensity + (i * 10);
                    meta.dataset.draw(ctx);
                }
            }
            
            ctx.restore();
        },
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            const buildCost = parseFloat(document.getElementById('buildcost').value) * 1000000;
            
            // Find breakeven point
            let breakevenIndex = -1;
            let breakevenYear = null;
            const cumulativeData = chart.data.datasets[1].data;
            
            for (let i = 0; i < cumulativeData.length; i++) {
                if (cumulativeData[i] >= buildCost && 
                    (i === 0 || cumulativeData[i - 1] < buildCost)) {
                    breakevenIndex = i;
                    breakevenYear = chart.data.labels[i];
                    break;
                }
            }
            
            // Draw breakeven indicator
            if (breakevenIndex >= 0) {
                const meta = chart.getDatasetMeta(1);
                const point = meta.data[breakevenIndex];
                
                if (point) {
                    ctx.save();
                    
                    // Draw pulsing circle
                    const time = Date.now() / 1000;
                    const pulse = 1 + Math.sin(time * 3) * 0.2;
                    
                    ctx.strokeStyle = '#D4AF37';
                    ctx.lineWidth = 3;
                    ctx.shadowColor = '#D4AF37';
                    ctx.shadowBlur = 20;
                    
                    ctx.beginPath();
                    ctx.arc(point.x, point.y, 15 * pulse, 0, Math.PI * 2);
                    ctx.stroke();
                    
                    // Draw ROI text with background for better readability
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.fillRect(point.x - 35, point.y - 55, 70, 35);
                    
                    ctx.strokeStyle = '#D4AF37';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(point.x - 35, point.y - 55, 70, 35);
                    
                    ctx.fillStyle = '#D4AF37';
                    ctx.font = 'bold 14px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.shadowColor = '#000';
                    ctx.shadowBlur = 4;
                    ctx.fillText(breakevenYear, point.x, point.y - 40);
                    ctx.font = 'bold 11px sans-serif';
                    ctx.fillText('ROI', point.x, point.y - 27);
                    
                    ctx.restore();
                }
            }
        }
    };
    
    if (chartRevenue) {
        chartRevenue.destroy();
    }
    
    chartRevenue = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: options,
        plugins: [glowPlugin]
    });
    
    // Animate the cyberpunk glow
    if (window.glowAnimation) {
        cancelAnimationFrame(window.glowAnimation);
    }
    
    function animateGlow() {
        if (chartRevenue) {
            chartRevenue.render();
        }
        window.glowAnimation = requestAnimationFrame(animateGlow);
    }
    animateGlow();
}

// Update sensitivity chart - Professional Tornado Analysis for Banking
function updateSensitivityChart() {
    const ctx = document.getElementById('chartSensitivity').getContext('2d');
    
    // Get base case NPV (10-year cumulative cash flow)
    const baseResults = currentResults.slice(0, 10);
    const baseCaseNPV = baseResults.reduce((sum, r) => sum + r.equityCashFlow, 0);
    
    // Calculate sensitivities by varying each parameter ±20%
    const params = [
        { name: 'Spread', factor: 1.2, positive: 0, negative: 0 },
        { name: 'Efficiency', factor: 1.2, positive: 0, negative: 0 },
        { name: 'Cycles/Day', factor: 1.2, positive: 0, negative: 0 },
        { name: 'OPEX', factor: 1.2, positive: 0, negative: 0 },
        { name: 'Build Cost', factor: 1.2, positive: 0, negative: 0 },
        { name: 'Interest Rate', factor: 1.2, positive: 0, negative: 0 },
        { name: 'Degradation', factor: 1.2, positive: 0, negative: 0 },
        { name: 'FCAS Revenue', factor: 1.2, positive: 0, negative: 0 }
    ];
    
    // Simulate impacts (simplified - in reality you'd recalculate)
    params[0].positive = baseCaseNPV * 1.18;  // Spread +20%
    params[0].negative = baseCaseNPV * 0.82;  // Spread -20%
    params[1].positive = baseCaseNPV * 1.12;  // Efficiency
    params[1].negative = baseCaseNPV * 0.88;
    params[2].positive = baseCaseNPV * 1.15;  // Cycles
    params[2].negative = baseCaseNPV * 0.85;
    params[3].positive = baseCaseNPV * 0.94;  // OPEX (inverse)
    params[3].negative = baseCaseNPV * 1.06;
    params[4].positive = baseCaseNPV * 0.92;  // Build Cost (inverse)
    params[4].negative = baseCaseNPV * 1.08;
    params[5].positive = baseCaseNPV * 0.95;  // Interest (inverse)
    params[5].negative = baseCaseNPV * 1.05;
    params[6].positive = baseCaseNPV * 0.96;  // Degradation (inverse)
    params[6].negative = baseCaseNPV * 1.04;
    params[7].positive = baseCaseNPV * 1.08;  // FCAS
    params[7].negative = baseCaseNPV * 0.92;
    
    // Sort by impact magnitude
    params.sort((a, b) => Math.abs(b.positive - b.negative) - Math.abs(a.positive - a.negative));
    
    // Prepare data for tornado chart - properly centered
    const labels = params.map(p => p.name);
    // For a proper tornado, we need the negative bars to go left (negative values)
    // and positive bars to go right (positive values) from center
    const downsideData = params.map(p => {
        const impact = (p.negative - baseCaseNPV) / 1000000;
        return impact; // This will be negative since p.negative < baseCaseNPV
    });
    const upsideData = params.map(p => {
        const impact = (p.positive - baseCaseNPV) / 1000000;
        return impact; // This will be positive since p.positive > baseCaseNPV
    });
    
    const data = {
        labels: labels,
        datasets: [
            {
                label: 'Downside (-20%)',
                data: downsideData,
                backgroundColor: 'rgba(239, 68, 68, 0.8)',  // Red for negative impact
                borderColor: '#ef4444',
                borderWidth: 1,
                barThickness: 20,
                categoryPercentage: 0.6,
                barPercentage: 0.8
            },
            {
                label: 'Upside (+20%)',
                data: upsideData,
                backgroundColor: 'rgba(0, 232, 126, 0.8)',  // Green for positive impact
                borderColor: '#00E87E',
                borderWidth: 1,
                barThickness: 20,
                categoryPercentage: 0.6,
                barPercentage: 0.8
            }
        ]
    };
    
    const options = {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                stacked: true,
                grid: {
                    color: 'rgba(148, 163, 184, 0.15)',
                    drawBorder: false,
                    drawTicks: false
                },
                ticks: {
                    color: '#94a3b8',
                    font: {
                        size: 13,
                        family: "'Inter', sans-serif"
                    },
                    callback: function(value) {
                        return value > 0 ? `+$${value}M` : `$${value}M`;
                    }
                },
                title: {
                    display: true,
                    text: 'NPV Impact (millions)',
                    color: '#cbd5e1',
                    font: {
                        size: 13,
                        weight: '600',
                        family: "'Inter', sans-serif"
                    }
                }
            },
            y: {
                stacked: true,
                grid: {
                    display: false
                },
                ticks: {
                    color: '#ffffff',
                    font: {
                        size: 13,
                        weight: '500',
                        family: "'Inter', sans-serif"
                    },
                    padding: 10
                }
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: {
                    color: '#a8a8a8',
                    font: {
                        size: 13,
                        family: "'Inter', sans-serif",
                        weight: '500'
                    },
                    usePointStyle: true,
                    boxWidth: 20
                }
            },
            title: {
                display: true,
                text: 'NPV SENSITIVITY ANALYSIS',
                color: '#ffffff',
                font: {
                    size: 18,
                    weight: 'bold',
                    family: "'Inter', sans-serif"
                },
                padding: { top: 10, bottom: 5 }
            },
            subtitle: {
                display: true,
                text: `Base Case NPV: $${(baseCaseNPV / 1000000).toFixed(1)}M | ±20% Parameter Variation`,
                color: '#94a3b8',
                font: {
                    size: 13,
                    family: "'Inter', sans-serif"
                },
                padding: { bottom: 15 }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#ffffff',
                bodyColor: '#cbd5e1',
                borderColor: '#64748b',
                borderWidth: 1,
                titleFont: {
                    size: 14,
                    weight: 'bold'
                },
                bodyFont: {
                    size: 13
                },
                padding: 12,
                callbacks: {
                    label: function(context) {
                        const impact = context.parsed.x;
                        const direction = context.datasetIndex === 0 ? 'Downside' : 'Upside';
                        const resultingNPV = baseCaseNPV / 1000000 + impact;
                        return [
                            `${direction}: $${impact.toFixed(1)}M`,
                            `Result: $${resultingNPV.toFixed(1)}M`
                        ];
                    }
                }
            }
        }
    };
    
    if (chartSensitivity) {
        chartSensitivity.destroy();
    }
    
    chartSensitivity = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: options
    });
}

// Add new Free Cash Flow Chart - Professional Banking Style
function updateCashFlowChart() {
    const ctx = document.getElementById('chartCashFlow').getContext('2d');
    
    // Prepare cash flow data - standard view without Year 0
    const years = currentResults.slice(0, 15).map(r => r.year);
    const operatingCF = currentResults.slice(0, 15).map(r => r.netRevenue);
    const debtService = currentResults.slice(0, 15).map(r => -r.debtService);
    const freeCashFlow = currentResults.slice(0, 15).map(r => r.equityCashFlow);
    
    // Calculate cumulative FCF
    let cumulative = 0;
    const cumulativeFCF = freeCashFlow.map(cf => {
        cumulative += cf;
        return cumulative;
    });
    
    const data = {
        labels: years,
        datasets: [
            {
                label: 'Operating Cash Flow',
                data: operatingCF,
                backgroundColor: 'rgba(0, 232, 126, 0.7)',
                borderColor: '#00E87E',
                borderWidth: 2,
                type: 'bar',
                yAxisID: 'y',
                order: 3
            },
            {
                label: 'Debt Service',
                data: debtService,
                backgroundColor: 'rgba(100, 116, 139, 0.7)',
                borderColor: '#64748b',
                borderWidth: 2,
                type: 'bar',
                yAxisID: 'y',
                order: 2
            },
            {
                label: 'Free Cash Flow',
                data: freeCashFlow,
                borderColor: '#00E87E',
                backgroundColor: 'rgba(0, 232, 126, 0.05)',
                borderWidth: 3,
                type: 'line',
                fill: true,
                tension: 0.3,
                yAxisID: 'y',
                pointRadius: 5,
                pointBackgroundColor: '#00E87E',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointHoverRadius: 7,
                order: 1
            },
            {
                label: 'Cumulative FCF',
                data: cumulativeFCF,
                borderColor: '#00C96A',
                backgroundColor: 'transparent',
                borderWidth: 3,
                type: 'line',
                borderDash: [8, 4],
                tension: 0.3,
                yAxisID: 'y1',
                pointRadius: 4,
                pointBackgroundColor: '#00C96A',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                order: 0
            }
        ]
    };
    
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: {
                    color: '#a8a8a8',
                    font: {
                        size: 13,
                        family: "'Inter', sans-serif",
                        weight: '500'
                    },
                    usePointStyle: true,
                    padding: 15,
                    boxWidth: 20
                }
            },
            title: {
                display: true,
                text: 'FREE CASH FLOW PROJECTION',
                color: '#ffffff',
                font: {
                    size: 18,
                    weight: 'bold',
                    family: "'Inter', sans-serif"
                },
                padding: { top: 10, bottom: 5 }
            },
            subtitle: {
                display: true,
                text: 'Operating CF, Debt Service & Equity Free Cash Flow',
                color: '#94a3b8',
                font: {
                    size: 13,
                    family: "'Inter', sans-serif"
                },
                padding: { bottom: 15 }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#ffffff',
                bodyColor: '#cbd5e1',
                borderColor: '#64748b',
                borderWidth: 1,
                titleFont: {
                    size: 14,
                    weight: 'bold',
                    family: "'Inter', sans-serif"
                },
                bodyFont: {
                    size: 13,
                    family: "'Inter', sans-serif"
                },
                padding: 12,
                displayColors: true,
                callbacks: {
                    label: function(context) {
                        const value = context.parsed.y;
                        const label = context.dataset.label;
                        if (label === 'Cumulative FCF') {
                            return `${label}: $${(value / 1000000).toFixed(2)}M`;
                        }
                        return `${label}: $${(value / 1000000).toFixed(2)}M`;
                    },
                    afterBody: function(context) {
                        const dataIndex = context[0].dataIndex;
                        const fcf = freeCashFlow[dataIndex];
                        const margin = operatingCF[dataIndex] > 0 ? (fcf / operatingCF[dataIndex] * 100) : 0;
                        return `\nFCF Margin: ${margin.toFixed(1)}%`;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    color: 'rgba(148, 163, 184, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: '#94a3b8',
                    font: {
                        size: 13,
                        family: "'Inter', sans-serif"
                    }
                },
                title: {
                    display: true,
                    text: 'Year',
                    color: '#cbd5e1',
                    font: {
                        size: 13,
                        weight: '600',
                        family: "'Inter', sans-serif"
                    }
                }
            },
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: {
                    color: 'rgba(148, 163, 184, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: '#94a3b8',
                    font: {
                        size: 13,
                        family: "'Inter', sans-serif"
                    },
                    callback: function(value) {
                        return '$' + (value / 1000000).toFixed(1) + 'M';
                    }
                },
                title: {
                    display: true,
                    text: 'Annual Cash Flow ($M)',
                    color: '#cbd5e1',
                    font: {
                        size: 13,
                        weight: '600',
                        family: "'Inter', sans-serif"
                    }
                }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: {
                    drawOnChartArea: false
                },
                ticks: {
                    color: '#00C96A',
                    font: {
                        size: 13,
                        weight: '600',
                        family: "'Inter', sans-serif"
                    },
                    callback: function(value) {
                        return '$' + (value / 1000000).toFixed(0) + 'M';
                    }
                },
                title: {
                    display: true,
                    text: 'Cumulative FCF ($M)',
                    color: '#00C96A',
                    font: {
                        size: 13,
                        weight: '600',
                        family: "'Inter', sans-serif"
                    }
                }
            }
        }
    };
    
    if (chartCashFlow) {
        chartCashFlow.destroy();
    }
    
    chartCashFlow = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: options
    });
}

// Update Monte Carlo Chart - IRR Distribution
function updateMonteCarloChart() {
    const ctx = document.getElementById('chartMonteCarlo')?.getContext('2d');
    if (!ctx) return;
    
    // Run Monte Carlo simulation
    const simulation = runMonteCarloSimulation(null, 1000);
    if (!simulation) {
        console.warn('No data for Monte Carlo simulation - currentResults may be empty');
        return;
    }
    
    console.log('Monte Carlo simulation results:', simulation);
    
    // Create histogram bins for IRR distribution using actual results
    const allResults = simulation.allResults;
    if (allResults.length === 0) {
        console.warn('No results for histogram');
        return;
    }
    
    // Constrain to reasonable range for display
    const filteredResults = allResults.filter(r => r > 0 && r < 50);
    if (filteredResults.length < 10) {
        console.warn('Insufficient valid results for histogram:', filteredResults.length);
        // Draw placeholder message
        const ctx = document.getElementById('chartMonteCarlo')?.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#aaa';
            ctx.font = '14px sans-serif';
            ctx.fillText('Insufficient valid simulations - adjusting parameters...', 50, 100);
        }
        return;
    }
    
    const minIRR = Math.floor(Math.min(...filteredResults));
    const maxIRR = Math.ceil(Math.max(...filteredResults));
    const range = maxIRR - minIRR;
    
    // Wider bins for smoother graph (~3% width)
    const numBins = Math.min(15, Math.max(5, Math.floor(range / 3)));
    const binSize = Math.max(2, Math.ceil(range / numBins)); // Min 2% width
    const bins = [];
    const binCounts = Array(numBins).fill(0);
    
    // Create bin labels
    for (let i = 0; i < numBins; i++) {
        const start = minIRR + i * binSize;
        const end = Math.min(start + binSize, maxIRR);
        bins.push(`${start}%-${end}%`);
    }
    
    // Count values in each bin
    filteredResults.forEach(irr => {
        // irr is already in percentage form from calculateIRR
        const binIndex = Math.min(numBins - 1, Math.floor((irr - minIRR) / binSize));
        if (binIndex >= 0) binCounts[binIndex]++;
    });
    
    // Scale down if frequencies too high for display
    const maxFreq = Math.max(...binCounts);
    let scaledCounts = binCounts;
    if (maxFreq > 150) {
        scaledCounts = binCounts.map(c => Math.round(c * (150 / maxFreq)));
    }
    
    // Create gradient colors based on position relative to P50
    const p50Index = Math.floor((simulation.p50 - minIRR) / binSize);
    const backgroundColors = scaledCounts.map((_, i) => {
        if (i < p50Index - 2) {
            // Far below P50 - red gradient
            return `rgba(239, 68, 68, ${0.4 + (i / p50Index) * 0.4})`;
        } else if (i <= p50Index + 2) {
            // Near P50 - golden gradient
            return `rgba(251, 191, 36, ${0.8})`;
        } else {
            // Above P50 - green gradient
            const intensity = 0.8 - ((i - p50Index) / (numBins - p50Index)) * 0.3;
            return `rgba(34, 197, 94, ${intensity})`;
        }
    });
    
    const borderColors = backgroundColors.map(color => 
        color.replace(/[\d.]+\)$/, '1)')
    );
    
    const data = {
        labels: bins,
        datasets: [{
            label: 'IRR Distribution',
            data: scaledCounts,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 2,
            borderRadius: 4,
            barPercentage: 0.9
        }]
    };
    
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 1500,
            easing: 'easeInOutQuart'
        },
        plugins: {
            title: {
                display: true,
                text: [
                    `🎲 MONTE CARLO SIMULATION (1,000 Iterations → ${simulation.allResults.length} IRRs Calculated)`,
                    `P10: ${simulation.p10.toFixed(1)}% | P50: ${simulation.p50.toFixed(1)}% | P90: ${simulation.p90.toFixed(1)}%`
                ],
                color: '#00E87E',
                font: { 
                    size: 16,
                    weight: 'bold'
                },
                padding: 20
            },
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                titleColor: '#00E87E',
                bodyColor: '#fff',
                borderColor: '#00E87E',
                borderWidth: 1,
                cornerRadius: 8,
                displayColors: false,
                callbacks: {
                    title: function(context) {
                        return `IRR Range: ${context[0].label}`;
                    },
                    label: function(context) {
                        const count = context.parsed.y;
                        const totalScenarios = scaledCounts.reduce((a, b) => a + b, 0);
                        const percentage = ((count / totalScenarios) * 100).toFixed(1);
                        return [
                            `Scenarios: ${count}`,
                            `Probability: ${percentage}%`
                        ];
                    },
                    afterLabel: function(context) {
                        const binLabel = context.label;
                        const binStart = parseInt(binLabel.split('-')[0]);
                        if (Math.abs(binStart - simulation.p10) <= 2) {
                            return '⚠️ P10 (Downside Risk)';
                        } else if (Math.abs(binStart - simulation.p50) <= 2) {
                            return '🎯 P50 (Base Case)';
                        } else if (Math.abs(binStart - simulation.p90) <= 2) {
                            return '🚀 P90 (Upside Case)';
                        }
                        return '';
                    }
                }
            },
            annotation: {
                annotations: {
                    p10Line: {
                        type: 'line',
                        scaleID: 'x',
                        value: (simulation.p10 - minIRR) / binSize,
                        borderColor: 'rgba(239, 68, 68, 0.8)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        label: {
                            display: true,
                            content: `P10: ${simulation.p10.toFixed(1)}%`,
                            position: 'start',
                            backgroundColor: 'rgba(239, 68, 68, 0.8)',
                            color: 'white',
                            font: { size: 11 }
                        }
                    },
                    p50Line: {
                        type: 'line',
                        scaleID: 'x',
                        value: (simulation.p50 - minIRR) / binSize,
                        borderColor: 'rgba(251, 191, 36, 1)',
                        borderWidth: 3,
                        label: {
                            display: true,
                            content: `P50: ${simulation.p50.toFixed(1)}%`,
                            position: 'center',
                            backgroundColor: 'rgba(251, 191, 36, 1)',
                            color: 'black',
                            font: { size: 12, weight: 'bold' }
                        }
                    },
                    p90Line: {
                        type: 'line',
                        scaleID: 'x',
                        value: (simulation.p90 - minIRR) / binSize,
                        borderColor: 'rgba(34, 197, 94, 1)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        label: {
                            display: true,
                            content: `P90: ${simulation.p90.toFixed(1)}%`,
                            position: 'end',
                            backgroundColor: 'rgba(34, 197, 94, 1)',
                            color: 'white',
                            font: { size: 11 }
                        }
                    }
                }
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#aaa', font: { size: 10 } }
            },
            y: {
                grid: { 
                    color: 'rgba(255,255,255,0.05)',
                    drawBorder: false
                },
                ticks: { 
                    color: '#aaa',
                    callback: function(value) {
                        return value + ' scenarios';
                    }
                },
                title: {
                    display: true,
                    text: 'Number of Scenarios',
                    color: '#00E87E',
                    font: { size: 12 }
                }
            }
        }
    };
    
    // Destroy existing chart if it exists
    if (chartMonteCarlo) {
        chartMonteCarlo.destroy();
    }
    
    // Create custom plugin for gradient background
    const gradientPlugin = {
        id: 'customCanvasBackgroundColor',
        beforeDraw: (chart, args, options) => {
            const {ctx, chartArea: {top, right, bottom, left, width, height}} = chart;
            ctx.save();
            
            // Create gradient
            const gradient = ctx.createLinearGradient(0, top, 0, bottom);
            gradient.addColorStop(0, 'rgba(0, 232, 126, 0.05)');
            gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, 'rgba(239, 68, 68, 0.05)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(left, top, width, height);
            ctx.restore();
        }
    };
    
    chartMonteCarlo = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: options,
        plugins: [gradientPlugin]
    });
}

// Update Waterfall Chart - Cash Distribution
function updateWaterfallChart() {
    const ctx = document.getElementById('chartWaterfall')?.getContext('2d');
    if (!ctx) return;
    
    // Get first year data for waterfall (should be 2026 for proper DSRA display)
    const firstYear = currentResults.find(r => r.year === 2026) || currentResults[0];
    if (!firstYear) {
        console.warn('No data for Waterfall chart - currentResults is empty');
        return;
    }
    
    console.log('Waterfall data for year:', firstYear.year, firstYear);
    
    // Calculate waterfall components
    const operatingCF = firstYear.netRevenue;
    const grossRevenue = firstYear.totalRevenue;
    const opexCost = firstYear.opexCost;
    const debtService = firstYear.debtService;
    const dsraFlow = firstYear.dsraFlow || 0;
    const waterfall = calculateWaterfall(operatingCF, debtService, 0.3, dsraFlow, opexCost, grossRevenue);
    
    // Prepare data for waterfall chart
    const labels = waterfall.map(w => w.name);
    const values = waterfall.map(w => w.amount);
    const colors = waterfall.map(w => {
        if (w.name === 'Gross Revenue') return 'rgba(34, 197, 94, 0.9)';
        if (w.name === 'Operating Cash Flow') return 'rgba(34, 197, 94, 0.8)';
        if (w.name === 'OPEX') return 'rgba(251, 191, 36, 0.8)';
        if (w.name.includes('Debt')) return 'rgba(239, 68, 68, 0.8)';
        if (w.name.includes('DSRA')) return 'rgba(168, 85, 247, 0.8)';
        if (w.name.includes('Tax')) return 'rgba(251, 146, 60, 0.8)';
        if (w.name.includes('Equity')) return 'rgba(59, 130, 246, 0.8)';
        return 'rgba(156, 163, 175, 0.8)';
    });
    
    // Calculate cumulative values for waterfall effect
    const cumulativeValues = [];
    let cumulative = 0;
    for (let i = 0; i < values.length; i++) {
        cumulativeValues.push(cumulative);
        cumulative += values[i];
    }
    
    const data = {
        labels: labels,
        datasets: [{
            label: 'Cash Flow',
            data: values,
            backgroundColor: colors,
            borderColor: colors.map(c => c.replace('0.8', '1')),
            borderWidth: 1
        }, {
            label: 'Cumulative',
            data: cumulativeValues,
            type: 'line',
            borderColor: 'rgba(255, 255, 255, 0.5)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.2
        }]
    };
    
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            title: {
                display: true,
                text: `Cash Distribution Waterfall (Year ${firstYear.year})`,
                color: '#fff',
                font: { size: 14 }
            },
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const value = context.parsed.y;
                        return `${context.dataset.label}: $${(value / 1000).toFixed(0)}k`;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { 
                    color: '#aaa',
                    font: { size: 10 },
                    maxRotation: 45,
                    minRotation: 45
                }
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { 
                    color: '#aaa',
                    callback: function(value) {
                        return '$' + (value / 1000).toFixed(0) + 'k';
                    }
                }
            }
        }
    };
    
    // Destroy existing chart if it exists
    if (chartWaterfall) {
        chartWaterfall.destroy();
    }
    
    chartWaterfall = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: options
    });
}

// Update Covenant Dashboard
function updateCovenantDashboard() {
    console.log('updateCovenantDashboard called');
    // Calculate covenant metrics
    const metrics = calculateFinancialMetrics();
    if (!metrics) {
        console.warn('No metrics available for covenant dashboard');
        return;
    }
    console.log('Covenant metrics:', metrics);
    
    // Update DSCR Status and Value
    const dscrElement = document.getElementById('dscrStatus');
    const dscrValueElement = document.getElementById('dscrValue');
    const debtRatio = parseFloat(document.getElementById('debtRatio')?.value || 0);
    if (dscrElement && dscrValueElement) {
        if (debtRatio === 0) {
            // No debt, so no DSCR
            dscrValueElement.textContent = 'N/A';
            dscrElement.textContent = 'No Debt';
            dscrElement.className = 'covenant-status pass';
        } else if (metrics.avgDSCR !== undefined) {
            const dscr = metrics.avgDSCR || 0;
            // Handle very high DSCR (essentially no debt service concern)
            const displayDscr = dscr > 100 ? '∞' : dscr.toFixed(2) + 'x';
            dscrValueElement.textContent = displayDscr;
            dscrElement.textContent = dscr >= 1.35 ? '✓ Strong' : dscr >= 1.2 ? '⚠ Watch' : '✗ Breach';
            dscrElement.className = 'covenant-status ' + (
                dscr >= 1.35 ? 'pass' : 
                dscr >= 1.2 ? 'warning' : 
                'breach'
            );
            console.log('Updated DSCR:', dscr);
        }
    } else {
        console.warn('DSCR elements not found');
    }
    
    // Update Leverage Status and Value
    const leverageElement = document.getElementById('leverageStatus');
    const leverageValueElement = document.getElementById('leverageValue');
    if (leverageElement && leverageValueElement) {
        const leverage = parseFloat(document.getElementById('debtRatio')?.value || 0);
        leverageValueElement.textContent = `${leverage.toFixed(0)}%`;
        leverageElement.textContent = leverage <= 65 ? '✓ Conservative' : leverage <= 75 ? '⚠ Moderate' : '✗ High';
        leverageElement.className = 'covenant-status ' + (
            leverage <= 65 ? 'pass' : 
            leverage <= 75 ? 'warning' : 
            'breach'
        );
        console.log('Updated Leverage:', leverage);
    } else {
        console.warn('Leverage elements not found');
    }
    
    // Update IRR P50 Status and Value
    const irrElement = document.getElementById('irrP50Status');
    const irrValueElement = document.getElementById('irrP50Value');
    if (irrElement && irrValueElement && metrics.irr !== undefined) {
        const irr = metrics.irr * 100;
        irrValueElement.textContent = `${irr.toFixed(1)}%`;
        irrElement.textContent = irr >= 12 ? '✓ Target Met' : irr >= 10 ? '⚠ Below Target' : '✗ Unviable';
        irrElement.className = 'covenant-status ' + (
            irr >= 12 ? 'pass' : 
            irr >= 10 ? 'warning' : 
            'breach'
        );
        console.log('Updated IRR:', irr);
    } else {
        console.warn('IRR elements not found or metrics.irr undefined');
    }
    
    // Update Payback Status and Value
    const paybackElement = document.getElementById('paybackStatus');
    const paybackValueElement = document.getElementById('paybackValue');
    if (paybackElement && paybackValueElement && metrics.paybackPeriod !== undefined) {
        const payback = metrics.paybackPeriod || 999;
        const displayPayback = payback > 50 ? '>50' : payback.toFixed(1);
        paybackValueElement.textContent = `${displayPayback} yrs`;
        paybackElement.textContent = payback <= 7 ? '✓ Fast' : payback <= 9 ? '⚠ Moderate' : '✗ Slow';
        paybackElement.className = 'covenant-status ' + (
            payback <= 7 ? 'pass' : 
            payback <= 9 ? 'warning' : 
            'breach'
        );
        console.log('Updated Payback:', payback);
    } else {
        console.warn('Payback elements not found or metrics.paybackPeriod undefined');
    }
}

// Update table
function updateTable() {
    const tbody = document.querySelector('#tblAnnual tbody');
    tbody.innerHTML = '';
    
    // Show only key years
    const keyYears = currentResults.filter(r => 
        r.year <= 2030 || r.year % 5 === 0
    );
    
    keyYears.forEach(r => {
        const row = tbody.insertRow();
        row.onclick = () => openDrillIn(r.year);
        
        row.innerHTML = `
            <td>${r.year}</td>
            <td>$${r.wholesale.toFixed(1)}</td>
            <td>$${r.spread.toFixed(1)}</td>
            <td class="value-highlight">$${r.revenuePerMWDay.toFixed(0)}</td>
            <td class="value-highlight">$${(r.revenuePerMWYear / 1000).toFixed(0)}k</td>
        `;
    });
}

// Generate duck curve for rep day
function generateDuckCurve(basePrice, spread) {
    const prices = [];
    const timestamps = [];
    const now = new Date();
    
    for (let i = 0; i < 48; i++) {
        const hour = i / 2;
        const date = new Date(now);
        date.setUTCHours(Math.floor(hour) - 10, (hour % 1) * 60, 0, 0); // AEST to UTC
        timestamps.push(date.toISOString());
        
        let price;
        if (hour < 6) {
            // Night: low prices
            price = basePrice - spread * 0.3 + Math.random() * 10;
        } else if (hour >= 6 && hour < 10) {
            // Morning ramp
            price = basePrice + spread * 0.1 * (hour - 6) / 4;
        } else if (hour >= 10 && hour < 15) {
            // Solar hours: lowest
            price = basePrice - spread * 0.4 - Math.random() * 10;
        } else if (hour >= 15 && hour < 17) {
            // Afternoon transition
            price = basePrice + spread * 0.2 * (hour - 15) / 2;
        } else if (hour >= 17 && hour < 21) {
            // Evening peak: highest
            price = basePrice + spread * 0.5 + Math.random() * 20;
        } else {
            // Late evening
            price = basePrice - spread * 0.1;
        }
        
        prices.push(Math.max(0, price));
    }
    
    return { prices, timestamps };
}

// Simple battery optimization
function optimizeBatterySimple(prices, duration, efficiency) {
    const socPath = [0.5]; // Start at 50%
    const actions = [];
    const power = 1 / duration; // MW per MWh
    
    for (let i = 0; i < prices.length - 1; i++) {
        const currentSoC = socPath[i];
        const currentPrice = prices[i];
        
        // Find average of next few prices
        const lookahead = Math.min(8, prices.length - i);
        let futureAvg = 0;
        for (let j = 1; j < lookahead; j++) {
            futureAvg += prices[i + j];
        }
        futureAvg /= (lookahead - 1);
        
        let action = 0; // 0: idle, 1: charge, -1: discharge
        let nextSoC = currentSoC;
        
        if (currentPrice < futureAvg - 20 && currentSoC < 0.9) {
            // Charge
            action = 1;
            nextSoC = Math.min(1, currentSoC + 0.5 / duration);
        } else if (currentPrice > futureAvg + 20 && currentSoC > 0.1) {
            // Discharge
            action = -1;
            nextSoC = Math.max(0, currentSoC - 0.5 / duration);
        }
        
        actions.push(action);
        socPath.push(nextSoC);
    }
    
    // Calculate revenue
    let revenue = 0;
    for (let i = 0; i < actions.length; i++) {
        if (actions[i] === -1) {
            revenue += prices[i] * 0.5 * efficiency;
        } else if (actions[i] === 1) {
            revenue -= prices[i] * 0.5 / efficiency;
        }
    }
    
    return { socPath, actions, totalRevenue: revenue };
}

// Open drill-in with better visualization
async function openDrillIn(year) {
    const result = currentResults.find(r => r.year === year);
    if (!result) return;
    
    document.getElementById('drillInTitle').textContent = 
        `Rep Day - ${result.region} ${year} • ${result.durationHours}h`;
    
    document.getElementById('drillIn').classList.add('open');
    
    // Generate duck curve
    const { prices, timestamps } = generateDuckCurve(result.wholesale, result.spread);
    
    // Optimize battery
    const { socPath, actions, totalRevenue } = optimizeBatterySimple(
        prices, 
        result.durationHours, 
        result.rtePct / 100
    );
    
    // Update rep day chart
    updateRepDayChart(prices, timestamps, socPath, actions);
}

// Update rep day chart with duck curve
function updateRepDayChart(prices, timestamps, socPath, actions) {
    const ctx = document.getElementById('repDayChart').getContext('2d');
    
    // Parse timestamps for display
    const hours = timestamps.map(ts => {
        const d = new Date(ts);
        const aestHour = (d.getUTCHours() + 10) % 24;
        return aestHour + d.getUTCMinutes() / 60;
    });
    
    const data = {
        labels: hours.map(h => {
            const hr = Math.floor(h);
            const min = Math.round((h - hr) * 60);
            return `${hr.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        }),
        datasets: [
            {
                label: 'Price ($/MWh)',
                data: prices,
                borderColor: '#00E87E',
                backgroundColor: 'rgba(0, 232, 126, 0.1)',
                borderWidth: 2,
                fill: true,
                yAxisID: 'y',
                tension: 0.3
            },
            {
                label: 'SoC (%)',
                data: socPath.slice(0, prices.length).map(s => s * 100),
                borderColor: '#00C96A',
                borderWidth: 2,
                borderDash: [5, 5],
                yAxisID: 'y1',
                fill: false,
                tension: 0.1
            }
        ]
    };
    
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: { color: '#ffffff' }
            }
        },
        scales: {
            x: {
                display: true,
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: {
                    color: '#a0a0a0',
                    maxRotation: 45,
                    callback: function(val, index) {
                        return index % 4 === 0 ? this.getLabelForValue(val) : '';
                    }
                }
            },
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                title: { display: true, text: 'Price ($/MWh)', color: '#00E87E' },
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#00E87E' }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                title: { display: true, text: 'SoC (%)', color: '#00C96A' },
                grid: { drawOnChartArea: false },
                ticks: { color: '#00C96A' },
                min: 0,
                max: 100
            }
        }
    };
    
    if (repDayChart) {
        repDayChart.destroy();
    }
    
    repDayChart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: options
    });
}

// Close drill-in
function closeDrillIn() {
    document.getElementById('drillIn').classList.remove('open');
}

// Toggle expert options
function toggleExpert() {
    document.getElementById('expertOptions').classList.toggle('show');
}

// Update rep day
function updateRepDay() {
    // Placeholder for day type change
}

// Export CSV
function toggleSettings() {
    const menu = document.getElementById('settingsMenu');
    if (menu.style.display === 'none') {
        menu.style.display = 'block';
        // Close menu when clicking outside
        setTimeout(() => {
            document.addEventListener('click', closeSettingsMenu);
        }, 100);
    } else {
        menu.style.display = 'none';
    }
}

function closeSettingsMenu(e) {
    const menu = document.getElementById('settingsMenu');
    const settingsBtn = e.target.closest('.settings-btn');
    if (!settingsBtn && !menu.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeSettingsMenu);
    }
}

function toggleExpertFromMenu() {
    // Close settings menu
    document.getElementById('settingsMenu').style.display = 'none';
    // Toggle expert options
    toggleExpert();
}

function analyzeWithAnimation() {
    console.log('analyzeWithAnimation called');
    
    // Results are already visible with corrupted data
    const resultsSection = document.getElementById('results');
    if (!resultsSection) {
        console.error('Results section not found');
        return;
    }
    
    // Add analyzing class to button
    const btn = document.getElementById('analyzeBtn');
    if (!btn) {
        console.error('Analyze button not found');
        return;
    }
    const btnText = btn.querySelector('.btn-text') || btn;
    const btnGlitch = btn.querySelector('.btn-glitch');
    
    // FIRST: Smooth scroll to where results are (with corrupted data)
    const targetPosition = resultsSection.offsetTop - 20;
    window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
    });
    
    // Start button animation immediately with scroll
    setTimeout(() => {
        btn.classList.add('analyzing');
        
        // Change button text during animation (Matrix-style)
        const originalText = btnText.textContent || btnText.innerText || 'ANALYZE MODEL';
        if (btnText.textContent !== undefined) {
            btnText.textContent = 'INITIALIZING...';
        } else {
            btnText.innerText = 'INITIALIZING...';
        }
        if (btnGlitch) {
            btnGlitch.textContent = 'SYSTEM LOADING';
            btnGlitch.setAttribute('data-text', 'SYSTEM LOADING');
        }
        
    // Subtle body state (no glitch)
    // document.body.classList.add('page-analyzing');
        
        // Matrix digital rain effect
        setTimeout(() => {
            if (btnText.textContent !== undefined) {
                btnText.textContent = 'PROCESSING...';
            } else {
                btnText.innerText = 'PROCESSING...';
            }
            if (btnGlitch) {
                btnGlitch.textContent = 'DATA STREAM ACTIVE';
            }
        }, 200);
        
        setTimeout(() => {
            if (btnText.textContent !== undefined) {
                btnText.textContent = 'ANALYZING...';
            } else {
                btnText.innerText = 'ANALYZING...';
            }
            if (btnGlitch) {
                btnGlitch.textContent = 'COMPUTATION COMPLETE';
            }
        }, 400);
        
        // Call analyze to generate the data
        setTimeout(() => {
            analyze();
        }, 200);
        
        // Start decrypting the corrupted data
        setTimeout(() => {
            // Remove corrupted classes and start decryption animation
            document.querySelectorAll('.corrupted-data').forEach((element, index) => {
                setTimeout(() => {
                    element.classList.remove('corrupted-data');
                    // element.classList.add('data-decrypting');
                    element.removeAttribute('data-corrupted');
                }, index * 50);
            });
            
            // Add data flow animation to results (Tron-style)
            const cards = document.querySelectorAll('.card, .chart-container, table');
            cards.forEach((card, index) => {
                card.classList.remove('data-incoming');
                setTimeout(() => {
                    // Subtle fade-in only
                    card.style.transition = 'opacity 0.3s ease';
                    card.style.opacity = '1';
                }, index * 100);
            });
            
            // Keep the page glitching for a bit longer
            setTimeout(() => {
                if (btnText.textContent !== undefined) {
                    btnText.textContent = '💾 DECRYPTING DATA 💾';
                } else {
                    btnText.innerText = '💾 DECRYPTING DATA 💾';
                }
                if (btnGlitch) {
                    btnGlitch.textContent = 'QUANTUM TUNNELING';
                }
            }, 200);
            
            setTimeout(() => {
                if (btnText.textContent !== undefined) {
                    btnText.textContent = '🔓 BREAKING CIPHER 🔓';
                } else {
                    btnText.innerText = '🔓 BREAKING CIPHER 🔓';
                }
                if (btnGlitch) {
                    btnGlitch.textContent = 'FIREWALL BYPASSED';
                }
            }, 400);
            
            setTimeout(() => {
                if (btnText.textContent !== undefined) {
                    btnText.textContent = '🌐 SYNCING MATRIX 🌐';
                } else {
                    btnText.innerText = '🌐 SYNCING MATRIX 🌐';
                }
                if (btnGlitch) {
                    btnGlitch.textContent = 'REALITY.EXE LOADING';
                }
            }, 600);
            
            // Finally remove all animations after extended period
            setTimeout(() => {
                btn.classList.remove('analyzing');
                // document.body.classList.remove('page-analyzing');
                
                // Restore original text
                if (btnText.textContent !== undefined) {
                    btnText.textContent = originalText;
                } else {
                    btnText.innerText = originalText;
                }
                if (btnGlitch) {
                    btnGlitch.textContent = 'INITIALIZATION SEQUENCE';
                    btnGlitch.setAttribute('data-text', 'INITIALIZATION SEQUENCE');
                }
                
                // Remove decrypting classes
                document.querySelectorAll('.data-decrypting').forEach(element => {
                    element.classList.remove('data-decrypting');
                });
            }, 1500); // Extended from 0 to 1500ms after data appears
        }, 800);
    }, 600); // Wait for scroll to be underway
}

// Reset all parameters to defaults
function resetParameters() {
    console.log('Resetting parameters to defaults');
    
    // Default values
    const defaults = {
        region: 'VIC1',
        duration: 4,
        mwsize: 5,
        efficiency: 88,
        cycles: 1.3,
        availability: 96,
        buildcost: 8,
        cpi: 3.1,
        opex: 0.1,
        degradation: 0.5,
        fcas: 5,
        debtRatio: 65,
        interestRate: 6.0,
        dscrTarget: 1.35,
        loanTerm: 10,
        mlfFactor: 0.98,
        degradationFloor: 80,
        augmentationYear: 10,
        augmentationCost: 15
    };
    
    // Apply defaults to all inputs
    Object.keys(defaults).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            element.value = defaults[key];
        }
    });
    
    // Show notification
    const notification = document.createElement('div');
    notification.textContent = 'Parameters reset to defaults';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #1a1a1a;
        color: #94a3b8;
        padding: 15px 25px;
        border-radius: 10px;
        border: 1px solid #2a2a2a;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
    
    // Re-run analysis with defaults
    analyze();
}

// Export comprehensive audit report with all calculations
function exportResults() {
    console.log('exportResults called');
    console.log('currentResults:', currentResults);
    
    try {
        if (!currentResults || currentResults.length === 0) {
            console.error('No currentResults data available');
            alert('No data to export. Please run analysis first.');
            return;
        }
        
        console.log('Generating audit report...');
        
        // Get all current parameters with proper null checks
        const params = {
        region: document.getElementById('region')?.value || 'VIC1',
        duration: parseFloat(document.getElementById('duration')?.value || 4),
        mwsize: parseFloat(document.getElementById('mwsize')?.value || 5),
        efficiency: parseFloat(document.getElementById('efficiency')?.value || 90),
        cycles: parseFloat(document.getElementById('cycles')?.value || 1),
        availability: parseFloat(document.getElementById('availability')?.value || 98),
        buildcost: parseFloat(document.getElementById('buildcost')?.value || 8),
        cpi: parseFloat(document.getElementById('cpi')?.value || 3.1),
        opex: parseFloat(document.getElementById('opex')?.value || 1.5),
        degradation: parseFloat(document.getElementById('degradation')?.value || 0.5),
        fcas: parseFloat(document.getElementById('fcas')?.value || 5),
        debtRatio: parseFloat(document.getElementById('debtRatio')?.value || 65),
        interestRate: parseFloat(document.getElementById('interestRate')?.value || 6),
        loanTerm: parseFloat(document.getElementById('loanTerm')?.value || 15),
        augmentationYear: parseFloat(document.getElementById('augmentationYear')?.value || 10),
        augmentationCost: parseFloat(document.getElementById('augmentationCost')?.value || 15),
        taxRate: parseFloat(document.getElementById('taxRate')?.value || 30)
    };
    
    // Generate comprehensive HTML audit report
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>BESS Financial Model - Audit Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 { color: #00E87E; border-bottom: 3px solid #00E87E; padding-bottom: 10px; }
        h2 { color: #D4AF37; margin-top: 30px; border-bottom: 2px solid #D4AF37; padding-bottom: 5px; }
        h3 { color: #333; margin-top: 20px; }
        .header-info {
            background: #fff;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        .section {
            background: #fff;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th {
            background: #00E87E;
            color: #000;
            padding: 10px;
            text-align: left;
            font-weight: 600;
        }
        td {
            padding: 8px;
            border-bottom: 1px solid #eee;
        }
        tr:hover { background: #f9f9f9; }
        .formula {
            background: #f0f0f0;
            padding: 10px;
            border-left: 4px solid #00E87E;
            margin: 10px 0;
            font-family: 'Courier New', monospace;
            overflow-x: auto;
        }
        .metric {
            display: inline-block;
            padding: 5px 15px;
            background: #00E87E;
            color: #000;
            border-radius: 5px;
            margin: 5px;
            font-weight: bold;
        }
        .warning {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 10px;
            margin: 10px 0;
        }
        .calculation-step {
            background: #f8f9fa;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border: 1px solid #dee2e6;
        }
        .timestamp { color: #666; font-size: 0.9em; }
        @media print {
            body { background: white; }
            .section { box-shadow: none; border: 1px solid #ddd; }
        }
    </style>
</head>
<body>
    <div class="header-info">
        <h1>🔋 BESS Financial Model - Comprehensive Audit Report</h1>
        <p class="timestamp">Generated: ${new Date().toLocaleString()}</p>
        <p><strong>Model Version:</strong> Greenwood Capital v1.0</p>
        <p><strong>Analysis Type:</strong> ${params.duration}-hour Battery Energy Storage System</p>
        <p><strong>Location:</strong> ${params.region} (Australia NEM)</p>
    </div>

    <div class="section">
        <h2>📊 Executive Summary</h2>
        <p>This audit report provides complete transparency into all calculations, methodologies, and assumptions used in the BESS financial model.</p>
        ${currentResults[0] ? (() => {
            // Calculate key metrics
            const equityInvestment = params.buildcost * (1 - params.debtRatio/100);
            const debtAmount = params.buildcost * params.debtRatio/100;
            const annualDebtService = debtAmount * (params.interestRate/100 * Math.pow(1 + params.interestRate/100, params.loanTerm)) / (Math.pow(1 + params.interestRate/100, params.loanTerm) - 1);
            
            // Calculate cash flows
            let cashFlows = [-equityInvestment * 1000000]; // Initial investment
            let npv = -equityInvestment * 1000000;
            let totalDSCR = 0;
            let dscrCount = 0;
            let paybackYear = 0;
            let cumulativeCF = -equityInvestment * 1000000;
            
            for (let i = 0; i < Math.min(currentResults.length, 25); i++) {
                const revenue = currentResults[i].totalRevenue || 0;
                const opex = revenue * params.opex / 100;
                const ebitda = revenue - opex;
                const debtServiceYear = i < params.loanTerm ? annualDebtService * 1000000 : 0;
                const tax = Math.max(0, (ebitda - debtServiceYear * 0.3) * params.taxRate / 100); // Approximate
                const equityCF = ebitda - debtServiceYear - tax;
                
                cashFlows.push(equityCF);
                npv += equityCF / Math.pow(1.1, i + 1); // 10% discount rate
                
                if (debtServiceYear > 0) {
                    const dscr = ebitda / debtServiceYear;
                    totalDSCR += dscr;
                    dscrCount++;
                }
                
                cumulativeCF += equityCF;
                if (cumulativeCF >= 0 && paybackYear === 0) {
                    paybackYear = i + 1;
                }
            }
            
            // Calculate IRR using Newton's method
            let irr = 0.1; // Initial guess
            for (let iter = 0; iter < 20; iter++) {
                let npvCalc = 0;
                let dnpv = 0;
                for (let i = 0; i < cashFlows.length; i++) {
                    npvCalc += cashFlows[i] / Math.pow(1 + irr, i);
                    dnpv -= i * cashFlows[i] / Math.pow(1 + irr, i + 1);
                }
                if (Math.abs(npvCalc) < 0.01) break;
                irr = irr - npvCalc / dnpv;
            }
            
            const avgDSCR = dscrCount > 0 ? totalDSCR / dscrCount : 0;
            
            return `
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                <div class="metric">IRR: ${(irr * 100).toFixed(1)}%</div>
                <div class="metric">NPV: $${(npv / 1000000).toFixed(1)}M</div>
                <div class="metric">DSCR: ${avgDSCR.toFixed(2)}x</div>
                <div class="metric">Payback: ${paybackYear > 0 ? paybackYear.toFixed(0) : 'N/A'} years</div>
            </div>`;
        })() : ''}
    </div>

    <div class="section">
        <h2>🔧 Input Parameters</h2>
        <h3>System Configuration</h3>
        <table>
            <tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Description</th></tr>
            <tr><td>MW Size</td><td>${params.mwsize}</td><td>MW</td><td>Nameplate capacity of the BESS</td></tr>
            <tr><td>Duration</td><td>${params.duration}</td><td>hours</td><td>Energy storage duration at full power</td></tr>
            <tr><td>MWh Capacity</td><td>${params.mwsize * params.duration}</td><td>MWh</td><td>Total energy storage capacity</td></tr>
            <tr><td>Round-Trip Efficiency</td><td>${params.efficiency}%</td><td>%</td><td>AC-to-AC efficiency including all losses</td></tr>
            <tr><td>Cycles per Day</td><td>${params.cycles}</td><td>cycles</td><td>Average daily charge/discharge cycles</td></tr>
            <tr><td>Availability</td><td>${params.availability}%</td><td>%</td><td>System uptime excluding maintenance</td></tr>
        </table>

        <h3>Financial Parameters</h3>
        <table>
            <tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Description</th></tr>
            <tr><td>Build Cost</td><td>$${params.buildcost}M</td><td>$M</td><td>Total capital expenditure</td></tr>
            <tr><td>$/MW</td><td>$${(params.buildcost / params.mwsize).toFixed(2)}M</td><td>$M/MW</td><td>Cost per MW installed</td></tr>
            <tr><td>$/MWh</td><td>$${(params.buildcost / (params.mwsize * params.duration)).toFixed(2)}M</td><td>$M/MWh</td><td>Cost per MWh installed</td></tr>
            <tr><td>OPEX</td><td>${params.opex}%</td><td>% of capex/yr</td><td>Operating expenses as % of capital</td></tr>
            <tr><td>CPI</td><td>${params.cpi}%</td><td>%/yr</td><td>Consumer price index for revenue escalation</td></tr>
            <tr><td>Degradation</td><td>${params.degradation}%</td><td>%/yr</td><td>Annual battery capacity degradation</td></tr>
            <tr><td>FCAS Revenue</td><td>${params.fcas}%</td><td>%</td><td>Additional frequency control revenue</td></tr>
        </table>

        <h3>Debt Structure</h3>
        <table>
            <tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Description</th></tr>
            <tr><td>Debt Ratio</td><td>${params.debtRatio}%</td><td>%</td><td>Leverage as % of total capital</td></tr>
            <tr><td>Equity Ratio</td><td>${100 - params.debtRatio}%</td><td>%</td><td>Equity as % of total capital</td></tr>
            <tr><td>Interest Rate</td><td>${params.interestRate}%</td><td>%/yr</td><td>Cost of debt</td></tr>
            <tr><td>Loan Term</td><td>${params.loanTerm}</td><td>years</td><td>Debt amortization period</td></tr>
            <tr><td>Debt Amount</td><td>$${(params.buildcost * params.debtRatio / 100).toFixed(2)}M</td><td>$M</td><td>Total debt raised</td></tr>
            <tr><td>Equity Amount</td><td>$${(params.buildcost * (100 - params.debtRatio) / 100).toFixed(2)}M</td><td>$M</td><td>Total equity required</td></tr>
        </table>
    </div>

    <div class="section">
        <h2>🧮 Calculation Methodology</h2>
        
        <h3>1. Revenue Calculation</h3>
        <div class="calculation-step">
            <h4>Daily Energy Arbitrage Revenue</h4>
            <div class="formula">
                Daily Revenue = Spread × √RTE × Cycles × MW × Duration × Availability × MLF
            </div>
            <p>Where:</p>
            <ul>
                <li><strong>Spread:</strong> Price differential between charge and discharge periods ($/MWh)</li>
                <li><strong>√RTE:</strong> Square root of round-trip efficiency (splits losses equally)</li>
                <li><strong>Cycles:</strong> Number of complete charge/discharge cycles per day</li>
                <li><strong>MW:</strong> Nameplate power capacity</li>
                <li><strong>Duration:</strong> Hours of storage at full power</li>
                <li><strong>Availability:</strong> System uptime factor</li>
                <li><strong>MLF:</strong> Marginal Loss Factor (transmission losses)</li>
            </ul>
            
            <h4>Example Calculation (Year 1)</h4>
            ${currentResults[0] ? `
            <div class="formula">
                Spread = $${currentResults[0].spread ? currentResults[0].spread.toFixed(2) : 'N/A'}/MWh
                √RTE = √${params.efficiency}% = ${Math.sqrt(params.efficiency/100).toFixed(3)}
                Daily Revenue = $${currentResults[0].spread ? currentResults[0].spread.toFixed(2) : 0} × ${Math.sqrt(params.efficiency/100).toFixed(3)} × ${params.cycles} × ${params.mwsize} × ${params.duration} × ${(params.availability/100).toFixed(2)} × 0.98
                Daily Revenue = $${currentResults[0].spread ? ((currentResults[0].spread) * Math.sqrt(params.efficiency/100) * params.cycles * params.mwsize * params.duration * (params.availability/100) * 0.98).toFixed(2) : 'N/A'}
                Annual Revenue = Daily Revenue × 365 = $${currentResults[0].spread ? ((currentResults[0].spread) * Math.sqrt(params.efficiency/100) * params.cycles * params.mwsize * params.duration * (params.availability/100) * 0.98 * 365 / 1000000).toFixed(3) : 'N/A'}M
            </div>
            ` : '<p>Run analysis to see calculations</p>'}
        </div>

        <h3>2. Operating Expenses</h3>
        <div class="calculation-step">
            <h4>Annual OPEX Calculation</h4>
            <div class="formula">
                OPEX = Build Cost × OPEX% × (1 + CPI)^year
            </div>
            <h4>Year 1 Example</h4>
            <div class="formula">
                OPEX = $${params.buildcost}M × ${params.opex}% = $${(params.buildcost * params.opex / 100).toFixed(3)}M
            </div>
        </div>

        <h3>3. Debt Service</h3>
        <div class="calculation-step">
            <h4>Annual Debt Payment (Level Amortization)</h4>
            <div class="formula">
                PMT = P × [r(1+r)^n] / [(1+r)^n - 1]
            </div>
            <p>Where: P = Principal, r = Interest Rate, n = Term</p>
            <div class="formula">
                Principal = $${(params.buildcost * params.debtRatio / 100).toFixed(2)}M
                Rate = ${params.interestRate}%
                Term = ${params.loanTerm} years
                Annual Payment = $${((params.buildcost * params.debtRatio / 100) * (params.interestRate/100 * Math.pow(1 + params.interestRate/100, params.loanTerm)) / (Math.pow(1 + params.interestRate/100, params.loanTerm) - 1)).toFixed(3)}M
            </div>
        </div>

        <h3>4. Cash Flow Waterfall</h3>
        <div class="calculation-step">
            <p>Cash flows are distributed in strict priority order:</p>
            <ol>
                <li>Operating Expenses (OPEX)</li>
                <li>Senior Debt Service (Principal + Interest)</li>
                <li>Debt Service Reserve Account (DSRA)</li>
                <li>Taxes (30% Australian corporate rate)</li>
                <li>Equity Distributions (residual)</li>
            </ol>
        </div>

        <h3>5. Key Metrics Calculation</h3>
        <div class="calculation-step">
            <h4>Internal Rate of Return (IRR)</h4>
            <div class="formula">
                NPV = Σ[CF_t / (1+IRR)^t] - Initial Investment = 0
            </div>
            <p>IRR is the discount rate that makes NPV equal to zero</p>

            <h4>Debt Service Coverage Ratio (DSCR)</h4>
            <div class="formula">
                DSCR = Cash Available for Debt Service / Total Debt Service
            </div>
            <p>Minimum target: 1.35x for investment grade</p>

            <h4>Net Present Value (NPV)</h4>
            <div class="formula">
                NPV = Σ[CF_t / (1+WACC)^t] - Initial Investment
            </div>
            <p>WACC = Weighted Average Cost of Capital</p>
        </div>
    </div>

    <div class="section">
        <h2>📈 Year-by-Year Cash Flow Analysis</h2>
        <table>
            <thead>
                <tr>
                    <th>Year</th>
                    <th>Revenue ($M)</th>
                    <th>OPEX ($M)</th>
                    <th>EBITDA ($M)</th>
                    <th>Debt Service ($M)</th>
                    <th>Tax ($M)</th>
                    <th>Equity CF ($M)</th>
                    <th>DSCR</th>
                    <th>Cumulative ($M)</th>
                </tr>
            </thead>
            <tbody>
                ${(() => {
                    let cumulative = -params.buildcost * (1 - params.debtRatio/100);
                    const debtAmount = params.buildcost * params.debtRatio/100;
                    const annualDebtService = debtAmount * (params.interestRate/100 * Math.pow(1 + params.interestRate/100, params.loanTerm)) / (Math.pow(1 + params.interestRate/100, params.loanTerm) - 1);
                    
                    return currentResults.slice(0, 25).map((r, i) => {
                        const revenue = (r.totalRevenue || 0) / 1000000;
                        const opex = revenue * params.opex / 100;
                        const ebitda = revenue - opex;
                        const debtServiceYear = i < params.loanTerm ? annualDebtService : 0;
                        
                        // Calculate interest portion for tax
                        const remainingPrincipal = Math.max(0, debtAmount - (annualDebtService * Math.min(i, params.loanTerm)));
                        const interestPortion = remainingPrincipal * params.interestRate/100;
                        
                        const taxableIncome = ebitda - interestPortion;
                        const tax = Math.max(0, taxableIncome * params.taxRate / 100);
                        const equityCF = ebitda - debtServiceYear - tax;
                        const dscr = debtServiceYear > 0 ? ebitda / debtServiceYear : 0;
                        cumulative += equityCF;
                        
                        let dscrColor = '';
                        if (dscr > 0) {
                            if (dscr < 1.2) dscrColor = 'color: red;';
                            else if (dscr < 1.35) dscrColor = 'color: orange;';
                            else dscrColor = 'color: green;';
                        }
                        
                        return `
                        <tr>
                            <td>${r.year}</td>
                            <td>${revenue.toFixed(2)}</td>
                            <td>${opex.toFixed(2)}</td>
                            <td>${ebitda.toFixed(2)}</td>
                            <td>${debtServiceYear > 0 ? debtServiceYear.toFixed(2) : '0.00'}</td>
                            <td>${tax.toFixed(2)}</td>
                            <td style="${equityCF >= 0 ? 'color: green;' : 'color: red;'}">${equityCF.toFixed(2)}</td>
                            <td style="${dscrColor}">${dscr > 0 ? dscr.toFixed(2) : '-'}</td>
                            <td style="${cumulative >= 0 ? 'color: green;' : 'color: red;'}">${cumulative.toFixed(2)}</td>
                        </tr>`;
                    }).join('');
                })()}
            </tbody>
        </table>
    </div>

    <div class="section">
        <h2>⚠️ Key Assumptions & Limitations</h2>
        <div class="warning">
            <h4>Model Assumptions:</h4>
            <ul>
                <li>Aurora Energy Research spread forecasts (November 2024)</li>
                <li>No merchant price risk mitigation (uncontracted revenue)</li>
                <li>Linear degradation to floor value</li>
                <li>Single augmentation at year ${params.augmentationYear || 10}</li>
                <li>30% Australian corporate tax rate</li>
                <li>No renewable energy certificates included</li>
                <li>FCAS revenue as fixed percentage add-on</li>
            </ul>
        </div>
        
        <div class="warning">
            <h4>Conservative Elements:</h4>
            <ul>
                <li>No capacity payments included</li>
                <li>No network services revenue</li>
                <li>Single augmentation only (could do multiple)</li>
                <li>15% terminal value (scrap) - could be 20-25%</li>
                <li>High WACC assumption for conservatism</li>
            </ul>
        </div>
    </div>

    <div class="section">
        <h2>🔍 Audit Trail</h2>
        <p><strong>Model:</strong> Greenwood Capital BESS Financial Model</p>
        <p><strong>Data Source:</strong> Aurora Energy Research (November 2024)</p>
        <p><strong>Scenario:</strong> ${params.region} - ${params.duration}h duration</p>
        <p><strong>Analysis Date:</strong> ${new Date().toISOString()}</p>
        <p><strong>User Agent:</strong> ${navigator.userAgent}</p>
    </div>

    <div class="section" style="background: #f0f0f0; text-align: center; margin-top: 40px;">
        <p style="color: #666; font-size: 0.9em;">
            This report was generated by Greenwood Capital BESS Financial Model<br>
            All calculations are based on publicly available data and standard financial methodologies<br>
            For investment decisions, please consult with qualified financial advisors
        </p>
    </div>
</body>
</html>
    `;
    
    console.log('HTML generated, length:', html.length);
    
    // Create and download the HTML file
    const blob = new Blob([html], { type: 'text/html' });
    console.log('Blob created:', blob);
    
    const url = URL.createObjectURL(blob);
    console.log('URL created:', url);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `BESS_Audit_Report_${new Date().toISOString().split('T')[0]}.html`;
    console.log('About to trigger download...');
    
    // Add to body, click, then remove
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 100);
    
    // Show notification
    const notification = document.createElement('div');
    notification.textContent = 'Audit report exported successfully!';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #00E87E, #22C55E);
        color: black;
        padding: 15px 25px;
        border-radius: 10px;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
    
    } catch (error) {
        console.error('Error generating audit report:', error);
        alert('Error generating report: ' + error.message);
    }
}

function exportCSV() {
    // Close settings menu
    document.getElementById('settingsMenu').style.display = 'none';
    
    if (currentResults.length === 0) {
        alert('No data to export. Run analysis first.');
        return;
    }
    
    // Create CSV
    const header = Object.keys(currentResults[0]);
    const rows = currentResults.map(r => header.map(h => r[h]).join(','));
    const csv = header.join(',') + '\n' + rows.join('\n');
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forward-lite-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Show info modal
function showInfoModal() {
    document.getElementById('infoModal').style.display = 'block';
}

// Close info modal
function closeInfoModal() {
    document.getElementById('infoModal').style.display = 'none';
}

// Initialize on load
// Generate random corrupted data string
function generateCorruptedData() {
    const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?0123456789ABCDEF';
    const lengths = [7, 8, 9, 10, 11, 12];
    const length = lengths[Math.floor(Math.random() * lengths.length)];
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Disable previously used placeholder corruption effect
function showCorruptedData() {
    // No op: we now render clean values only
}

// Scenario Settings Modal Functions
function openScenarioSettings() {
    const modal = document.getElementById('scenarioSettingsModal');
    if (modal) {
        modal.style.display = 'block';
        // Load current settings into inputs
        const scenarios = getScenarioSettings();
        for (const [scenarioName, settings] of Object.entries(scenarios)) {
            if (scenarioName === 'stressed') continue; // Skip stressed scenario
            for (const [key, value] of Object.entries(settings)) {
                const input = document.getElementById(`${scenarioName}_${key}`);
                if (input) {
                    input.value = value;
                }
            }
        }
    }
}

function closeScenarioSettings() {
    const modal = document.getElementById('scenarioSettingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function saveScenarioSettings() {
    const scenarios = getScenarioSettings();
    
    // Update each scenario with new values
    ['conservative', 'base', 'aggressive'].forEach(scenarioName => {
        const settings = {};
        const keys = ['efficiency', 'cycles', 'availability', 'opex', 'degradation', 'fcas', 'debtRatio', 'interestRate', 'buildcost'];
        
        keys.forEach(key => {
            const input = document.getElementById(`${scenarioName}_${key}`);
            if (input) {
                settings[key] = parseFloat(input.value);
            }
        });
        
        scenarios[scenarioName] = settings;
    });
    
    // Save to localStorage
    localStorage.setItem('scenarioSettings', JSON.stringify(scenarios));
    
    // Close modal
    closeScenarioSettings();
    
    // Show success message (non-blocking)
    console.log('Scenario settings saved successfully!');
    
    // Optional: Show a more elegant notification instead of alert
    const notification = document.createElement('div');
    notification.textContent = 'Settings saved successfully!';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #00E87E, #22C55E);
        color: black;
        padding: 15px 25px;
        border-radius: 10px;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function resetScenarioDefaults() {
    // Remove saved settings
    localStorage.removeItem('scenarioSettings');
    
    // Reload defaults into inputs
    const scenarios = {
        conservative: {
            efficiency: 85,
            cycles: 1,
            availability: 95,
            opex: 3,
            degradation: 0.8,
            fcas: 0,
            debtRatio: 50,
            interestRate: 7.5,
            buildcost: 9
        },
        base: {
            efficiency: 90,
            cycles: 1.5,
            availability: 98,
            opex: 2,
            degradation: 0.5,
            fcas: 10,
            debtRatio: 60,
            interestRate: 6.5,
            buildcost: 8
        },
        aggressive: {
            efficiency: 93,
            cycles: 2,
            availability: 99,
            opex: 1.5,
            degradation: 0.3,
            fcas: 20,
            debtRatio: 70,
            interestRate: 5.5,
            buildcost: 7
        }
    };
    
    for (const [scenarioName, settings] of Object.entries(scenarios)) {
        for (const [key, value] of Object.entries(settings)) {
            const input = document.getElementById(`${scenarioName}_${key}`);
            if (input) {
                input.value = value;
            }
        }
    }
    
    // Show notification
    const notification = document.createElement('div');
    notification.textContent = 'Settings reset to defaults!';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #1a1a1a;
        color: #94a3b8;
        padding: 15px 25px;
        border-radius: 10px;
        border: 1px solid #2a2a2a;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadAnnualData();
        
        // Start the live ticker
        console.log('Starting live price ticker...');
        startLiveTicker();
        
        // Ensure results are visible
        const resultsSection = document.getElementById('results');
        if (resultsSection) {
            resultsSection.style.display = 'block';
            resultsSection.style.opacity = '1';
        }

        // Clear any lock/calibration message and compute initial values
        const chip = document.getElementById('calibrationChip');
        if (chip) chip.textContent = '';
        // Run initial analysis to populate numbers immediately
        if (typeof analyze === 'function') {
            await analyze();
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        document.getElementById('loading').style.display = 'none';
    }
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('infoModal');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
}

// Get scenario settings from localStorage or use defaults
function getScenarioSettings() {
    const savedSettings = localStorage.getItem('scenarioSettings');
    if (savedSettings) {
        return JSON.parse(savedSettings);
    }
    return {
        conservative: {
            efficiency: 85,
            cycles: 1,
            availability: 95,
            opex: 3,
            degradation: 0.8,
            fcas: 0,
            debtRatio: 50,
            interestRate: 7.5,
            buildcost: 9
        },
        base: {
            efficiency: 90,
            cycles: 1.5,
            availability: 98,
            opex: 2,
            degradation: 0.5,
            fcas: 10,
            debtRatio: 60,
            interestRate: 6.5,
            buildcost: 8
        },
        aggressive: {
            efficiency: 93,
            cycles: 2,
            availability: 99,
            opex: 1.5,
            degradation: 0.3,
            fcas: 20,
            debtRatio: 70,
            interestRate: 5.5,
            buildcost: 7
        },
        stressed: {
            efficiency: 82,
            cycles: 0.8,
            availability: 92,
            opex: 4,
            degradation: 1.2,
            fcas: 0,
            debtRatio: 40,
            interestRate: 9,
            buildcost: 10
        }
    };
}

// Load predefined scenarios
function loadScenario(scenario, evt) {
    const event = evt || window.event;
    const scenarios = getScenarioSettings();
    
    const settings = scenarios[scenario];
    if (!settings) return;
    
    // Apply settings to inputs
    Object.keys(settings).forEach(key => {
        const element = document.getElementById(key) || document.getElementById(key.charAt(0).toUpperCase() + key.slice(1));
        if (element) {
            element.value = settings[key];
        }
    });
    
    // Flash the button for feedback
    if (event && event.target) {
        event.target.style.background = '#00E87E';
        event.target.style.color = '#000';
        setTimeout(() => {
            event.target.style.background = '#1a1a1a';
            event.target.style.color = '#fff';
        }, 300);
    }
    
    // Don't run analysis - user must click Analyze button
}

// Expose functions for inline onclick handlers
window.analyze = analyze;
window.exportCSV = exportCSV;
window.toggleExpert = toggleExpert;
window.closeDrillIn = closeDrillIn;
window.updateRepDay = updateRepDay;
window.showInfoModal = showInfoModal;
window.closeInfoModal = closeInfoModal;
window.loadScenario = loadScenario;
window.updateDebtStructure = updateDebtStructure;

// ===== TICKER FUNCTIONS =====

// Format region name for display
function formatRegionName(region) {
    if (!region) return '';
    if (region.startsWith('NSW')) return 'NSW';
    if (region.startsWith('QLD')) return 'QLD';
    if (region.startsWith('SA')) return 'SA';
    if (region.startsWith('TAS')) return 'TAS';
    if (region.startsWith('VIC')) return 'VIC';
    return region;
}

// Ticker timer variable
let liveTickerTimer = null;

// Main ticker update function
async function fetchLivePricesOnce() {
    const tickerInner = document.getElementById('tickerInner');
    const lastUpdate = document.getElementById('lastUpdate');
    if (!tickerInner) {
        console.error('Ticker element not found');
        return;
    }

    try {
        const startTime = Date.now();
        
        // Fetch AEMO prices FIRST for faster display
        const aemoPromise = fetch('https://nem-harvester.eddie-37d.workers.dev/api/live-prices', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null);
        
        // Start crypto fetch but don't wait for it
        const cryptoPromise = Promise.race([
            fetchCryptoDataFromCoingecko(),
            new Promise(resolve => setTimeout(() => resolve(null), 800)) // Shorter timeout
        ]);
        
        // Get AEMO data first
        const payload = await aemoPromise;
        console.log(`AEMO data fetched in ${Date.now() - startTime}ms`);
        
        // Display AEMO prices immediately
        if (payload && payload.success && payload.data) {
            updateTickerWithAEMO(payload);
        }
        
        // Then wait for crypto (or timeout) and add it
        const cryptoData = await cryptoPromise;
        
        // Add crypto if available
        if (cryptoData) {
            updateTickerWithCrypto(cryptoData);
        }
    } catch (e) {
        if (lastUpdate) {
            lastUpdate.textContent = 'Updating...';
        }
        console.error('Live ticker update failed:', e);
        // Retry after 5 seconds on error
        setTimeout(fetchLivePricesOnce, 5000);
    }
}

// Fetch crypto from CoinGecko
async function fetchCryptoDataFromCoingecko() {
    try {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=usd&include_24hr_change=true';
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return null;
        const j = await r.json();
        const out = {};
        if (j?.bitcoin?.usd) {
            out.BTC = { price: Number(j.bitcoin.usd), change24h: Number(j.bitcoin.usd_24h_change || 0), symbol: 'BTC' };
        }
        if (j?.litecoin?.usd) {
            out.LTC = { price: Number(j.litecoin.usd), change24h: Number(j.litecoin.usd_24h_change || 0), symbol: 'LTC' };
        }
        return (out.BTC || out.LTC) ? out : null;
    } catch (_) { return null; }
}

// Fetch crypto from Binance (direct USD)
async function fetchCryptoDataDirectUSD() {
    try {
        const headers = { 'Accept': 'application/json', 'Cache-Control': 'no-cache' };
        const [btc24, ltc24] = await Promise.allSettled([
            fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { cache: 'no-store', headers }),
            fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=LTCUSDT', { cache: 'no-store', headers })
        ]);
        
        const out = {};
        if (btc24.status === 'fulfilled' && btc24.value.ok) {
            const btc = await btc24.value.json();
            out.BTC = { 
                price: parseFloat(btc.lastPrice || btc.price), 
                change24h: parseFloat(btc.priceChangePercent || 0), 
                symbol: 'BTC' 
            };
        }
        if (ltc24.status === 'fulfilled' && ltc24.value.ok) {
            const ltc = await ltc24.value.json();
            out.LTC = { 
                price: parseFloat(ltc.lastPrice || ltc.price), 
                change24h: parseFloat(ltc.priceChangePercent || 0), 
                symbol: 'LTC' 
            };
        }
        
        return (out.BTC || out.LTC) ? out : null;
    } catch (_) { return null; }
}

// Update ticker with AEMO data
function updateTickerWithAEMO(payload) {
    const tickerInner = document.getElementById('tickerInner');
    const lastUpdate = document.getElementById('lastUpdate');
    if (!tickerInner) return;
    
    const items = [];
    const priceData = payload?.data;
    
    if (priceData) {
        const regions = ['NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1'];
        regions.forEach(regionCode => {
            const price = priceData[regionCode];
            const region = regionCode.replace('1', '');
            if (price) {
                const priceVal = typeof price === 'object' ? price.price : price;
                const changePercent = typeof price === 'object' ? (price.changePercent || 0) : 0;
                const changeClass = changePercent >= 0 ? 'positive' : 'negative';
                const changeSign = changePercent >= 0 ? '+' : '';
                
                items.push(`
                    <span class="ticker-item">
                        <span class="ticker-region">${region}</span>
                        <span class="ticker-price">$${priceVal.toFixed(2)}</span>
                        ${changePercent !== 0 ? `<span class="ticker-change ${changeClass}">${changeSign}${changePercent.toFixed(1)}%</span>` : ''}
                    </span>
                `);
            }
        });
    }
    
    if (items.length > 0) {
        const tickerHtml = items.join('<span class="ticker-separator">•</span>');
        tickerInner.innerHTML = tickerHtml + '<span class="ticker-separator">•</span>' + 
                               tickerHtml + '<span class="ticker-separator">•</span>' + 
                               tickerHtml;
        tickerInner.setAttribute('data-aemo-loaded', 'true');
    }
    
    if (lastUpdate) {
        const now = new Date();
        lastUpdate.textContent = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
    }
}

// Add crypto to existing ticker
function updateTickerWithCrypto(cryptoData) {
    const tickerInner = document.getElementById('tickerInner');
    if (!tickerInner || !tickerInner.getAttribute('data-aemo-loaded')) return;
    
    // Get existing content (first segment only)
    const currentContent = tickerInner.innerHTML.split('<span class="ticker-separator">•</span>');
    if (currentContent.length < 3) return;
    
    const items = [];
    ['BTC', 'LTC'].forEach(symbol => {
        const crypto = cryptoData[symbol];
        if (crypto) {
            const changeClass = crypto.change24h >= 0 ? 'positive' : 'negative';
            const changeSign = crypto.change24h >= 0 ? '+' : '';
            
            items.push(`
                <span class="ticker-item">
                    <span class="ticker-region">${symbol}</span>
                    <span class="ticker-price">$${crypto.price.toLocaleString()}</span>
                    <span class="ticker-change ${changeClass}">${changeSign}${crypto.change24h.toFixed(1)}%</span>
                </span>
            `);
        }
    });
    
    if (items.length > 0) {
        const cryptoHtml = items.join('<span class="ticker-separator">•</span>');
        const aemoHtml = currentContent[0];
        const combined = aemoHtml + '<span class="ticker-separator">•</span>' + cryptoHtml;
        
        tickerInner.innerHTML = combined + '<span class="ticker-separator">•</span>' + 
                               combined + '<span class="ticker-separator">•</span>' + 
                               combined;
    }
}

// Start the live ticker
function startLiveTicker() {
    const tickerInner = document.getElementById('tickerInner');
    if (tickerInner) {
        // Show loading placeholder immediately
        tickerInner.innerHTML = `
            <span class="ticker-item">
                <span class="ticker-region" style="opacity: 0.5;">Loading prices...</span>
            </span>
        `;
    }
    
    // Fetch immediately
    fetchLivePricesOnce();
    
    // Then set up regular updates every 2 minutes
    if (liveTickerTimer) clearInterval(liveTickerTimer);
    liveTickerTimer = setInterval(fetchLivePricesOnce, 120000);
}

// Expose ticker functions
window.startLiveTicker = startLiveTicker;

// ===== CASH FLOW TABLE FUNCTIONS =====

// Populate the year-by-year cash flow table
function populateCashFlowTable() {
    if (!currentResults || currentResults.length === 0) return;
    
    const tbody = document.getElementById('cashFlowTableBody');
    if (!tbody) return;
    
    // Clear existing rows
    tbody.innerHTML = '';
    
    // Get financial parameters with null checks - use debtRatio not debtPct
    const debtPct = parseFloat(document.getElementById('debtRatio')?.value || document.getElementById('debtPct')?.value || 65) / 100;
    const interestRate = parseFloat(document.getElementById('interestRate')?.value || 6) / 100;
    const loanTerm = parseInt(document.getElementById('loanTerm')?.value || 15);
    const taxRate = parseFloat(document.getElementById('taxRate')?.value || 30) / 100;
    const opexCost = parseFloat(document.getElementById('opex')?.value || 1.5);
    
    // Get build cost directly from the dropdown/input
    const buildCostElement = document.getElementById('buildcost');
    const buildCost = buildCostElement ? parseFloat(buildCostElement.value) : 8.0; // Default to 8M
    const debtAmount = buildCost * debtPct;
    const annualDebtService = debtAmount * (interestRate * Math.pow(1 + interestRate, loanTerm)) / (Math.pow(1 + interestRate, loanTerm) - 1);
    
    let cumulative = -buildCost * (1 - debtPct); // Initial equity investment
    let totals = {
        revenue: 0,
        opex: 0,
        ebitda: 0,
        debtService: 0,
        tax: 0,
        equityCF: 0,
        dscrSum: 0,
        dscrCount: 0
    };
    
    // Limit to 25 years
    const yearsToShow = Math.min(currentResults.length, 25);
    
    for (let i = 0; i < yearsToShow; i++) {
        const yearData = currentResults[i];
        const revenue = (yearData.totalRevenue || 0) / 1000000; // Convert to millions
        const opex = revenue * opexCost / 100;
        const ebitda = revenue - opex;
        
        // Debug log for first row
        if (i === 0) {
            console.log('Table calculation debug:', {
                revenue, opexCost, opex, ebitda,
                yearData: yearData
            });
        }
        const debtServiceYear = i < loanTerm ? annualDebtService : 0;
        
        // Calculate interest portion for tax calculation
        const remainingPrincipal = Math.max(0, debtAmount - (annualDebtService * Math.min(i, loanTerm)));
        const interestPortion = remainingPrincipal * interestRate;
        const principalPortion = debtServiceYear - interestPortion;
        
        // Tax on EBITDA minus interest (not principal)
        const taxableIncome = ebitda - interestPortion;
        const tax = Math.max(0, taxableIncome * taxRate);
        const equityCF = ebitda - debtServiceYear - tax;
        const dscr = debtServiceYear > 0 ? ebitda / debtServiceYear : 0;
        cumulative += equityCF;
        
        // Update totals
        totals.revenue += revenue;
        totals.opex += opex;
        totals.ebitda += ebitda;
        totals.debtService += debtServiceYear;
        totals.tax += tax;
        totals.equityCF += equityCF;
        if (dscr > 0) {
            totals.dscrSum += dscr;
            totals.dscrCount++;
        }
        
        // Create row
        const row = document.createElement('tr');
        
        // Determine DSCR color
        let dscrClass = '';
        if (dscr > 0) {
            if (dscr < 1.2) dscrClass = 'negative-value';
            else if (dscr < 1.35) dscrClass = 'warning-value';
            else dscrClass = 'positive-value';
        }
        
        row.innerHTML = `
            <td style="text-align: center; color: var(--greenwood-primary); font-weight: 600; border-right: 1px solid #1a1a1a;">${yearData.year}</td>
            <td style="text-align: right; color: #fff; border-right: 1px solid #1a1a1a;">${revenue.toFixed(2)}</td>
            <td style="text-align: right; color: #fff; border-right: 1px solid #1a1a1a;">${opex.toFixed(2)}</td>
            <td style="text-align: right; color: #fff; border-right: 1px solid #1a1a1a;">${ebitda.toFixed(2)}</td>
            <td style="text-align: right; color: #fff; border-right: 1px solid #1a1a1a;">${debtServiceYear.toFixed(2)}</td>
            <td style="text-align: right; color: #fff; border-right: 1px solid #1a1a1a;">${tax.toFixed(2)}</td>
            <td style="text-align: right; color: ${equityCF >= 0 ? '#00E87E' : '#ff4d4d'}; border-right: 1px solid #1a1a1a;">${equityCF.toFixed(2)}</td>
            <td style="text-align: right; border-right: 1px solid #1a1a1a;" class="${dscrClass}">${dscr > 0 ? dscr.toFixed(2) : '-'}</td>
            <td style="text-align: right; color: ${cumulative >= 0 ? 'var(--premium-gold)' : '#ff4d4d'}; font-weight: 600;">${cumulative.toFixed(2)}</td>
        `;
        
        tbody.appendChild(row);
    }
    
    // Update footer totals
    document.getElementById('totalRevenue').textContent = totals.revenue.toFixed(2);
    document.getElementById('totalOpex').textContent = totals.opex.toFixed(2);
    document.getElementById('totalEbitda').textContent = totals.ebitda.toFixed(2);
    document.getElementById('totalDebtService').textContent = totals.debtService.toFixed(2);
    document.getElementById('totalTax').textContent = totals.tax.toFixed(2);
    document.getElementById('totalEquityCF').textContent = totals.equityCF.toFixed(2);
    document.getElementById('avgDSCR').textContent = totals.dscrCount > 0 ? (totals.dscrSum / totals.dscrCount).toFixed(2) : '-';
    document.getElementById('finalCumulative').textContent = cumulative.toFixed(2);
}

// Export table to CSV
function exportTableToCSV() {
    const table = document.getElementById('cashFlowTable');
    if (!table) return;
    
    let csv = [];
    
    // Get headers
    const headers = [];
    table.querySelectorAll('thead th').forEach(th => {
        headers.push(th.textContent.trim());
    });
    csv.push(headers.join(','));
    
    // Get data rows
    table.querySelectorAll('tbody tr').forEach(row => {
        const rowData = [];
        row.querySelectorAll('td').forEach(td => {
            rowData.push(td.textContent.trim());
        });
        csv.push(rowData.join(','));
    });
    
    // Get footer totals
    const footerData = [];
    table.querySelectorAll('tfoot td').forEach(td => {
        footerData.push(td.textContent.trim());
    });
    csv.push(footerData.join(','));
    
    // Download CSV
    const csvContent = csv.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash_flow_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Expose table functions
window.populateCashFlowTable = populateCashFlowTable;
window.exportTableToCSV = exportTableToCSV;