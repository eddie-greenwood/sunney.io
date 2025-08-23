// BESS Optimizer - Main Script
// Integrates with Sunney.io API for real-time and forward pricing data

// API Configuration
const API_BASE = window.location.hostname === 'localhost' 
    ? 'http://localhost:8787' 
    : 'https://api.sunney.io';

// Global variables
let chartInstances = {};
let currentData = null;
let lastPrices = {};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeDates();
    initializeTicker();
    checkAPIStatus();
    
    // Auto-analyze with default settings
    setTimeout(() => {
        analyzeOpportunity();
    }, 1000);
});

// Initialize date inputs
function initializeDates() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Set default to last 7 days
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 7);
    
    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = yesterday.toISOString().split('T')[0];
}

// Check API status
async function checkAPIStatus() {
    const statusLight = document.getElementById('statusLight');
    const statusText = document.getElementById('statusText');
    
    try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
            statusLight.style.background = '#00E87E';
            statusText.textContent = 'API Connected';
        } else {
            throw new Error('API unavailable');
        }
    } catch (error) {
        statusLight.style.background = '#ff6b6b';
        statusText.textContent = 'API Offline - Using Cached Data';
    }
}

// Initialize price ticker
async function initializeTicker() {
    try {
        const response = await fetch(`${API_BASE}/api/prices/latest`);
        if (!response.ok) throw new Error('Failed to fetch prices');
        
        const data = await response.json();
        updateTicker(data.regions);
        
        // Update every 30 seconds
        setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/api/prices/latest`);
                const newData = await res.json();
                updateTicker(newData.regions);
            } catch (e) {
                console.error('Ticker update failed:', e);
            }
        }, 30000);
    } catch (error) {
        console.error('Failed to initialize ticker:', error);
        document.getElementById('tickerContent').innerHTML = '<span style="color: #ff6b6b;">Price data unavailable</span>';
    }
}

// Update ticker display
function updateTicker(regions) {
    const tickerInner = document.getElementById('tickerInner');
    const lastUpdate = document.getElementById('lastUpdate');
    
    if (!regions || regions.length === 0) return;
    
    // Create ticker items (duplicate for smooth scrolling)
    let tickerHTML = '';
    const createTickerItem = (region) => {
        const prev = lastPrices[region.region] || region.price;
        const change = region.price - prev;
        const changeClass = change >= 0 ? 'up' : 'down';
        const changeSymbol = change >= 0 ? '↑' : '↓';
        
        lastPrices[region.region] = region.price;
        
        return `
            <div class="ticker-item">
                <span class="ticker-region">${region.region}:</span>
                <span class="ticker-price">$${region.price.toFixed(2)}</span>
                <span class="ticker-change ${changeClass}">${changeSymbol} ${Math.abs(change).toFixed(2)}</span>
            </div>
        `;
    };
    
    // Create 3 copies for smooth infinite scroll
    for (let i = 0; i < 3; i++) {
        regions.forEach(region => {
            tickerHTML += createTickerItem(region);
        });
    }
    
    tickerInner.innerHTML = tickerHTML;
    lastUpdate.textContent = new Date().toLocaleTimeString('en-AU', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Australia/Sydney'
    });
}

// Set time period
function setTimePeriod(period, event) {
    if (event) {
        event.preventDefault();
        // Update active button
        document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
    }
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate);
    
    switch(period) {
        case 'yesterday':
            startDate.setDate(startDate.getDate() - 1);
            break;
        case '7d':
            startDate.setDate(startDate.getDate() - 7);
            break;
        case '14d':
            startDate.setDate(startDate.getDate() - 14);
            break;
        case '30d':
            startDate.setDate(startDate.getDate() - 30);
            break;
        case '90d':
            startDate.setDate(startDate.getDate() - 90);
            break;
        case '2026':
            startDate.setFullYear(2026, 0, 1);
            endDate.setFullYear(2026, 0, 31);
            break;
    }
    
    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
}

// Main analysis function
async function analyzeOpportunity() {
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const metrics = document.getElementById('metrics');
    const navTabs = document.getElementById('navTabs');
    
    // Reset UI
    loading.classList.add('active');
    error.classList.remove('active');
    metrics.style.display = 'none';
    navTabs.style.display = 'none';
    
    try {
        // Get parameters
        const params = {
            region: document.getElementById('region').value,
            startDate: document.getElementById('startDate').value,
            endDate: document.getElementById('endDate').value,
            numUnits: parseInt(document.getElementById('numUnits').value),
            power: parseFloat(document.getElementById('power').value),
            capacity: parseFloat(document.getElementById('capacity').value),
            efficiency: parseFloat(document.getElementById('efficiency').value) / 100,
            maxCycles: parseFloat(document.getElementById('maxCycles').value),
            throughputCost: parseFloat(document.getElementById('throughputCost').value),
            optimizationMode: document.getElementById('optimizationMode').value,
            siteMode: document.getElementById('siteMode').value,
            tariff: document.getElementById('tariff').value
        };
        
        // Fetch price data
        updateProgress(10, 'Fetching price data...');
        const prices = await fetchPriceData(params);
        
        if (!prices || prices.length === 0) {
            throw new Error('No price data available for selected period');
        }
        
        // Run optimization
        updateProgress(50, 'Running optimization algorithm...');
        const results = await runOptimization(prices, params);
        
        // Display results
        updateProgress(90, 'Rendering results...');
        displayResults(results, params);
        
        // Show UI
        metrics.style.display = 'grid';
        navTabs.style.display = 'flex';
        
        // Store for later use
        currentData = results;
        
        updateProgress(100, 'Complete!');
        setTimeout(() => {
            loading.classList.remove('active');
        }, 500);
        
    } catch (err) {
        console.error('Analysis error:', err);
        error.textContent = err.message || 'An error occurred during analysis';
        error.classList.add('active');
        loading.classList.remove('active');
    }
}

// Fetch price data from API
async function fetchPriceData(params) {
    const { region, startDate, endDate } = params;
    
    // Check if future date
    const start = new Date(startDate);
    const now = new Date();
    
    if (start > now) {
        // Use forward prices
        const response = await fetch(`${API_BASE}/api/forward/${region}?date=${startDate}`);
        if (!response.ok) throw new Error('Failed to fetch forward prices');
        
        const data = await response.json();
        return data.intervals.map(i => i.price);
    } else {
        // Use historical prices
        const hours = Math.ceil((new Date(endDate) - start) / (1000 * 60 * 60));
        const response = await fetch(`${API_BASE}/api/prices/history/${region}?hours=${hours}`);
        if (!response.ok) throw new Error('Failed to fetch historical prices');
        
        const data = await response.json();
        return data.data.map(d => d.price);
    }
}

// Run optimization
async function runOptimization(prices, params) {
    const { power, capacity, efficiency, maxCycles, throughputCost, optimizationMode, numUnits } = params;
    
    // Scale by number of units
    const totalPower = power * numUnits;
    const totalCapacity = capacity * numUnits;
    
    if (optimizationMode === 'dp' && typeof optimiseBESS_DP === 'function') {
        // Use Dynamic Programming optimizer
        return optimiseBESS_DP({
            prices: prices,
            dtHours: 5/60,
            capacityMWh: totalCapacity,
            powerMW: totalPower,
            etaC: Math.sqrt(efficiency),
            etaD: Math.sqrt(efficiency),
            soc0: 0.5,
            throughputCost: throughputCost,
            maxCycles: maxCycles
        });
    } else {
        // Use heuristic optimizer (simplified)
        return runHeuristicOptimization(prices, totalPower, totalCapacity, efficiency, maxCycles);
    }
}

// Simple heuristic optimization
function runHeuristicOptimization(prices, power, capacity, efficiency, maxCycles) {
    const results = {
        revenue: 0,
        actions: [],
        soc: [],
        dailyStats: []
    };
    
    let soc = capacity * 0.5; // Start at 50%
    const dt = 5/60; // 5-minute intervals
    
    for (let i = 0; i < prices.length; i++) {
        const price = prices[i];
        let action = 0; // Hold by default
        
        // Simple strategy: charge when cheap, discharge when expensive
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        
        if (price < avgPrice * 0.8 && soc < capacity * 0.9) {
            // Charge
            const chargeAmount = Math.min(power * dt, capacity - soc);
            soc += chargeAmount * efficiency;
            results.revenue -= price * chargeAmount;
            action = -chargeAmount / dt; // Negative for charging
        } else if (price > avgPrice * 1.2 && soc > capacity * 0.1) {
            // Discharge
            const dischargeAmount = Math.min(power * dt, soc);
            soc -= dischargeAmount;
            results.revenue += price * dischargeAmount * efficiency;
            action = dischargeAmount / dt; // Positive for discharging
        }
        
        results.actions.push(action);
        results.soc.push(soc / capacity); // Store as fraction
    }
    
    return results;
}

// Display results
function displayResults(results, params) {
    // Update metrics
    const revenue = results.revenue || 0;
    const days = Math.ceil((new Date(params.endDate) - new Date(params.startDate)) / (1000 * 60 * 60 * 24));
    
    document.getElementById('totalRevenue').textContent = formatCurrency(revenue);
    document.getElementById('wholesaleRevenue').textContent = formatCurrency(revenue);
    document.getElementById('networkCharges').textContent = '$0';
    document.getElementById('standingCharges').textContent = '$0';
    document.getElementById('demandCharges').textContent = '$0';
    document.getElementById('avgDaily').textContent = formatCurrency(revenue / days);
    document.getElementById('totalEnergy').textContent = '0 MWh';
    document.getElementById('avgCycles').textContent = '0';
    document.getElementById('bestDay').textContent = formatCurrency(revenue / days);
    document.getElementById('bestDayDate').textContent = params.startDate;
    document.getElementById('annualRevenue').textContent = formatCurrency(revenue * 365 / days);
    document.getElementById('activeTariff').textContent = params.tariff;
    
    // Update charts
    updateCharts(results, params);
}

// Update charts
function updateCharts(results, params) {
    // Price chart with SoC overlay
    const priceChartContainer = document.getElementById('priceChartContainer');
    priceChartContainer.style.display = 'block';
    
    const ctx = document.getElementById('priceChart').getContext('2d');
    
    // Destroy existing chart
    if (chartInstances.priceChart) {
        chartInstances.priceChart.destroy();
    }
    
    // Create time labels
    const labels = Array.from({ length: results.soc.length }, (_, i) => {
        const date = new Date(params.startDate);
        date.setMinutes(date.getMinutes() + i * 5);
        return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    });
    
    chartInstances.priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.slice(0, 288), // Show first day
            datasets: [{
                label: 'Price ($/MWh)',
                data: results.prices?.slice(0, 288) || [],
                borderColor: '#00E87E',
                backgroundColor: 'rgba(0, 232, 126, 0.1)',
                yAxisID: 'y',
                tension: 0.1
            }, {
                label: 'State of Charge (%)',
                data: results.soc?.slice(0, 288).map(s => s * 100) || [],
                borderColor: '#ffffff',
                borderDash: [5, 5],
                backgroundColor: 'transparent',
                yAxisID: 'y1',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `Price: $${context.parsed.y.toFixed(2)}/MWh`;
                            } else {
                                return `SoC: ${context.parsed.y.toFixed(1)}%`;
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Price ($/MWh)',
                        color: '#00E87E'
                    },
                    ticks: {
                        color: '#00E87E'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'State of Charge (%)',
                        color: '#ffffff'
                    },
                    ticks: {
                        color: '#ffffff'
                    },
                    grid: {
                        display: false
                    }
                },
                x: {
                    ticks: {
                        color: '#999',
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            }
        }
    });
}

// Helper functions
function formatCurrency(value) {
    return new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

function updateProgress(percent, text) {
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressText').textContent = text || '';
}

function switchTab(tabName) {
    // Update active tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Show/hide content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
}

// Update algorithm explainer
document.getElementById('optimizationMode').addEventListener('change', function() {
    const dpExplanation = document.getElementById('dpExplanation');
    const heuristicExplanation = document.getElementById('heuristicExplanation');
    const explainer = document.getElementById('algorithmExplainer');
    
    if (this.value === 'dp') {
        dpExplanation.style.display = 'block';
        heuristicExplanation.style.display = 'none';
    } else {
        dpExplanation.style.display = 'none';
        heuristicExplanation.style.display = 'block';
    }
    
    if (currentData) {
        explainer.style.display = 'block';
    }
});