// BESS Trading Simulator - Realistic NEM Trading Engine
// 5MW/20MWh Virtual Battery with live NEM data integration

// API configuration
const API_ENDPOINT = 'https://aemo-unified-source.eddie-37d.workers.dev';

// Global state
let state = window.state = {
    user: null,
    mode: 'scheduled', // 'scheduled' or 'non-scheduled' - IRP classification
    bess: {
        powerMW: 5,        // 5MW power rating (inverter limit)
        capacityMWh: 20,   // 20MWh capacity (4-hour battery)
        cRating: 0.5,      // 0.5C rating (max discharge in 2 hours)
        soc: 50,           // State of charge (%)
        efficiency: 0.90,  // 90% round-trip efficiency
        cyclesDaily: 0,    // Daily cycle count
        maxCycles: 2       // Max 2 cycles per day
    },
    strategy: {
        chargeBids: [],    // 10-band for charge (consumption)
        dischargeBids: [], // 10-band for discharge (generation)
        fcas: {
            raiseReg: { enabled: false, capacity: 0, price: 0 },
            lowerReg: { enabled: false, capacity: 0, price: 0 },
            raise6sec: { enabled: false, capacity: 0, price: 0 },
            raise60sec: { enabled: false, capacity: 0, price: 0 },
            raise5min: { enabled: false, capacity: 0, price: 0 }
        },
        customRules: null,
        // Non-scheduled mode simple strategy
        nonScheduled: {
            chargeStartTime: '00:00',
            chargeEndTime: '06:00',
            maxChargePrice: 50,
            dischargeStartTime: '17:00',
            dischargeEndTime: '21:00',
            minDischargePrice: 200
        }
    },
    simulation: {
        weekRevenue: 0,
        dailyRevenue: 0,
        fcasRevenue: 0,
        costs: 0,
        lastUpdate: null,
        history: []
    },
    market: {
        currentPrice: 0,
        forecast: [],
        fcasPrices: {},
        region: 'VIC1',
        lastDataUpdate: null
    },
    leaderboard: []
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeBidstacks();
    setupEventListeners();
    checkExistingSession();
});

// Authentication
window.login = function login() {
    const username = document.getElementById('username').value.trim();
    if (!username) {
        alert('Please enter a team name');
        return;
    }
    
    state.user = username;
    localStorage.setItem('bessTrader', username);
    
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('tradingInterface').style.display = 'block';
    
    startTradingSession();
}

function checkExistingSession() {
    const savedUser = localStorage.getItem('bessTrader');
    if (savedUser) {
        state.user = savedUser;
        document.getElementById('username').value = savedUser;
        login();
    }
}

// Initialize bidstacks with NEM-style 10 bands each for charge/discharge
function initializeBidstacks() {
    const chargeTbody = document.getElementById('chargeBidstackBody');
    const dischargeTbody = document.getElementById('dischargeBidstackBody');
    
    // Default for charge (consumption): ascending prices, low to high
    // Lower thresholds to be more aggressive with charging at low prices
    const chargePrices = [-1000, -500, -100, -50, 0, 30, 50, 70, 90, 100];
    const chargeMW = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const chargeHelp = [
        'Market floor - Always charge',
        'Very negative - Strong charge signal',
        'Negative price - Free energy',
        'Low negative - Mild oversupply',
        'Zero price - Balanced market',
        'Low positive - Normal overnight',
        'Moderate - Typical morning',
        'Higher - Afternoon prices',
        'Peak shoulder - Early evening',
        'Near peak - Late afternoon'
    ];
    
    // Default for discharge (generation): ascending prices
    // Lower initial threshold to capture more revenue opportunities
    const dischargePrices = [150, 200, 250, 300, 400, 500, 750, 1000, 2000, 5000];
    const dischargeMW = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const dischargeHelp = [
        'Minimum profit - Cover costs',
        'Low profit - Normal evening',
        'Good profit - Peak demand',
        'Strong profit - High demand',
        'Very high - Stress event',
        'Extreme - Supply shortage',
        'Critical - Major constraint',
        'Emergency - System stress',
        'Near cap - Extreme shortage',
        'Market cap - Maximum price'
    ];
    
    // Initialize state with default bidstack values
    state.strategy.chargeBids = [];
    state.strategy.dischargeBids = [];
    
    for (let i = 0; i < 10; i++) {
        const chargeRow = chargeTbody.insertRow();
        chargeRow.innerHTML = `
            <td title="${chargeHelp[i]}">Band ${i + 1} ⓘ</td>
            <td><input type="number" id="charge_mw_${i}" value="${chargeMW[i]}" min="0" max="5" step="0.1"></td>
            <td><input type="number" id="charge_price_${i}" value="${chargePrices[i]}" min="-1000" max="15000" title="${chargeHelp[i]}"></td>
        `;
        
        const dischargeRow = dischargeTbody.insertRow();
        dischargeRow.innerHTML = `
            <td title="${dischargeHelp[i]}">Band ${i + 1} ⓘ</td>
            <td><input type="number" id="discharge_mw_${i}" value="${dischargeMW[i]}" min="0" max="5" step="0.1"></td>
            <td><input type="number" id="discharge_price_${i}" value="${dischargePrices[i]}" min="-1000" max="15000" title="${dischargeHelp[i]}"></td>
        `;
        
        // Add to state arrays
        state.strategy.chargeBids.push({
            mw: chargeMW[i],
            price: chargePrices[i]
        });
        state.strategy.dischargeBids.push({
            mw: dischargeMW[i],
            price: dischargePrices[i]
        });
    }
}

// Setup event listeners
function setupEventListeners() {
    // FCAS capacity sliders
    ['raiseReg', 'lowerReg', 'raise6sec', 'raise60sec', 'raise5min'].forEach(service => {
        const slider = document.getElementById(`${service}Capacity`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                document.getElementById(`${service}CapValue`).textContent = e.target.value;
            });
        }
    });
}

// Tab switching
window.switchTab = function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabName}Tab`).classList.add('active');
    
    if (tabName === 'analytics') {
        updateAnalytics();
    } else if (tabName === 'leaderboard') {
        updateLeaderboard();
    }
}

// Update bidstack strategy
window.updateBidstack = function updateBidstack() {
    const chargeBids = [];
    const dischargeBids = [];
    
    for (let i = 0; i < 10; i++) {
        chargeBids.push({
            band: i + 1,
            mw: parseFloat(document.getElementById(`charge_mw_${i}`).value),
            price: parseFloat(document.getElementById(`charge_price_${i}`).value)
        });
        dischargeBids.push({
            band: i + 1,
            mw: parseFloat(document.getElementById(`discharge_mw_${i}`).value),
            price: parseFloat(document.getElementById(`discharge_price_${i}`).value)
        });
    }
    
    if (!validateBidstack(chargeBids, dischargeBids)) {
        return;
    }
    
    state.strategy.chargeBids = chargeBids;
    state.strategy.dischargeBids = dischargeBids;
    
    document.getElementById('bidstackStatus').innerHTML = '<span style="color: #00E87E;">✓ Bidstack updated successfully!</span>';
    setTimeout(() => {
        document.getElementById('bidstackStatus').innerHTML = '';
    }, 3000);
}

function validateBidstack(chargeBids, dischargeBids) {
    // Check price ordering (ascending) for charge
    for (let i = 1; i < chargeBids.length; i++) {
        if (chargeBids[i].price < chargeBids[i-1].price) {
            document.getElementById('bidstackStatus').innerHTML = `<span style="color: #ff4444;">Error: Charge prices must be ascending. Band ${i+1} < Band ${i}</span>`;
            return false;
        }
    }
    
    // Check for discharge
    for (let i = 1; i < dischargeBids.length; i++) {
        if (dischargeBids[i].price < dischargeBids[i-1].price) {
            document.getElementById('bidstackStatus').innerHTML = `<span style="color: #ff4444;">Error: Discharge prices must be ascending. Band ${i+1} < Band ${i}</span>`;
            return false;
        }
    }
    
    // No overlap: max charge price < min discharge price
    if (chargeBids[9].price >= dischargeBids[0].price) {
        document.getElementById('bidstackStatus').innerHTML = '<span style="color: #ff4444;">Error: Max charge price must be < min discharge price to avoid simultaneous dispatch</span>';
        return false;
    }
    
    // Check MW limits per side
    const totalChargeMW = chargeBids.reduce((sum, bid) => sum + bid.mw, 0);
    const totalDischargeMW = dischargeBids.reduce((sum, bid) => sum + bid.mw, 0);
    if (totalChargeMW > state.bess.powerMW || totalDischargeMW > state.bess.powerMW) {
        document.getElementById('bidstackStatus').innerHTML = '<span style="color: #ff4444;">Error: Total MW per side cannot exceed power rating (5MW)</span>';
        return false;
    }
    
    return true;
}

// Validate custom JavaScript rules
window.validateRules = function validateRules() {
    const rulesCode = document.getElementById('customRules').value;
    if (!rulesCode.trim()) {
        alert('No rules to validate');
        return;
    }
    
    try {
        const sandboxFunc = new Function('price', 'soc', 'forecast', 'charge', 'discharge', 'hold', rulesCode);
        const charge = () => {};
        const discharge = () => {};
        const hold = () => {};
        sandboxFunc(100, 50, [100, 110, 120], charge, discharge, hold);
        alert('Rules validated successfully!');
        state.strategy.customRules = rulesCode;
    } catch (error) {
        alert(`Validation error: ${error.message}`);
    }
}

// Save complete strategy
window.saveStrategy = function saveStrategy() {
    // Collect FCAS settings
    state.strategy.fcas = {
        raiseReg: {
            enabled: document.getElementById('raiseReg').checked,
            capacity: parseFloat(document.getElementById('raiseRegCapacity').value),
            price: state.market.fcasPrices.raiseReg || 0
        },
        lowerReg: {
            enabled: document.getElementById('lowerReg').checked,
            capacity: parseFloat(document.getElementById('lowerRegCapacity').value),
            price: state.market.fcasPrices.lowerReg || 0
        },
        raise6sec: {
            enabled: document.getElementById('raise6sec').checked,
            capacity: parseFloat(document.getElementById('raise6secCapacity').value),
            price: state.market.fcasPrices.raise6sec || 0
        },
        raise60sec: {
            enabled: document.getElementById('raise60sec').checked,
            capacity: parseFloat(document.getElementById('raise60secCapacity').value),
            price: state.market.fcasPrices.raise60sec || 0
        },
        raise5min: {
            enabled: document.getElementById('raise5min').checked,
            capacity: parseFloat(document.getElementById('raise5minCapacity').value),
            price: state.market.fcasPrices.raise5min || 0
        }
    };
    
    // Validate FCAS capacity with NEMDE co-optimization rules
    const totalReg = (state.strategy.fcas.raiseReg.enabled ? state.strategy.fcas.raiseReg.capacity : 0) +
                     (state.strategy.fcas.lowerReg.enabled ? state.strategy.fcas.lowerReg.capacity : 0);
    const totalCont = (state.strategy.fcas.raise6sec.enabled ? state.strategy.fcas.raise6sec.capacity : 0) +
                      (state.strategy.fcas.raise60sec.enabled ? state.strategy.fcas.raise60sec.capacity : 0) +
                      (state.strategy.fcas.raise5min.enabled ? state.strategy.fcas.raise5min.capacity : 0);
    
    if (totalReg > state.bess.powerMW) {
        alert(`Error: Regulation FCAS (${totalReg.toFixed(1)}MW) exceeds power rating. Regulation reserves capacity.`);
        return;
    }
    
    if (totalReg + totalCont > state.bess.powerMW) {
        alert(`Error: Total FCAS (Reg: ${totalReg.toFixed(1)}MW + Cont: ${totalCont.toFixed(1)}MW) exceeds power rating`);
        return;
    }
    
    saveStrategyToBackend();
}

async function saveStrategyToBackend() {
    try {
        const response = await fetch(`${API_ENDPOINT}/api/trading/strategy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: state.user,
                strategy: state.strategy,
                simulation: state.simulation,
                timestamp: new Date().toISOString()
            })
        });
        
        if (response.ok) {
            document.getElementById('saveStatus').innerHTML = '<span style="color: #00E87E;">✓ Strategy saved successfully!</span>';
        } else {
            localStorage.setItem(`strategy_${state.user}`, JSON.stringify(state.strategy));
            document.getElementById('saveStatus').innerHTML = '<span style="color: #ffc107;">⚠ Saved locally (backend unavailable)</span>';
        }
    } catch (error) {
        localStorage.setItem(`strategy_${state.user}`, JSON.stringify(state.strategy));
        document.getElementById('saveStatus').innerHTML = '<span style="color: #ffc107;">⚠ Saved locally</span>';
    }
    
    setTimeout(() => {
        document.getElementById('saveStatus').innerHTML = '';
    }, 3000);
}

// Start trading session
function startTradingSession() {
    loadSavedStrategy();
    startLiveDataFeed();
    startSimulation();
    
    // Update market data every 5 minutes
    setInterval(() => {
        updateMarketData();
    }, 5 * 60 * 1000);
    
    // Run simulation step every 30 seconds to track trading activity
    setInterval(() => {
        if (state.user && state.market.currentPrice > 0) {
            runSimulationStep();
            updateUI();
        }
    }, 30 * 1000);
    
    // Sync with backend every 2 minutes
    setInterval(syncWithBackend, 2 * 60 * 1000);
}

function loadSavedStrategy() {
    const saved = localStorage.getItem(`strategy_${state.user}`);
    if (saved) {
        const savedStrategy = JSON.parse(saved);
        state.strategy = savedStrategy;
        
        // Update UI with saved strategy if bands exist
        if (savedStrategy.chargeBids && savedStrategy.dischargeBids) {
            savedStrategy.chargeBids.forEach((bid, i) => {
                if (document.getElementById(`charge_mw_${i}`)) {
                    document.getElementById(`charge_mw_${i}`).value = bid.mw;
                    document.getElementById(`charge_price_${i}`).value = bid.price;
                }
            });
            savedStrategy.dischargeBids.forEach((bid, i) => {
                if (document.getElementById(`discharge_mw_${i}`)) {
                    document.getElementById(`discharge_mw_${i}`).value = bid.mw;
                    document.getElementById(`discharge_price_${i}`).value = bid.price;
                }
            });
        }
    }
}

// Live data feed - REAL ENDPOINTS ONLY
async function startLiveDataFeed() {
    await updateMarketData();
    updateUI();
}

// Refresh market data WITHOUT running simulation
window.refreshMarketOnly = async function refreshMarketOnly() {
    // Just call updateMarketData - it handles everything including retries
    console.log('Manual refresh requested');
    await updateMarketData();
}

window.updateMarketData = async function updateMarketData() {
    try {
        console.log('Fetching market data from:', `${API_ENDPOINT}/api/latest`);
        // Simple fetch - no need for CORS mode since our API handles it
        const response = await fetch(`${API_ENDPOINT}/api/latest`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Market data received:', data ? 'Success' : 'Empty');
        
        if (data && data.regions) {
            const region = state.market.region || 'VIC1';
            const regionData = data.regions[region];
            
            if (regionData) {
                // Update current price - handle different field names
                state.market.currentPrice = regionData.energyPrice || regionData.price || 0;
                document.getElementById('currentPrice').textContent = `$${state.market.currentPrice.toFixed(2)}`;
                document.getElementById('priceLabel').textContent = `${region} Price ($/MWh)`;
                
                // Update market demand/generation data
                if (document.getElementById('marketDemand')) {
                    document.getElementById('marketDemand').textContent = `${(regionData.totalDemand || regionData.scheduledDemand || 0).toFixed(0)} MW`;
                    document.getElementById('marketGeneration').textContent = `${(regionData.scheduledGeneration || 0).toFixed(0)} MW`;
                    document.getElementById('netInterchange').textContent = `${(regionData.netInterchange || 0).toFixed(0)} MW`;
                }
                
                // Get REAL FCAS prices from the data
                if (regionData.fcas) {
                    state.market.fcasPrices = {
                        raiseReg: regionData.fcas.raiseReg || 0,
                        lowerReg: regionData.fcas.lowerReg || 0,
                        raise6sec: regionData.fcas.raise6sec || 0,
                        raise60sec: regionData.fcas.raise60sec || 0,
                        raise5min: regionData.fcas.raise5min || 0,
                        lower6sec: regionData.fcas.lower6sec || 0,
                        lower60sec: regionData.fcas.lower60sec || 0,
                        lower5min: regionData.fcas.lower5min || 0
                    };
                    
                    // Update FCAS display in metrics
                    if (document.getElementById('fcasRaiseReg')) {
                        document.getElementById('fcasRaiseReg').textContent = `$${regionData.fcas.raiseReg.toFixed(2)}`;
                        document.getElementById('fcasLowerReg').textContent = `$${regionData.fcas.lowerReg.toFixed(2)}`;
                        document.getElementById('fcasRaise6s').textContent = `$${regionData.fcas.raise6sec.toFixed(2)}`;
                    }
                }
                
                // Update settlement time
                if (data.settlementTime && document.getElementById('lastUpdate')) {
                    document.getElementById('lastUpdate').textContent = `Last update: ${data.settlementTime}`;
                }
                
                state.market.lastDataUpdate = new Date();
                updateFCASPrices();
                
                // Run simulation step immediately after getting new price data
                // BUT only if we have a valid price and user is logged in
                if (state.user && state.market.currentPrice > 0) {
                    runSimulationStep();
                    updateUI();
                }
            }
        }
    } catch (error) {
        console.error('Failed to fetch market data:', error);
        
        // Try alternative fetch without CORS mode for local testing
        try {
            console.log('Trying alternative fetch method...');
            const altResponse = await fetch(`${API_ENDPOINT}/api/latest`);
            if (altResponse.ok) {
                const data = await altResponse.json();
                if (data && data.regions) {
                    const region = state.market.region || 'VIC1';
                    const regionData = data.regions[region];
                    if (regionData) {
                        state.market.currentPrice = regionData.energyPrice || regionData.price || 0;
                        document.getElementById('currentPrice').textContent = `$${state.market.currentPrice.toFixed(2)}`;
                        document.getElementById('priceLabel').textContent = `${region} Price ($/MWh)`;
                        
                        // Update displays
                        if (document.getElementById('marketDemand')) {
                            document.getElementById('marketDemand').textContent = `${(regionData.totalDemand || 0).toFixed(0)} MW`;
                            document.getElementById('marketGeneration').textContent = `${(regionData.scheduledGeneration || 0).toFixed(0)} MW`;
                            document.getElementById('netInterchange').textContent = `${(regionData.netInterchange || 0).toFixed(0)} MW`;
                        }
                        
                        // Update FCAS
                        if (regionData.fcas) {
                            state.market.fcasPrices = regionData.fcas;
                            updateFCASPrices();
                        }
                        
                        // Update timestamp
                        if (data.settlementTime) {
                            document.getElementById('lastUpdate').textContent = `Last update: ${data.settlementTime}`;
                        }
                        
                        // Run simulation
                        if (state.user && state.market.currentPrice > 0) {
                            runSimulationStep();
                            updateUI();
                        }
                        return; // Success!
                    }
                }
            }
        } catch (altError) {
            console.error('Alternative fetch also failed:', altError);
        }
        
        // If both methods fail, show error and retry
        document.getElementById('currentPrice').textContent = 'Connecting...';
        document.getElementById('priceLabel').textContent = `Retrying API connection...`;
        
        // Clear FCAS prices
        state.market.fcasPrices = {
            raiseReg: 0,
            lowerReg: 0,
            raise6sec: 0,
            raise60sec: 0,
            raise5min: 0
        };
        updateFCASPrices();
        
        // Show connection error
        if (document.getElementById('lastUpdate')) {
            document.getElementById('lastUpdate').textContent = '⚠️ Connecting to live market data...';
            document.getElementById('lastUpdate').style.color = '#ff4444';
        }
        
        // Retry connection in 3 seconds
        setTimeout(() => {
            updateMarketData();
        }, 3000);
    }
}

function updateFCASPrices() {
    // Update FCAS price displays with REAL data
    const prices = state.market.fcasPrices;
    document.getElementById('raiseRegPrice').textContent = `$${(prices.raiseReg || 0).toFixed(2)}/MW`;
    document.getElementById('lowerRegPrice').textContent = `$${(prices.lowerReg || 0).toFixed(2)}/MW`;
    document.getElementById('raise6secPrice').textContent = `$${(prices.raise6sec || 0).toFixed(2)}/MW`;
    document.getElementById('raise60secPrice').textContent = `$${(prices.raise60sec || 0).toFixed(2)}/MW`;
    document.getElementById('raise5minPrice').textContent = `$${(prices.raise5min || 0).toFixed(2)}/MW`;
}

// Simulation engine
function startSimulation() {
    // RESET all simulation values when starting
    state.simulation.weekRevenue = 0;
    state.simulation.dailyRevenue = 0;
    state.simulation.fcasRevenue = 0;
    state.simulation.costs = 0;
    state.simulation.history = [];
    state.simulation.lastUpdate = new Date();
    
    // Reset battery state
    state.bess.soc = 50;
    state.bess.cyclesDaily = 0;
    
    // Only run simulation if we have price data
    if (state.market.currentPrice > 0) {
        runSimulationStep();
    }
}

function runSimulationStep() {
    const price = state.market.currentPrice;
    const soc = state.bess.soc;
    
    // Don't run simulation with invalid price
    if (!price || price === 0) {
        console.log('Skipping simulation - no valid price data');
        return;
    }
    
    let action = determineAction(price, soc);
    
    // Debug logging to console
    console.log('Simulation Step:', {
        price: price,
        soc: soc,
        action: action,
        mode: state.mode,
        weekRevenue: state.simulation.weekRevenue,
        hasBids: {
            charge: state.strategy.chargeBids?.length || 0,
            discharge: state.strategy.dischargeBids?.length || 0
        }
    });
    
    executeAction(action);
    calculateRevenue(action);
    updateUI();
    
    state.simulation.history.push({
        timestamp: new Date(),
        price: price,
        soc: state.bess.soc, // Use updated SoC after action
        action: action, // Store full action object with type and mw
        revenue: state.simulation.dailyRevenue
    });
    
    // Check cycle limit
    if (state.bess.cyclesDaily > state.bess.maxCycles) {
        console.warn('Exceeded max daily cycles - degradation penalty applied');
        state.simulation.costs += 500; // Penalty
    }
}

function determineAction(price, soc) {
    // NEMDE Co-optimization: Calculate reserved regulation MW first
    let reservedRegMW = 0;
    if (state.strategy.fcas.raiseReg.enabled) reservedRegMW += state.strategy.fcas.raiseReg.capacity;
    if (state.strategy.fcas.lowerReg.enabled) reservedRegMW += state.strategy.fcas.lowerReg.capacity;
    
    // Available MW for energy after regulation reservation
    const availableEnergyMW = Math.max(0, state.bess.powerMW - reservedRegMW);
    
    // Non-scheduled mode: Simple time and price rules
    if (state.mode === 'non-scheduled') {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
        
        const ns = state.strategy.nonScheduled;
        
        // Check charge window
        if (currentTime >= ns.chargeStartTime && currentTime <= ns.chargeEndTime && 
            price <= ns.maxChargePrice && soc < 95) {
            const deltaT = 30 / 3600; // 30 seconds (matches simulation interval)
            const maxEnergy = (100 - soc) / 100 * state.bess.capacityMWh / state.bess.efficiency;
            const maxMW = maxEnergy / deltaT;
            const cRateLimit = Math.min(state.bess.powerMW, state.bess.capacityMWh * state.bess.cRating);
            return { type: 'charge', mw: Math.min(availableEnergyMW, maxMW, cRateLimit) };
        }
        
        // Check discharge window
        if (currentTime >= ns.dischargeStartTime && currentTime <= ns.dischargeEndTime && 
            price >= ns.minDischargePrice && soc > 5) {
            const deltaT = 30 / 3600; // 30 seconds (matches simulation interval)
            const maxEnergy = soc / 100 * state.bess.capacityMWh * state.bess.efficiency;
            const maxMW = maxEnergy / deltaT;
            const cRateLimit = Math.min(state.bess.powerMW, state.bess.capacityMWh * state.bess.cRating);
            return { type: 'discharge', mw: Math.min(availableEnergyMW, maxMW, cRateLimit) };
        }
        
        return { type: 'hold', mw: 0 };
    }
    
    // Scheduled mode: Full bidstack with NEMDE dispatch
    // Custom rules override
    if (state.strategy.customRules) {
        try {
            let customAction = null;
            const charge = (mw) => { customAction = { type: 'charge', mw: Math.min(mw, availableEnergyMW) }; };
            const discharge = (mw) => { customAction = { type: 'discharge', mw: Math.min(mw, availableEnergyMW) }; };
            const hold = () => { customAction = { type: 'hold', mw: 0 }; };
            
            const sandboxFunc = new Function('price', 'soc', 'forecast', 'charge', 'discharge', 'hold', 
                state.strategy.customRules);
            sandboxFunc(price, soc, [], charge, discharge, hold);
            
            if (customAction) return customAction;
        } catch (error) {
            console.error('Custom rule error:', error);
        }
    }
    
    // Calculate charge MW (sum bands where price <= band.price)
    let chargeMW = 0;
    if (state.strategy.chargeBids) {
        for (const bid of state.strategy.chargeBids) {
            if (price <= bid.price && bid.mw > 0) {
                chargeMW += bid.mw;
            }
        }
    }
    chargeMW = Math.min(chargeMW, availableEnergyMW); // Cap at available after FCAS
    
    // Calculate discharge MW (sum bands where price >= band.price)
    let dischargeMW = 0;
    if (state.strategy.dischargeBids) {
        for (const bid of state.strategy.dischargeBids) {
            if (price >= bid.price && bid.mw > 0) {
                dischargeMW += bid.mw;
            }
        }
    }
    dischargeMW = Math.min(dischargeMW, availableEnergyMW); // Cap at available after FCAS
    
    // Prevent simultaneous (should be impossible with validation)
    if (chargeMW > 0 && dischargeMW > 0) {
        return { type: 'hold', mw: 0 };
    }
    
    // Calculate C-rating power limit based on current SoC
    const cRateMaxPower = state.bess.capacityMWh * state.bess.cRating; // 20MWh * 0.5 = 10MW
    const actualMaxPower = Math.min(state.bess.powerMW, cRateMaxPower); // Limited by inverter (5MW)
    
    const deltaT = 30 / 3600; // 30 seconds (matches simulation interval)
    
    if (chargeMW > 0 && soc < 95) {
        // Calculate max charge power based on remaining capacity
        const maxEnergy = (100 - soc) / 100 * state.bess.capacityMWh / state.bess.efficiency;
        const maxMWFromSoc = maxEnergy / deltaT;
        
        // Apply all constraints: bidstack, C-rating, inverter, and SoC
        const finalChargeMW = Math.min(chargeMW, actualMaxPower, maxMWFromSoc);
        return { type: 'charge', mw: finalChargeMW };
    } else if (dischargeMW > 0 && soc > 5) {
        // Calculate max discharge power based on available energy
        const maxEnergy = soc / 100 * state.bess.capacityMWh * state.bess.efficiency;
        const maxMWFromSoc = maxEnergy / deltaT;
        
        // Apply all constraints: bidstack, C-rating, inverter, and SoC
        const finalDischargeMW = Math.min(dischargeMW, actualMaxPower, maxMWFromSoc);
        return { type: 'discharge', mw: finalDischargeMW };
    }
    
    return { type: 'hold', mw: 0 };
}

function executeAction(action) {
    // IMPORTANT: Simulation runs every 30 seconds, not 5 minutes!
    // Use actual time interval for accurate energy calculations
    const deltaT = 30 / 3600; // 30 seconds in hours (0.00833 hours)
    
    if (action.type === 'charge') {
        // Energy charged = Power * Time * Efficiency
        const energy = action.mw * deltaT * state.bess.efficiency;
        const socDelta = (energy / state.bess.capacityMWh) * 100;
        state.bess.soc = Math.min(100, state.bess.soc + socDelta);
        state.bess.cyclesDaily += socDelta / 100 / 2; // Partial cycle
        
        console.log(`Charging: ${action.mw}MW for ${deltaT*60} min = ${energy.toFixed(3)}MWh, SoC change: ${socDelta.toFixed(2)}%`);
    } else if (action.type === 'discharge') {
        // Energy discharged = Power * Time / Efficiency
        const energy = action.mw * deltaT / state.bess.efficiency;
        const socDelta = (energy / state.bess.capacityMWh) * 100;
        state.bess.soc = Math.max(0, state.bess.soc - socDelta);
        state.bess.cyclesDaily += socDelta / 100 / 2;
        
        console.log(`Discharging: ${action.mw}MW for ${deltaT*60} min = ${energy.toFixed(3)}MWh, SoC change: -${socDelta.toFixed(2)}%`);
    }
}

function calculateRevenue(action) {
    // Match the same time interval as executeAction (30 seconds)
    const deltaT = 30 / 3600; // 30 seconds in hours
    const price = state.market.currentPrice;
    
    let energyRevenue = 0;
    if (action.type === 'discharge') {
        energyRevenue = action.mw * deltaT * price;
    } else if (action.type === 'charge') {
        energyRevenue = -action.mw * deltaT * price;
    }
    
    // Debug revenue calculation
    if (action.mw > 0) {
        console.log('Revenue calc:', {
            action: action.type,
            mw: action.mw,
            price: price,
            energyRevenue: energyRevenue,
            previousWeekRevenue: state.simulation.weekRevenue
        });
    }
    
    // Calculate FCAS revenue with NEMDE co-optimization
    let fcasRevenue = 0;
    let coOptFactor = 1.0; // Co-optimization factor
    
    // If high energy price and we're discharging, NEMDE might reduce contingency FCAS
    if (price > 300 && action.type === 'discharge') {
        coOptFactor = 0.7; // Reduce contingency enablement to prioritize energy
    } else if (price < 50 && action.type === 'charge') {
        coOptFactor = 1.2; // Increase FCAS when energy opportunity is low
    }
    
    Object.entries(state.strategy.fcas).forEach(([service, config]) => {
        if (config.enabled && state.market.fcasPrices[service]) {
            // Regulation FCAS always enabled at full capacity when reserved
            const enablementFactor = service.includes('Reg') ? 0.3 : 0.3 * coOptFactor;
            fcasRevenue += config.capacity * deltaT * state.market.fcasPrices[service] * enablementFactor;
        }
    });
    
    state.simulation.dailyRevenue += energyRevenue + fcasRevenue;
    state.simulation.weekRevenue += energyRevenue + fcasRevenue;
    state.simulation.fcasRevenue += fcasRevenue;
    
    // Degradation cost
    if (action.mw > 0) {
        state.simulation.costs += (action.mw * deltaT / state.bess.capacityMWh) * 200; // $200 per MWh cycled
    }
}

// Update UI
function updateUI() {
    document.getElementById('weekRevenue').textContent = `$${state.simulation.weekRevenue.toFixed(0)}`;
    document.getElementById('cycleCount').textContent = state.bess.cyclesDaily.toFixed(1);
    
    const socFill = document.getElementById('socFill');
    socFill.style.width = `${state.bess.soc}%`;
    socFill.textContent = `${state.bess.soc.toFixed(1)}% SoC`;
    
    // Update analytics if visible
    if (document.getElementById('analyticsTab').classList.contains('active')) {
        updateAnalytics();
    }
    
    updateRank();
}

async function updateRank() {
    try {
        const response = await fetch(`${API_ENDPOINT}/api/trading/rank/${state.user}`);
        if (response.ok) {
            const data = await response.json();
            document.getElementById('currentRank').textContent = `#${data.rank}`;
        } else {
            document.getElementById('currentRank').textContent = '#-';
        }
    } catch (error) {
        console.error('Failed to fetch rank:', error);
        document.getElementById('currentRank').textContent = '#-';
    }
}

// Analytics
function updateAnalytics() {
    // Calculate net profit
    const netProfit = state.simulation.weekRevenue - state.simulation.costs;
    document.getElementById('totalProfit').textContent = `$${netProfit.toFixed(0)}`;
    document.getElementById('avgEfficiency').textContent = `${(state.bess.efficiency * 100).toFixed(0)}%`;
    document.getElementById('fcasContribution').textContent = `$${state.simulation.fcasRevenue.toFixed(0)}`;
    document.getElementById('degradationCost').textContent = `$${state.simulation.costs.toFixed(0)}`;
    
    // Update charts
    updateCharts();
}

function updateCharts() {
    // Clear existing charts first
    Chart.helpers.each(Chart.instances, function(instance) {
        instance.destroy();
    });
    
    // Price and Action Chart - REAL MARKET DATA
    const priceActionCtx = document.getElementById('priceActionChart');
    if (priceActionCtx && state.simulation.history.length > 0) {
        const history = state.simulation.history.slice(-48); // Last 4 hours
        const labels = history.map(h => 
            new Date(h.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
        );
        
        new Chart(priceActionCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Energy Price ($/MWh)',
                    data: history.map(h => h.price),
                    borderColor: '#00E87E',
                    backgroundColor: 'rgba(0, 232, 126, 0.1)',
                    yAxisID: 'y-price',
                    tension: 0.2
                }, {
                    label: 'State of Charge (%)',
                    data: history.map(h => h.soc),
                    borderColor: '#ffc107',
                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
                    yAxisID: 'y-soc',
                    tension: 0.2
                }, {
                    label: 'Action',
                    data: history.map(h => {
                        if (h.action.type === 'charge') return h.price - 20; // Show below price
                        if (h.action.type === 'discharge') return h.price + 20; // Show above price
                        return null;
                    }),
                    borderColor: 'transparent',
                    backgroundColor: history.map(h => {
                        if (h.action.type === 'charge') return '#00ff8f';
                        if (h.action.type === 'discharge') return '#ff4444';
                        return 'transparent';
                    }),
                    pointStyle: history.map(h => {
                        if (h.action.type === 'charge') return 'triangle';
                        if (h.action.type === 'discharge') return 'triangleDown';
                        return 'circle';
                    }),
                    pointRadius: history.map(h => h.action.type !== 'hold' ? 6 : 0),
                    showLine: false,
                    yAxisID: 'y-price'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    'y-price': {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Price ($/MWh)',
                            color: '#00E87E'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    'y-soc': {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'SoC (%)',
                            color: '#ffc107'
                        },
                        min: 0,
                        max: 100,
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            afterLabel: function(context) {
                                const point = history[context.dataIndex];
                                if (point.action.type !== 'hold') {
                                    return `Action: ${point.action.type} @ ${point.action.mw.toFixed(1)} MW`;
                                }
                                return '';
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Revenue chart
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx && state.simulation.history.length > 0) {
        const labels = state.simulation.history.slice(-24).map(h => 
            new Date(h.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
        );
        const data = state.simulation.history.slice(-24).map(h => h.revenue);
        
        new Chart(revenueCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Revenue',
                    data: data,
                    borderColor: '#00E87E',
                    backgroundColor: 'rgba(0, 232, 126, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#999' }
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#999' }
                    }
                }
            }
        });
    }
    
    // SoC chart
    const socCtx = document.getElementById('socChart');
    if (socCtx && state.simulation.history.length > 0) {
        const labels = state.simulation.history.slice(-24).map(h => 
            new Date(h.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
        );
        const data = state.simulation.history.slice(-24).map(h => h.soc);
        
        new Chart(socCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'State of Charge',
                    data: data,
                    borderColor: '#ffc107',
                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#999' }
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#999' }
                    }
                }
            }
        });
    }
}

// Leaderboard
window.updateLeaderboard = async function updateLeaderboard() {
    try {
        // Sync current user data first
        await fetch(`${API_ENDPOINT}/api/trading/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user: state.user,
                simulation: {
                    weekRevenue: state.simulation.weekRevenue,
                    dailyRevenue: state.simulation.dailyRevenue,
                    fcasRevenue: state.simulation.fcasRevenue,
                    costs: state.simulation.costs,
                    cycles: state.bess.cyclesDaily
                },
                timestamp: new Date().toISOString()
            })
        });
        
        // Fetch leaderboard
        const response = await fetch(`${API_ENDPOINT}/api/trading/leaderboard`);
        let leaderboardData = await response.json();
        
        // Add current user if not in list
        if (!leaderboardData.find(entry => entry.team === state.user)) {
            leaderboardData.push({
                team: state.user,
                revenue: state.simulation.weekRevenue,
                efficiency: 90,
                cycles: state.bess.cyclesDaily
            });
        }
        
        // Calculate net profit for sorting
        leaderboardData = leaderboardData.map(entry => ({
            ...entry,
            netProfit: entry.revenue - (entry.costs || 0)
        }));
        
        // Sort by net profit
        const sortedData = leaderboardData.sort((a, b) => b.netProfit - a.netProfit);
        
        // Update rank
        sortedData.forEach((team, index) => {
            team.rank = index + 1;
        });
        
        state.leaderboard = sortedData;
        
        // Update table
        const tbody = document.getElementById('leaderboardBody');
        tbody.innerHTML = sortedData.slice(0, 10).map(team => `
            <tr ${team.team === state.user ? 'style="background: rgba(0, 232, 126, 0.1)"' : ''}>
                <td>${team.rank}</td>
                <td>${team.team}</td>
                <td>$${team.netProfit.toFixed(0)}</td>
                <td>${team.efficiency}%</td>
                <td>${team.cycles.toFixed(1)}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Failed to update leaderboard:', error);
        // Show error message instead of fake data
        const tbody = document.getElementById('leaderboardBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Failed to load leaderboard</td></tr>';
    }
}

// Sync with backend
async function syncWithBackend() {
    if (!state.user) return;
    
    try {
        await fetch(`${API_ENDPOINT}/api/trading/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user: state.user,
                simulation: state.simulation,
                timestamp: new Date().toISOString()
            })
        });
    } catch (error) {
        console.error('Sync failed:', error);
    }
}

// Weekly reset
function weeklyReset() {
    state.simulation.weekRevenue = 0;
    state.simulation.dailyRevenue = 0;
    state.simulation.fcasRevenue = 0;
    state.simulation.costs = 0;
    state.bess.cyclesDaily = 0;
    state.simulation.history = [];
    
    updateUI();
}

// Mode switching functions
window.switchMode = function switchMode(newMode) {
    state.mode = newMode;
    // Update UI visibility
    document.getElementById('scheduledSection').style.display = newMode === 'scheduled' ? 'block' : 'none';
    document.getElementById('nonScheduledSection').style.display = newMode === 'non-scheduled' ? 'block' : 'none';
    
    // Update info box
    const modeInfo = document.getElementById('modeInfo');
    if (modeInfo) {
        if (newMode === 'scheduled') {
            modeInfo.innerHTML = '<strong>Scheduled Mode (IRP):</strong> Full 20-band bidstack dispatch by AEMO. Mandatory for 5MW+ BESS under Integrated Resource Provider rules. Co-optimized energy and FCAS.';
        } else {
            modeInfo.innerHTML = '<strong>Non-Scheduled Mode:</strong> Simple time-based rules. For <5MW units or gameplay simplification. Set charge/discharge windows and price thresholds.';
        }
    }
    
    console.log(`Switched to ${newMode} mode`);
}

// Update non-scheduled strategy
window.updateNonScheduled = function updateNonScheduled() {
    state.strategy.nonScheduled = {
        chargeStartTime: document.getElementById('chargeStart').value,
        chargeEndTime: document.getElementById('chargeEnd').value,
        maxChargePrice: parseFloat(document.getElementById('maxChargePrice').value),
        dischargeStartTime: document.getElementById('dischargeStart').value,
        dischargeEndTime: document.getElementById('dischargeEnd').value,
        minDischargePrice: parseFloat(document.getElementById('minDischargePrice').value)
    };
    
    document.getElementById('nonScheduledStatus').innerHTML = '<span style="color: #00E87E;">✓ Non-scheduled strategy updated!</span>';
    setTimeout(() => {
        document.getElementById('nonScheduledStatus').innerHTML = '';
    }, 3000);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { state, determineAction, calculateRevenue };
}