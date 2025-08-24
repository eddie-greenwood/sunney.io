/**
 * Comprehensive AEMO Data Parser
 * Extracts market data from AEMO files:
 * 
 * DISPATCHIS files contain:
 * - Prices (PRICE records) with energy and FCAS prices including 1-second markets
 * - Regional demand/generation totals (REGIONSUM records)
 * - Interconnector flows (INTERCONNECTORRES records)
 * - Network constraints (CONSTRAINT records)
 * 
 * Generator data sources:
 * - SCADA files: Real-time output for ~473 generators (5-minute updates)
 * - Next_Day_Dispatch: Dispatch targets with ~145,000 UNIT_SOLUTION records (daily)
 * - Note: Regular DISPATCHIS files do NOT contain individual generator data
 */

import { unzipSync } from 'fflate';
import { TimeUtil } from '../../../shared/utils/time';

// ============================================
// INTERFACES FOR ALL DATA TYPES
// ============================================

export interface DispatchData {
  prices: DispatchPrice[];
  interconnectors: InterconnectorFlow[];
  constraints: Constraint[];
  fcas: FCASPrice[];
  generators: GeneratorDispatch[];
  caseInfo: CaseSolution | null;
  scadaUnits?: ScadaUnit[];  // Real-time generator output from SCADA
}

export interface DispatchPrice {
  region: string;
  rrp: number;
  eep: number;  // Export Excess Price
  rop: number;  // Regional Override Price
  apc_flag: number;  // Administered Price Cap flag
  settlement_date: string;
  price_status?: string;  // 'FIRM' or 'NOT FIRM' - indicates price finality
  lastchanged?: string;  // Timestamp when the record was last updated
  // Merged from REGIONSUM
  demand: number;
  generation: number;
  net_interchange: number;
  // FCAS prices inline
  raise6sec_rrp?: number;
  raise6sec_required?: number;
  raise60sec_rrp?: number;
  raise60sec_required?: number;
  raise5min_rrp?: number;
  raise5min_required?: number;
  raisereg_rrp?: number;
  raisereg_required?: number;
  lower6sec_rrp?: number;
  lower6sec_required?: number;
  lower60sec_rrp?: number;
  lower60sec_required?: number;
  lower5min_rrp?: number;
  lower5min_required?: number;
  lowerreg_rrp?: number;
  lowerreg_required?: number;
  // 1-second FCAS markets (new in 2023)
  raise1sec_rrp?: number;
  raise1sec_required?: number;
  lower1sec_rrp?: number;
  lower1sec_required?: number;
}

export interface RegionSolution {
  region: string;
  total_demand: number;
  available_generation: number;
  available_load: number;
  demand_forecast: number;
  dispatch_generation: number;
  net_interchange: number;
  // Additional fields
  initialsupply: number;
  clearedsupply: number;
  totalintermittentgeneration: number;
  demand_and_nonschedgen: number;
  uigf: number;  // Unconstrained Intermittent Generation Forecast
  settlement_date: string;
  // FCAS required values from REGIONSUM
  raise6sec_required: number;
  lower6sec_required: number;
  raise60sec_required: number;
  lower60sec_required: number;
  raise5min_required: number;
  lower5min_required: number;
  raisereg_required: number;
  lowerreg_required: number;
  // 1-second FCAS dispatch and availability
  raise1sec_dispatch: number;
  lower1sec_dispatch: number;
  raise1sec_availability: number;
  lower1sec_availability: number;
}

export interface InterconnectorFlow {
  interconnector_id: string;
  from_region: string;
  to_region: string;
  metered_mw_flow: number;
  mw_flow: number;
  mw_losses: number;
  import_limit: number;
  export_limit: number;
  marginal_value: number;
  violation_degree: number;
  settlement_date: string;
}

export interface Constraint {
  constraint_id: string;
  rhs: number;  // Right Hand Side
  marginal_value: number;
  violation_degree: number;
  settlement_date: string;
}

export interface FCASPrice {
  region: string;
  service: string;
  price: number;
  enablement_min: number;
  enablement_max: number;
  availability_payment: number;
  enabled_payment: number;
  availability_rebate: number;
  settlement_date: string;
}

export interface GeneratorDispatch {
  duid: string;  // Dispatchable Unit ID
  tradetype: number;
  agcstatus: number;
  initialmw: number;
  totalcleared: number;
  rampdownrate: number;
  rampuprate: number;
  lower5min: number;
  lower60sec: number;
  lower6sec: number;
  raise5min: number;
  raise60sec: number;
  raise6sec: number;
  lowerreg: number;
  raisereg: number;
  availability: number;
  semidispatch_cap: number;
  settlement_date: string;
  intervention: number;  // MMS DISPATCHLOAD field - 0=normal, 1=intervention pricing
}

export interface ScadaUnit {
  duid: string;  // Dispatchable Unit ID
  scadavalue: number;  // Actual MW output from SCADA
  settlement_date: string;
}

// ============================================
// BATTERY ENERGY STORAGE SYSTEM (BESS) DATA
// ============================================

export interface BatteryDispatch {
  duid: string;  // Battery Dispatchable Unit ID (BDU)
  agcstatus: number;  // AGC Status (0 = off, 1 = on)
  initialmw: number;  // Initial MW at start of interval
  totalcleared: number;  // Total cleared MW (charge + discharge)
  availability: number;  // Available MW capacity
  // Charge/Discharge tracking
  dispatchmode: number;  // 1 = discharge, -1 = charge, 0 = standby
  chargemw: number;  // MW charging (negative value)
  dischargemw: number;  // MW discharging (positive value)
  // Energy and efficiency
  energy_mwh: number;  // Current stored energy (MWh)
  soc_percent: number;  // State of Charge (0-100%)
  efficiency: number;  // Round-trip efficiency (typically 0.85-0.95)
  // Constraints
  maxcapacity_mwh: number;  // Maximum energy storage capacity
  maxcharge_mw: number;  // Maximum charge rate
  maxdischarge_mw: number;  // Maximum discharge rate
  // FCAS participation
  raise6sec: number;
  lower6sec: number;
  raise60sec: number;
  lower60sec: number;
  raise5min: number;
  lower5min: number;
  raisereg: number;
  lowerreg: number;
  raise1sec: number;
  lower1sec: number;
  // Market participation
  energy_bid_price: number;  // $/MWh bid/offer price
  fcas_availability: number;  // MW available for FCAS
  settlement_date: string;
  participant: string;  // Market participant ID
  station_name: string;  // Battery station name
  region: string;
}

export interface BatteryStateTracking {
  duid: string;
  timestamp: string;
  soc_percent: number;  // State of charge percentage
  energy_mwh: number;  // Current energy stored
  power_mw: number;  // Current power output (+discharge, -charge)
  mode: 'charging' | 'discharging' | 'standby';
  cycles_today: number;  // Number of charge/discharge cycles today
  degradation_factor: number;  // Battery health (1.0 = new, 0.8 = 80% health)
  temperature_c?: number;  // Battery temperature if available
  voltage_v?: number;  // DC voltage if available
  // Revenue tracking
  energy_revenue: number;  // $ from energy arbitrage
  fcas_revenue: number;  // $ from FCAS services
  capacity_revenue: number;  // $ from capacity payments
}

export interface BatteryConstraints {
  duid: string;
  // Physical constraints
  max_capacity_mwh: number;
  usable_capacity_mwh: number;  // Accounting for depth of discharge
  max_charge_mw: number;
  max_discharge_mw: number;
  min_soc_percent: number;  // Minimum allowed SoC (e.g., 10%)
  max_soc_percent: number;  // Maximum allowed SoC (e.g., 95%)
  // Operational constraints
  ramp_rate_mw_min: number;  // MW/min ramp rate
  min_runtime_minutes: number;  // Minimum run time when dispatched
  max_cycles_per_day: number;  // Maximum daily cycles
  // Market constraints
  bid_bands: BidBand[];  // Price/quantity bid bands
  fcas_enabled: boolean;
  network_constraints: string[];  // Active network constraint IDs
}

export interface BidBand {
  band_number: number;  // 1-10
  price: number;  // $/MWh
  quantity: number;  // MW
  type: 'energy' | 'fcas_raise' | 'fcas_lower';
}

// ============================================
// PREDISPATCH INTERFACES (2-DAY AHEAD)
// ============================================

export interface PredispatchData {
  regionSolutions: PredispatchRegionSolution[];
  unitSolutions: PredispatchUnitSolution[];
  interconnectorSolutions: PredispatchInterconnectorSolution[];
  constraintSolutions: PredispatchConstraintSolution[];
}

export interface PredispatchRegionSolution {
  interval_datetime: string;  // 30-minute intervals
  region: string;
  rrp: number;
  demand: number;
  available_generation: number;
  available_load: number;
  dispatchable_generation: number;
  net_interchange: number;
  // FCAS requirements
  raise_6sec_req: number;
  lower_6sec_req: number;
  raise_60sec_req: number;
  lower_60sec_req: number;
  raise_5min_req: number;
  lower_5min_req: number;
  raise_reg_req: number;
  lower_reg_req: number;
  // Prices
  raise_6sec_price: number;
  lower_6sec_price: number;
  raise_60sec_price: number;
  lower_60sec_price: number;
  raise_5min_price: number;
  lower_5min_price: number;
  raise_reg_price: number;
  lower_reg_price: number;
}

export interface PredispatchUnitSolution {
  interval_datetime: string;
  duid: string;
  traded_energy: number;  // MWh for 30-min interval
  cleared_mw: number;  // Average MW
  agc_status: number;
  // FCAS enablement
  raise_6sec: number;
  lower_6sec: number;
  raise_60sec: number;
  lower_60sec: number;
  raise_5min: number;
  lower_5min: number;
  raise_reg: number;
  lower_reg: number;
}

export interface PredispatchInterconnectorSolution {
  interval_datetime: string;
  interconnector_id: string;
  flow_mw: number;
  losses_mw: number;
  export_limit: number;
  import_limit: number;
  marginal_value: number;
}

export interface PredispatchConstraintSolution {
  interval_datetime: string;
  constraint_id: string;
  rhs: number;
  marginal_value: number;
  violation_degree: number;
}

// ============================================
// ST PASA INTERFACES (7-DAY AHEAD)
// ============================================

export interface StPasaData {
  regionSolutions: StPasaRegionSolution[];
  unitAvailability: StPasaUnitAvailability[];
}

export interface StPasaRegionSolution {
  interval_datetime: string;  // 30-minute intervals
  region: string;
  demand_forecast: number;
  demand_10_percent: number;  // 10th percentile
  demand_50_percent: number;  // 50th percentile
  demand_90_percent: number;  // 90th percentile
  scheduled_generation: number;
  semi_scheduled_generation: number;
  net_interchange: number;
  reserve_requirement: number;
  reserve_available: number;
  surplus_reserve: number;
  low_reserve_condition: number;  // 0 = normal, 1 = LRC
  lack_of_reserve: number;  // 0 = normal, 1-3 = LOR levels
}

export interface StPasaUnitAvailability {
  interval_datetime: string;
  duid: string;
  pasa_availability: number;  // MW available
  latest_offer_datetime: string;
  energy_availability: number;
  raise_reg_availability: number;
  lower_reg_availability: number;
  agc_available: boolean;
  dispatch_type: string;  // 'GENERATOR', 'LOAD', 'BIDIRECTIONAL'
  max_capacity: number;
  current_mode: string;  // For batteries: 'GENERATOR' or 'LOAD'
}

// ============================================
// P5MIN PREDISPATCH INTERFACES
// ============================================

export interface P5MinData {
  regionSolutions: P5MinRegionSolution[];
  unitSolutions: P5MinUnitSolution[];
  caseInfo: P5MinCaseSolution | null;
}

export interface P5MinRegionSolution {
  interval_datetime: string;
  region: string;
  rrp: number;
  eep: number;  // Excess energy price
  total_demand: number;
  available_generation: number;
  available_load: number;
  dispatchable_generation: number;
  dispatchable_load: number;
  net_interchange: number;
  // FCAS requirements
  raise6sec_req?: number;
  raise60sec_req?: number;
  raise5min_req?: number;
  raisereg_req?: number;
  lower6sec_req?: number;
  lower60sec_req?: number;
  lower5min_req?: number;
  lowerreg_req?: number;
  raise1sec_req?: number;
  lower1sec_req?: number;
  // FCAS prices
  raise6sec_price?: number;
  raise60sec_price?: number;
  raise5min_price?: number;
  raisereg_price?: number;
  lower6sec_price?: number;
  lower60sec_price?: number;
  lower5min_price?: number;
  lowerreg_price?: number;
  raise1sec_price?: number;
  lower1sec_price?: number;
}

export interface P5MinUnitSolution {
  interval_datetime: string;
  duid: string;
  agc_status: number;
  energy: number;
  raise6sec: number;
  raise60sec: number;
  raise5min: number;
  raisereg: number;
  lower6sec: number;
  lower60sec: number;
  lower5min: number;
  lowerreg: number;
  raise1sec?: number;
  lower1sec?: number;
}

export interface P5MinCaseSolution {
  interval_datetime: string;
  run_no: number;
  intervention: number;
  objective_function: number;
  total_violation: number;
}

// ============================================
// TRADING INTERFACES (30-minute intervals)
// ============================================

export interface TradingData {
  prices: TradingPrice[];
  regionSums: TradingRegionSum[];
}

export interface TradingPrice {
  settlement_date: string;
  run_no: number;
  region: string;
  period_id: number;
  rrp: number;
  eep: number;
  rop: number;
  apc_flag?: number;
  // FCAS prices
  raise6sec_rrp?: number;
  raise60sec_rrp?: number;
  raise5min_rrp?: number;
  raisereg_rrp?: number;
  lower6sec_rrp?: number;
  lower60sec_rrp?: number;
  lower5min_rrp?: number;
  lowerreg_rrp?: number;
  raise1sec_rrp?: number;
  lower1sec_rrp?: number;
  // Metadata
  price_status?: string;
  lastchanged?: string;
  invalid_flag?: string;
}

export interface TradingRegionSum {
  settlement_date: string;
  run_no: number;
  region: string;
  period_id: number;
  total_demand: number;
  available_generation: number;
  available_load: number;
  demand_forecast: number;
  dispatchable_generation: number;
  dispatchable_load: number;
  net_interchange: number;
  excess_generation: number;
  // FCAS dispatch values
  lowerreg_dispatch?: number;
  raisereg_dispatch?: number;
  lower5min_dispatch?: number;
  raise5min_dispatch?: number;
  lastchanged?: string;
}

export interface CaseSolution {
  settlement_date: string;
  run_no: number;
  intervention: number;
  solution_status: number;
  spdversion: string;
  nonphysicallosses: number;
  totalobjective: number;
  totalareagenviolation: number;
  totalinterconnectorviolation: number;
  totalgenericviolation: number;
  totalramprateviolation: number;
  totalunitmwcapacityviolation: number;
  total5minviolation: number;
  totalregtypeviolation: number;
  total6secviolation: number;
  total60secviolation: number;
  totalenergyofferviolation: number;
  totalasprofileviolation: number;
  totalfaststartviolation: number;
  totalenergyconstrviolation: number;
}

// ============================================
// FIELD MAPPING HELPERS
// ============================================

interface FieldMap {
  [key: string]: number;
}

/**
 * Build a field map from CSV header row
 * Maps field names to their column indices for dynamic field access
 */
function buildFieldMap(headerFields: string[]): FieldMap {
  const fieldMap: FieldMap = {};
  for (let i = 0; i < headerFields.length; i++) {
    const fieldName = headerFields[i].trim().toUpperCase();
    if (fieldName) {
      fieldMap[fieldName] = i;
    }
  }
  return fieldMap;
}

/**
 * Validate price is within AEMO caps
 * Market Price Cap: $16,600/MWh
 * Market Floor Price: -$1,000/MWh
 */
function validatePrice(price: number, fieldName: string): number {
  const PRICE_CAP = 16600;
  const PRICE_FLOOR = -1000;
  
  if (price > PRICE_CAP) {
    console.warn(`${fieldName} exceeds price cap: $${price} > $${PRICE_CAP}`);
    return PRICE_CAP;
  }
  if (price < PRICE_FLOOR) {
    console.warn(`${fieldName} below price floor: $${price} < $${PRICE_FLOOR}`);
    return PRICE_FLOOR;
  }
  return price;
}

/**
 * Validate demand/generation values
 */
function validateMW(value: number, fieldName: string): number {
  const MAX_DEMAND = 50000; // Max NEM demand ~35GW, allow headroom
  const MIN_VALUE = -10000; // Allow negative for exports
  
  if (value > MAX_DEMAND) {
    console.warn(`${fieldName} exceeds max: ${value}MW > ${MAX_DEMAND}MW`);
    return MAX_DEMAND;
  }
  if (value < MIN_VALUE) {
    console.warn(`${fieldName} below min: ${value}MW < ${MIN_VALUE}MW`);
    return MIN_VALUE;
  }
  return value;
}

// ============================================
// MAIN PARSING FUNCTION
// ============================================

export async function parseComprehensiveDispatchData(arrayBuffer: ArrayBuffer): Promise<DispatchData> {
  try {
    console.log('Parsing comprehensive dispatch data, size:', arrayBuffer.byteLength);
    
    // Extract CSV from ZIP
    const csvContent = await extractCSVFromZip(arrayBuffer);
    if (!csvContent) {
      throw new Error('No CSV found in ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    // Initialize result containers
    const result: DispatchData = {
      prices: [],
      interconnectors: [],
      constraints: [],
      fcas: [],
      generators: [],
      caseInfo: null
    };
    
    // Temporary storage for region data (to be merged)
    const regionData: Map<string, RegionSolution> = new Map();
    const priceData: Map<string, DispatchPrice> = new Map();
    
    // Parse each line
    for (const line of lines) {
      // Skip comment and info lines
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      if (fields[0] !== 'D' || fields[1] !== 'DISPATCH') continue;
      
      const recordType = fields[2];
      
      switch (recordType) {
        case 'CASE_SOLUTION':
          result.caseInfo = parseCaseSolution(fields);
          break;
          
        case 'PRICE':
          const price = parsePrice(fields);
          if (price) {
            priceData.set(price.region, price);
          }
          break;
          
        case 'REGIONSUM':
          const region = parseRegionSum(fields);
          if (region) {
            regionData.set(region.region, region);
          }
          break;
          
        case 'INTERCONNECTORRES':
          const interconnector = parseInterconnector(fields);
          if (interconnector) {
            result.interconnectors.push(interconnector);
          }
          break;
          
        case 'CONSTRAINT':
          const constraint = parseConstraint(fields);
          if (constraint && constraint.marginal_value > 0) {  // Only binding constraints
            result.constraints.push(constraint);
          }
          break;
          
        case 'UNIT_SOLUTION':
          const generator = parseUnitSolution(fields);
          if (generator) {
            result.generators.push(generator);
          }
          break;
          
        // Note: UNIT_SOLUTION records are typically absent in regular DISPATCHIS files
        // This is normal - generator data comes from SCADA or Next_Day_Dispatch instead
      }
    }
    
    // Merge region data into prices
    for (const [region, price] of priceData) {
      const regionSol = regionData.get(region);
      if (regionSol) {
        // Merge demand/generation data
        price.demand = regionSol.total_demand;
        price.generation = regionSol.dispatch_generation;  // Use dispatch_generation, not available_generation
        price.net_interchange = regionSol.net_interchange;
        
        // Merge FCAS required values from REGIONSUM
        price.raise6sec_required = regionSol.raise6sec_required;
        price.lower6sec_required = regionSol.lower6sec_required;
        price.raise60sec_required = regionSol.raise60sec_required;
        price.lower60sec_required = regionSol.lower60sec_required;
        price.raise5min_required = regionSol.raise5min_required;
        price.lower5min_required = regionSol.lower5min_required;
        price.raisereg_required = regionSol.raisereg_required;
        price.lowerreg_required = regionSol.lowerreg_required;
        
        // Merge 1-second FCAS values from REGIONSUM
        price.raise1sec_required = regionSol.raise1sec_dispatch;  // Using dispatch as proxy for required
        price.lower1sec_required = regionSol.lower1sec_dispatch;
      }
      result.prices.push(price);
    }
    
    // Extract FCAS prices from PRICE records
    for (const price of result.prices) {
      extractFCASFromPrice(price, result.fcas);
    }
    
    // Enhanced logging with context about missing data
    console.log(`Parsed DISPATCHIS data:`);
    console.log(`  - ${result.prices.length} price records (${regionData.size} regions with data)`);
    console.log(`  - ${result.interconnectors.length} interconnector flows`);
    console.log(`  - ${result.constraints.length} binding constraints`);
    console.log(`  - ${result.fcas.length} FCAS prices (non-zero)`);
    console.log(`  - ${result.generators.length} generators${result.generators.length === 0 ? ' (normal - UNIT_SOLUTION typically absent in DISPATCHIS)' : ''}`);
    
    return result;
    
  } catch (error) {
    console.error('Error parsing comprehensive dispatch data:', error);
    throw error;
  }
}

// ============================================
// INDIVIDUAL RECORD PARSERS
// ============================================

function parseCaseSolution(fields: string[]): CaseSolution | null {
  if (fields.length < 25) return null;
  
  return {
    settlement_date: TimeUtil.parseAEMOToUTC(fields[4]),
    run_no: parseInt(fields[5] || '0'),
    intervention: parseInt(fields[6] || '0'),
    solution_status: parseInt(fields[8] || '0'),
    spdversion: fields[9] || '',
    nonphysicallosses: parseFloat(fields[10] || '0'),
    totalobjective: parseFloat(fields[11] || '0'),
    totalareagenviolation: parseFloat(fields[12] || '0'),
    totalinterconnectorviolation: parseFloat(fields[13] || '0'),
    totalgenericviolation: parseFloat(fields[14] || '0'),
    totalramprateviolation: parseFloat(fields[15] || '0'),
    totalunitmwcapacityviolation: parseFloat(fields[16] || '0'),
    total5minviolation: parseFloat(fields[17] || '0'),
    totalregtypeviolation: parseFloat(fields[18] || '0'),
    total6secviolation: parseFloat(fields[19] || '0'),
    total60secviolation: parseFloat(fields[20] || '0'),
    totalenergyofferviolation: parseFloat(fields[21] || '0'),
    totalasprofileviolation: parseFloat(fields[22] || '0'),
    totalfaststartviolation: parseFloat(fields[23] || '0'),
    totalenergyconstrviolation: parseFloat(fields[24] || '0')
  };
}

function parsePrice(fields: string[]): DispatchPrice | null {
  // PRICE record has 70+ fields with 1-second FCAS and PRE_AP prices
  if (fields.length < 65) return null;  // Minimum for core fields including 1-sec FCAS
  
  const regionId = fields[6];  // REGIONID at position 6
  if (!regionId) return null;
  
  // Based on actual CSV header positions (0-indexed):
  // Field positions verified from AEMO DISPATCHIS CSV header
  return {
    region: regionId,
    rrp: validatePrice(parseFloat(fields[9] || '0'), 'RRP'),   // RRP at position 9
    eep: validatePrice(parseFloat(fields[10] || '0'), 'EEP'),  // EEP at position 10
    rop: validatePrice(parseFloat(fields[11] || '0'), 'ROP'),  // ROP at position 11
    apc_flag: parseInt(fields[12] || '0'),  // APCFLAG at position 12
    settlement_date: TimeUtil.parseAEMOToUTC(fields[4]),  // SETTLEMENTDATE at position 4
    price_status: fields[39] || undefined,  // PRICE_STATUS at position 39
    lastchanged: fields[14] || undefined,  // LASTCHANGED at position 14
    // FCAS prices - correct positions from CSV header
    raise6sec_rrp: validatePrice(parseFloat(fields[15] || '0'), 'RAISE6SEC'),  // RAISE6SECRRP at 15
    raise6sec_required: 0,  // Will be merged from REGIONSUM
    lower6sec_rrp: validatePrice(parseFloat(fields[27] || '0'), 'LOWER6SEC'),  // LOWER6SECRRP at 27
    lower6sec_required: 0,  // Will be merged from REGIONSUM
    raise60sec_rrp: validatePrice(parseFloat(fields[18] || '0'), 'RAISE60SEC'),  // RAISE60SECRRP at 18
    raise60sec_required: 0,  // Will be merged from REGIONSUM
    lower60sec_rrp: validatePrice(parseFloat(fields[30] || '0'), 'LOWER60SEC'),  // LOWER60SECRRP at 30
    lower60sec_required: 0,  // Will be merged from REGIONSUM
    raise5min_rrp: validatePrice(parseFloat(fields[21] || '0'), 'RAISE5MIN'),  // RAISE5MINRRP at 21
    raise5min_required: 0,  // Will be merged from REGIONSUM
    lower5min_rrp: validatePrice(parseFloat(fields[33] || '0'), 'LOWER5MIN'),  // LOWER5MINRRP at 33
    lower5min_required: 0,  // Will be merged from REGIONSUM
    raisereg_rrp: validatePrice(parseFloat(fields[24] || '0'), 'RAISEREG'),  // RAISEREGRRP at 24
    raisereg_required: 0,  // Will be merged from REGIONSUM
    lowerreg_rrp: validatePrice(parseFloat(fields[36] || '0'), 'LOWERREG'),  // LOWERREGRRP at 36
    lowerreg_required: 0,  // Will be merged from REGIONSUM
    // 1-second FCAS prices (added in 2023)
    raise1sec_rrp: validatePrice(parseFloat(fields[49] || '0'), 'RAISE1SEC'),  // RAISE1SECRRP at 49
    raise1sec_required: 0,  // Will be merged from REGIONSUM
    lower1sec_rrp: validatePrice(parseFloat(fields[52] || '0'), 'LOWER1SEC'),  // LOWER1SECRRP at 52
    lower1sec_required: 0,  // Will be merged from REGIONSUM
    // Initialized, to be merged from REGIONSUM
    demand: 0,
    generation: 0,
    net_interchange: 0
  };
}

function parseRegionSum(fields: string[]): RegionSolution | null {
  if (fields.length < 123) return null;  // REGIONSUM has 123+ fields for 1-second FCAS
  
  const regionId = fields[6];
  if (!regionId) return null;
  
  return {
    region: regionId,
    total_demand: validateMW(parseFloat(fields[9] || '0'), 'TOTALDEMAND'),   // TOTALDEMAND at position 10 (1-indexed)
    available_generation: validateMW(parseFloat(fields[10] || '0'), 'AVAILABLEGENERATION'),
    available_load: validateMW(parseFloat(fields[11] || '0'), 'AVAILABLELOAD'),
    demand_forecast: validateMW(parseFloat(fields[12] || '0'), 'DEMANDFORECAST'),
    dispatch_generation: validateMW(parseFloat(fields[13] || '0'), 'DISPATCHGENERATION'),
    net_interchange: validateMW(parseFloat(fields[15] || '0'), 'NETINTERCHANGE'),  // Position 16 (1-indexed)
    initialsupply: validateMW(parseFloat(fields[32] || '0'), 'INITIALSUPPLY'),
    clearedsupply: validateMW(parseFloat(fields[33] || '0'), 'CLEAREDSUPPLY'),
    totalintermittentgeneration: validateMW(parseFloat(fields[104] || '0'), 'TOTALINTERMITTENTGENERATION'),  // TOTALINTERMITTENTGENERATION at 105 (1-indexed)
    demand_and_nonschedgen: validateMW(parseFloat(fields[105] || '0'), 'DEMAND_AND_NONSCHEDGEN'),
    uigf: validateMW(parseFloat(fields[106] || '0'), 'UIGF'),
    settlement_date: TimeUtil.parseAEMOToUTC(fields[4]),
    // FCAS required values from REGIONSUM - positions from actual CSV header
    raise6sec_required: parseFloat(fields[63] || '0'),  // RAISE6SECREQ at position 63
    lower6sec_required: parseFloat(fields[39] || '0'),  // LOWER6SECREQ at position 39
    raise60sec_required: parseFloat(fields[55] || '0'),  // RAISE60SECREQ at position 55
    lower60sec_required: parseFloat(fields[31] || '0'),  // LOWER60SECREQ at position 31
    raise5min_required: parseFloat(fields[47] || '0'),  // RAISE5MINREQ at position 47
    lower5min_required: parseFloat(fields[23] || '0'),  // LOWER5MINREQ at position 23
    raisereg_required: parseFloat(fields[77] || '0'),   // RAISEREGREQ at position 77
    lowerreg_required: parseFloat(fields[73] || '0'),   // LOWERREGREQ at position 73
    // 1-second FCAS dispatch and availability (verified positions)
    raise1sec_dispatch: parseFloat(fields[118] || '0'),  // RAISE1SECLOCALDISPATCH at 119 (1-indexed)
    lower1sec_dispatch: parseFloat(fields[119] || '0'),  // LOWER1SECLOCALDISPATCH at 120 (1-indexed)
    raise1sec_availability: parseFloat(fields[120] || '0'),  // RAISE1SECACTUALAVAILABILITY at 121 (1-indexed)
    lower1sec_availability: parseFloat(fields[121] || '0')   // LOWER1SECACTUALAVAILABILITY at 122 (1-indexed)
  };
}

function parseInterconnector(fields: string[]): InterconnectorFlow | null {
  if (fields.length < 18) return null;
  
  const interconnectorId = fields[6];
  if (!interconnectorId) return null;
  
  // Parse interconnector ID to get regions
  const { fromRegion, toRegion } = parseInterconnectorId(interconnectorId);
  
  return {
    interconnector_id: interconnectorId,
    from_region: fromRegion,
    to_region: toRegion,
    metered_mw_flow: parseFloat(fields[9] || '0'),
    mw_flow: parseFloat(fields[10] || '0'),
    mw_losses: parseFloat(fields[11] || '0'),
    marginal_value: parseFloat(fields[12] || '0'),
    violation_degree: parseFloat(fields[13] || '0'),
    import_limit: parseFloat(fields[16] || '0'),
    export_limit: parseFloat(fields[17] || '0'),
    settlement_date: TimeUtil.parseAEMOToUTC(fields[4])
  };
}

function parseConstraint(fields: string[]): Constraint | null {
  if (fields.length < 12) return null;
  
  const constraintId = fields[6];
  if (!constraintId) return null;
  
  return {
    constraint_id: constraintId,
    rhs: parseFloat(fields[9] || '0'),
    marginal_value: parseFloat(fields[10] || '0'),
    violation_degree: parseFloat(fields[11] || '0'),
    settlement_date: TimeUtil.parseAEMOToUTC(fields[4])
  };
}

function parseUnitSolution(fields: string[]): GeneratorDispatch | null {
  if (fields.length < 37) return null;
  
  const duid = fields[6];
  if (!duid) return null;
  
  return {
    duid: duid,
    tradetype: parseInt(fields[7] || '0'),
    intervention: parseInt(fields[8] || '0'),  // INTERVENTION field per MMS DISPATCHLOAD
    agcstatus: parseInt(fields[10] || '0'),
    initialmw: parseFloat(fields[11] || '0'),
    totalcleared: parseFloat(fields[12] || '0'),
    rampdownrate: parseFloat(fields[13] || '0'),
    rampuprate: parseFloat(fields[14] || '0'),
    lower5min: parseFloat(fields[15] || '0'),
    lower60sec: parseFloat(fields[16] || '0'),
    lower6sec: parseFloat(fields[17] || '0'),
    raise5min: parseFloat(fields[18] || '0'),
    raise60sec: parseFloat(fields[19] || '0'),
    raise6sec: parseFloat(fields[20] || '0'),
    lowerreg: parseFloat(fields[21] || '0'),
    raisereg: parseFloat(fields[22] || '0'),
    availability: parseFloat(fields[23] || '0'),
    semidispatch_cap: parseFloat(fields[36] || '0'),
    settlement_date: TimeUtil.parseAEMOToUTC(fields[4])
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseInterconnectorId(id: string): { fromRegion: string; toRegion: string } {
  // Common interconnector patterns
  const patterns: Record<string, [string, string]> = {
    'NSW1-QLD1': ['NSW1', 'QLD1'],
    'N-Q-MNSP1': ['NSW1', 'QLD1'],
    'VIC1-NSW1': ['VIC1', 'NSW1'],
    'V-N-MNSP1': ['VIC1', 'NSW1'],
    'V-SA': ['VIC1', 'SA1'],
    'V-S-MNSP1': ['VIC1', 'SA1'],
    'T-V-MNSP1': ['TAS1', 'VIC1'],
    'VIC1-TAS1': ['VIC1', 'TAS1']
  };
  
  for (const [pattern, regions] of Object.entries(patterns)) {
    if (id.includes(pattern) || id === pattern) {
      return { fromRegion: regions[0], toRegion: regions[1] };
    }
  }
  
  // Try to parse from ID directly
  const parts = id.split('-');
  if (parts.length >= 2) {
    return { fromRegion: parts[0], toRegion: parts[1] };
  }
  
  return { fromRegion: 'UNKNOWN', toRegion: 'UNKNOWN' };
}

function extractFCASFromPrice(price: DispatchPrice, fcasArray: FCASPrice[]): void {
  const services = [
    { name: 'RAISE1SEC', rrp: price.raise1sec_rrp, required: price.raise1sec_required },  // New 1-second
    { name: 'LOWER1SEC', rrp: price.lower1sec_rrp, required: price.lower1sec_required },  // New 1-second
    { name: 'RAISE6SEC', rrp: price.raise6sec_rrp, required: price.raise6sec_required },
    { name: 'LOWER6SEC', rrp: price.lower6sec_rrp, required: price.lower6sec_required },
    { name: 'RAISE60SEC', rrp: price.raise60sec_rrp, required: price.raise60sec_required },
    { name: 'LOWER60SEC', rrp: price.lower60sec_rrp, required: price.lower60sec_required },
    { name: 'RAISE5MIN', rrp: price.raise5min_rrp, required: price.raise5min_required },
    { name: 'LOWER5MIN', rrp: price.lower5min_rrp, required: price.lower5min_required },
    { name: 'RAISEREG', rrp: price.raisereg_rrp, required: price.raisereg_required },
    { name: 'LOWERREG', rrp: price.lowerreg_rrp, required: price.lowerreg_required }
  ];
  
  for (const service of services) {
    // Filter out non-zero FCAS prices to reduce storage
    if (service.rrp !== undefined && service.rrp !== 0) {
      fcasArray.push({
        region: price.region,
        service: service.name,
        price: service.rrp || 0,
        enablement_min: 0,  // Not available in DISPATCHIS
        enablement_max: service.required || 0,  // FCAS required MW from REGIONSUM
        availability_payment: 0,  // Not in DISPATCHIS
        enabled_payment: 0,  // Not in DISPATCHIS
        availability_rebate: 0,  // Not in DISPATCHIS
        settlement_date: price.settlement_date
      });
    }
  }
}

async function extractCSVFromZip(arrayBuffer: ArrayBuffer): Promise<string | null> {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    const unzipped = unzipSync(uint8Array);
    
    // Find CSV file
    for (const [filename, data] of Object.entries(unzipped)) {
      if (filename.toUpperCase().endsWith('.CSV')) {
        console.log(`Extracting CSV: ${filename}`);
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(data);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting CSV from ZIP:', error);
    return null;
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// ============================================
// NEXT DAY DISPATCH PARSER - Contains UNIT_SOLUTION records
// ============================================

export async function parseNextDayDispatch(arrayBuffer: ArrayBuffer): Promise<DispatchData> {
  try {
    console.log('Parsing Next Day Dispatch data, size:', arrayBuffer.byteLength);
    
    // Use the comprehensive parser since Next Day Dispatch has same structure
    // but with many more records including UNIT_SOLUTION
    const result = await parseComprehensiveDispatchData(arrayBuffer);
    
    // Log specific stats for Next Day Dispatch
    console.log(`Next Day Dispatch parsed:`);
    console.log(`  - ${result.generators.length} generator UNIT_SOLUTION records`);
    console.log(`  - ${result.constraints.length} constraints`);
    console.log(`  - ${result.prices.length} price records`);
    
    if (result.generators.length === 0) {
      console.warn('Warning: No UNIT_SOLUTION records found in Next Day Dispatch file');
    }
    
    return result;
    
  } catch (error) {
    console.error('Error parsing Next Day Dispatch data:', error);
    throw error;
  }
}

// ============================================
// SCADA PARSER - Real-time generator output
// ============================================

export async function parseSCADAData(arrayBuffer: ArrayBuffer): Promise<ScadaUnit[]> {
  try {
    console.log('Parsing SCADA data, size:', arrayBuffer.byteLength);
    
    // Extract CSV from ZIP
    const csvContent = await extractCSVFromZip(arrayBuffer);
    if (!csvContent) {
      throw new Error('No CSV found in SCADA ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const scadaUnits: ScadaUnit[] = [];
    
    // Parse each line
    for (const line of lines) {
      // Skip comment and info lines
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      if (fields[0] !== 'D' || fields[1] !== 'DISPATCH' || fields[2] !== 'UNIT_SCADA') continue;
      
      // Parse UNIT_SCADA record
      // D,DISPATCH,UNIT_SCADA,1,"2025/08/24 00:05:00",DUID,SCADAVALUE,"LASTCHANGED"
      const duid = fields[5];
      const scadavalue = parseFloat(fields[6] || '0');
      const settlementDate = TimeUtil.parseAEMOToUTC(fields[4]);
      
      if (duid) {
        scadaUnits.push({
          duid,
          scadavalue,
          settlement_date: settlementDate
        });
      }
    }
    
    console.log(`Parsed ${scadaUnits.length} SCADA unit records`);
    return scadaUnits;
    
  } catch (error) {
    console.error('Error parsing SCADA data:', error);
    throw error;
  }
}

// ============================================
// P5MIN PREDISPATCH PARSER
// ============================================

/**
 * Parse P5MIN predispatch data (5-minute ahead forecasts)
 * Provides forecast RRP, demand, and unit targets for next hour (12 intervals)
 */
export async function parseP5MinData(arrayBuffer: ArrayBuffer): Promise<P5MinData> {
  console.log('Parsing P5MIN data, size:', arrayBuffer.byteLength);
  
  const csvContent = await extractCSVFromZip(arrayBuffer);
  
  if (!csvContent) {
    throw new Error('No CSV found in P5MIN ZIP');
  }
  
  const lines = csvContent.split('\n').filter(line => line.trim());
  const regionSolutions: P5MinRegionSolution[] = [];
  const unitSolutions: P5MinUnitSolution[] = [];
  let caseInfo: P5MinCaseSolution | null = null;
  
  for (const line of lines) {
    if (line.startsWith('C,') || line.startsWith('I,')) continue;
    
    const fields = parseCSVLine(line);
    
    // P5MIN CASESOLUTION record
    if (fields[0] === 'D' && fields[1] === 'P5MIN' && fields[2] === 'CASESOLUTION') {
      const runNo = parseInt(fields[3] || '0');
      const intervalDatetime = fields[4];
      const intervention = parseInt(fields[5] || '0');
      const objFunction = parseFloat(fields[6] || '0');
      const totalViolation = parseFloat(fields[7] || '0');
      
      caseInfo = {
        interval_datetime: TimeUtil.parseAEMOToUTC(intervalDatetime),
        run_no: runNo,
        intervention: intervention,
        objective_function: objFunction,
        total_violation: totalViolation
      };
    }
    
    // P5MIN REGIONSOLUTION records
    // Format: D,P5MIN,REGIONSOLUTION,ver,RUN_DATETIME,INTERVENTION,INTERVAL_DATETIME,REGIONID,RRP,ROP,EXCESSGENERATION,...
    if (fields[0] === 'D' && fields[1] === 'P5MIN' && fields[2] === 'REGIONSOLUTION') {
      const intervalDatetime = fields[6];  // INTERVAL_DATETIME
      const regionId = fields[7];  // REGIONID
      const rrp = parseFloat(fields[8] || '0');  // RRP
      const rop = parseFloat(fields[9] || '0');  // ROP (Regional Override Price)
      const totalDemand = parseFloat(fields[26] || '0');  // TOTALDEMAND at position 26
      const availableGeneration = parseFloat(fields[27] || '0');  // AVAILABLEGENERATION
      const availableLoad = parseFloat(fields[28] || '0');  // AVAILABLELOAD
      const dispatchableGeneration = parseFloat(fields[30] || '0');  // DISPATCHABLEGENERATION
      const dispatchableLoad = parseFloat(fields[31] || '0');  // DISPATCHABLELOAD
      const netInterchange = parseFloat(fields[32] || '0');  // NETINTERCHANGE
      
      // FCAS requirements - these are at fixed positions in P5MIN
      const raise6secReq = parseFloat(fields[60] || '0');  // RAISE6SECREQ
      const raise60secReq = parseFloat(fields[55] || '0');  // RAISE60SECREQ
      const raise5minReq = parseFloat(fields[50] || '0');  // RAISE5MINREQ
      const raiseregReq = parseFloat(fields[72] || '0');  // RAISEREGREQ
      const lower6secReq = parseFloat(fields[45] || '0');  // LOWER6SECREQ
      const lower60secReq = parseFloat(fields[40] || '0');  // LOWER60SECREQ
      const lower5minReq = parseFloat(fields[37] || '0');  // LOWER5MINREQ
      const lowerregReq = parseFloat(fields[67] || '0');  // LOWERREGREQ
      const raise1secReq = 0;  // Not in standard P5MIN yet
      const lower1secReq = 0;  // Not in standard P5MIN yet
      
      // FCAS prices - these are the RRP fields for each service
      const raise6secPrice = parseFloat(fields[11] || '0');  // RAISE6SECRRP
      const raise60secPrice = parseFloat(fields[13] || '0');  // RAISE60SECRRP
      const raise5minPrice = parseFloat(fields[15] || '0');  // RAISE5MINRRP
      const raiseregPrice = parseFloat(fields[17] || '0');  // RAISEREGRRP
      const lower6secPrice = parseFloat(fields[19] || '0');  // LOWER6SECRRP
      const lower60secPrice = parseFloat(fields[21] || '0');  // LOWER60SECRRP
      const lower5minPrice = parseFloat(fields[23] || '0');  // LOWER5MINRRP
      const lowerregPrice = parseFloat(fields[25] || '0');  // LOWERREGRRP
      const raise1secPrice = parseFloat(fields[116] || '0');  // RAISE1SECRRP if present
      const lower1secPrice = parseFloat(fields[118] || '0');  // LOWER1SECRRP if present
      
      if (regionId && !isNaN(rrp)) {
        regionSolutions.push({
          interval_datetime: TimeUtil.parseAEMOToUTC(intervalDatetime),
          region: regionId,
          rrp: rrp,
          eep: rop,  // Using ROP as EEP equivalent in P5MIN
          total_demand: totalDemand,
          available_generation: availableGeneration,
          available_load: availableLoad,
          dispatchable_generation: dispatchableGeneration,
          dispatchable_load: dispatchableLoad,
          net_interchange: netInterchange,
          // FCAS requirements
          raise6sec_req: raise6secReq,
          raise60sec_req: raise60secReq,
          raise5min_req: raise5minReq,
          raisereg_req: raiseregReq,
          lower6sec_req: lower6secReq,
          lower60sec_req: lower60secReq,
          lower5min_req: lower5minReq,
          lowerreg_req: lowerregReq,
          raise1sec_req: raise1secReq,
          lower1sec_req: lower1secReq,
          // FCAS prices
          raise6sec_price: raise6secPrice,
          raise60sec_price: raise60secPrice,
          raise5min_price: raise5minPrice,
          raisereg_price: raiseregPrice,
          lower6sec_price: lower6secPrice,
          lower60sec_price: lower60secPrice,
          lower5min_price: lower5minPrice,
          lowerreg_price: lowerregPrice,
          raise1sec_price: raise1secPrice,
          lower1sec_price: lower1secPrice
        });
      }
    }
    
    // P5MIN UNITSOLUTION records
    // Format: D,P5MIN,UNITSOLUTION,<version>,<INTERVAL>,<DUID>,<AGC_STATUS>,<ENERGY>,<RAISE6SEC>,...
    if (fields[0] === 'D' && fields[1] === 'P5MIN' && fields[2] === 'UNITSOLUTION') {
      const intervalDatetime = fields[4];
      const duid = fields[5];
      const agcStatus = parseInt(fields[6] || '0');
      const energy = parseFloat(fields[7] || '0');
      const raise6sec = parseFloat(fields[8] || '0');
      const raise60sec = parseFloat(fields[9] || '0');
      const raise5min = parseFloat(fields[10] || '0');
      const raisereg = parseFloat(fields[11] || '0');
      const lower6sec = parseFloat(fields[12] || '0');
      const lower60sec = parseFloat(fields[13] || '0');
      const lower5min = parseFloat(fields[14] || '0');
      const lowerreg = parseFloat(fields[15] || '0');
      const raise1sec = parseFloat(fields[16] || '0');
      const lower1sec = parseFloat(fields[17] || '0');
      
      if (duid) {
        unitSolutions.push({
          interval_datetime: TimeUtil.parseAEMOToUTC(intervalDatetime),
          duid: duid,
          agc_status: agcStatus,
          energy: energy,
          raise6sec: raise6sec,
          raise60sec: raise60sec,
          raise5min: raise5min,
          raisereg: raisereg,
          lower6sec: lower6sec,
          lower60sec: lower60sec,
          lower5min: lower5min,
          lowerreg: lowerreg,
          raise1sec: raise1sec,
          lower1sec: lower1sec
        });
      }
    }
  }
  
  console.log(`P5MIN parsed:
  - ${regionSolutions.length} region forecasts
  - ${unitSolutions.length} unit forecasts
  - Case info: ${caseInfo ? 'present' : 'absent'}`);
  
  return {
    regionSolutions,
    unitSolutions,
    caseInfo
  };
}

// ============================================
// TRADING PARSER - 30-minute trading intervals
// ============================================

/**
 * Parse TRADINGIS data with dynamic field mapping
 * Uses CSV headers when available for robustness
 */
/**
 * Parse Battery Dispatch Data from DISPATCHLOAD records
 * Batteries appear in DISPATCHLOAD with negative values when charging
 */
export async function parseBatteryDispatchData(arrayBuffer: ArrayBuffer): Promise<BatteryDispatch[]> {
  try {
    const csvContent = await extractCSVFromZip(arrayBuffer);
    if (!csvContent) {
      console.log('No DISPATCHLOAD data found in ZIP');
      return [];
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const batteries: BatteryDispatch[] = [];
    const batteryDuids = getBatteryDUIDs();
    
    for (const line of lines) {
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // DISPATCHLOAD records: D,DISPATCH,LOAD,<version>,<SETTLEMENTDATE>,<DUID>,...
      if (fields[0] === 'D' && fields[1] === 'DISPATCH' && fields[2] === 'LOAD') {
        const duid = fields[5];
        
        // Check if this is a battery unit
        if (!batteryDuids.includes(duid)) continue;
        
        const totalcleared = parseFloat(fields[7] || '0');
        const mode = totalcleared < 0 ? -1 : totalcleared > 0 ? 1 : 0; // charging/discharging/standby
        
        batteries.push({
          duid: duid,
          agcstatus: parseInt(fields[19] || '0'),
          initialmw: parseFloat(fields[6] || '0'),
          totalcleared: totalcleared,
          availability: parseFloat(fields[21] || '0'),
          // Charge/Discharge tracking
          dispatchmode: mode,
          chargemw: mode === -1 ? Math.abs(totalcleared) : 0,
          dischargemw: mode === 1 ? totalcleared : 0,
          // Energy and efficiency - would need state tracking
          energy_mwh: 0, // Needs state tracking
          soc_percent: 0, // Needs calculation based on capacity
          efficiency: 0.9, // Default assumption
          // Constraints from registration data
          maxcapacity_mwh: getBatteryCapacity(duid),
          maxcharge_mw: getBatteryMaxCharge(duid),
          maxdischarge_mw: getBatteryMaxDischarge(duid),
          // FCAS from DISPATCHLOAD fields
          raise6sec: parseFloat(fields[8] || '0'),
          lower6sec: parseFloat(fields[9] || '0'),
          raise60sec: parseFloat(fields[10] || '0'),
          lower60sec: parseFloat(fields[11] || '0'),
          raise5min: parseFloat(fields[12] || '0'),
          lower5min: parseFloat(fields[13] || '0'),
          raisereg: parseFloat(fields[14] || '0'),
          lowerreg: parseFloat(fields[15] || '0'),
          raise1sec: parseFloat(fields[49] || '0'), // New 1-second markets
          lower1sec: parseFloat(fields[52] || '0'),
          // Market participation
          energy_bid_price: 0, // Would need BIDDAYOFFER data
          fcas_availability: parseFloat(fields[21] || '0'),
          settlement_date: TimeUtil.parseAEMOToUTC(fields[4]),
          participant: getParticipant(duid),
          station_name: getStationName(duid),
          region: getRegion(duid)
        });
      }
    }
    
    return batteries;
  } catch (error) {
    console.error('Error parsing battery dispatch data:', error);
    return [];
  }
}

// Helper functions for battery data
function getBatteryDUIDs(): string[] {
  // List of known battery DUIDs from our mapping
  return [
    'BALBATT1', 'BBATTERY1', 'BESS1', 'BWTR1', 'CAPBES1',
    'CHINBES1', 'DALNTH01', 'DARLNBES', 'GANBES1', 'GREENBES',
    'HAPPVBES', 'HAZBATT1', 'HPRL1', 'KENEDYB', 'KOORBAT1',
    'LKBONNY1', 'LATRBATT', 'MANUBAT1', 'MELABATT', 'PHILBES1',
    'QUEBATT1', 'RANGBAT1', 'RIVER1', 'RIVER2', 'TAILBES2',
    'TARONGBS', 'TEMPBAT1', 'TORRBES1', 'VICBATT1', 'WALLBATT',
    'WANDBAT1', 'WARATSB1', 'WDNSBAT1', 'ADELDES', 'BLYTHBAT',
    'BOULBAT1', 'BULGABAT', 'ERATBAT1', 'ADPBA1', 'BOWWBA1',
    'CBWWBA1', 'HVWWBA1'
  ];
}

function getBatteryCapacity(duid: string): number {
  // MWh capacity mapping (would be from registration data)
  const capacities: Record<string, number> = {
    'HPRL1': 194,  // Hornsdale Power Reserve
    'VICBATT1': 450,  // Victorian Big Battery
    'WARATSB1': 1680,  // Waratah Super Battery
    'ERATBAT1': 1770,  // Eraring Battery
    'TARONGBS': 600,  // Tarong Battery
    'WDNSBAT1': 510,  // Western Downs
    'TORRBES1': 250,  // Torrens Island
    'RANGBAT1': 400,  // Rangebank
    'GREENBES': 400,  // Greenbank
    'MELABATT': 400,  // Melbourne A1
    'KOORBAT1': 370,  // Koorangie
    'BLYTHBAT': 400,  // Blyth
    'BULGABAT': 34,  // Bulgana
    'TEMPBAT1': 291,  // Templers
    'LATRBATT': 200,  // Latrobe Valley
    'HAZBATT1': 162,  // Hazelwood
    'CHINBES1': 200,  // Chinchilla
    'MANUBAT1': 200,  // Mannum
    'CAPBES1': 200,  // Capital
    'WANDBAT1': 150,  // Wandoan South
    'RIVER1': 120,  // Riverina 1
    'RIVER2': 130,  // Riverina 2
    'BOULBAT1': 100,  // Bouldercombe
    'TAILBES2': 84,  // Tailem Bend 2
    'WALLBATT': 75,  // Wallgrove
    'GANBES1': 50,  // Gannawarra
    'DARLNBES': 50,  // Darlington Point
    'DALNTH01': 8,  // Dalrymple North
    'LKBONNY1': 52,  // Lake Bonney
    'HAPPVBES': 8.8,  // Happy Valley
    'PHILBES1': 10,  // Phillip Island
    'QUEBATT1': 20,  // Queanbeyan
    'ADELDES': 13,  // Adelaide Desalination
    'KENEDYB': 4,  // Kennedy Energy Park
    'BALBATT1': 30,  // Ballarat
    'BBATTERY1': 30,  // Ballarat (duplicate?)
    'BWTR1': 50,  // Broken Hill
  };
  return capacities[duid] || 100; // Default 100 MWh
}

function getBatteryMaxCharge(duid: string): number {
  // MW charge rate mapping
  const chargeRates: Record<string, number> = {
    'HPRL1': 150,
    'VICBATT1': 300,
    'WARATSB1': 850,
    'ERATBAT1': 460,
    'TARONGBS': 300,
    'WDNSBAT1': 255,
    // Add more as needed
  };
  return chargeRates[duid] || 50; // Default 50 MW
}

function getBatteryMaxDischarge(duid: string): number {
  // MW discharge rate mapping (often same as charge)
  return getBatteryMaxCharge(duid);
}

function getParticipant(duid: string): string {
  // Participant mapping
  const participants: Record<string, string> = {
    'HPRL1': 'NEOEN',
    'VICBATT1': 'NEOEN',
    'WARATSB1': 'AKAYSHA',
    'ERATBAT1': 'ORIGINENERGY',
    // Add more mappings
  };
  return participants[duid] || 'UNKNOWN';
}

function getStationName(duid: string): string {
  // Station name mapping from our DUID database
  const stations: Record<string, string> = {
    'HPRL1': 'Hornsdale Power Reserve',
    'VICBATT1': 'Victorian Big Battery',
    'WARATSB1': 'Waratah Super Battery',
    'ERATBAT1': 'Eraring Battery',
    'TARONGBS': 'Tarong Battery',
    // Add more mappings
  };
  return stations[duid] || duid;
}

function getRegion(duid: string): string {
  // Region mapping from our DUID database
  const regions: Record<string, string> = {
    'HPRL1': 'SA1',
    'VICBATT1': 'VIC1',
    'WARATSB1': 'NSW1',
    'ERATBAT1': 'NSW1',
    'TARONGBS': 'QLD1',
    // Add more mappings
  };
  return regions[duid] || 'NSW1';
}

/**
 * Parse PREDISPATCH data (2-day ahead forecasts)
 * 30-minute intervals covering next 48+ hours
 */
export async function parsePredispatchData(arrayBuffer: ArrayBuffer): Promise<PredispatchData> {
  try {
    const csvContent = await extractCSVFromZip(arrayBuffer);
    if (!csvContent) {
      throw new Error('No PREDISPATCH CSV found in ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const regionSolutions: PredispatchRegionSolution[] = [];
    const unitSolutions: PredispatchUnitSolution[] = [];
    const interconnectorSolutions: PredispatchInterconnectorSolution[] = [];
    const constraintSolutions: PredispatchConstraintSolution[] = [];
    
    for (const line of lines) {
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // PREDISPATCH_REGION_SOLUTION
      if (fields[0] === 'D' && fields[1] === 'PREDISPATCH' && fields[2] === 'REGION_SOLUTION') {
        const interval = TimeUtil.parseAEMOToUTC(fields[4]);
        const region = fields[6];
        
        regionSolutions.push({
          interval_datetime: interval,
          region: region,
          rrp: parseFloat(fields[8] || '0'),
          demand: parseFloat(fields[9] || '0'),
          available_generation: parseFloat(fields[10] || '0'),
          available_load: parseFloat(fields[11] || '0'),
          dispatchable_generation: parseFloat(fields[12] || '0'),
          net_interchange: parseFloat(fields[13] || '0'),
          // FCAS requirements
          raise_6sec_req: parseFloat(fields[14] || '0'),
          lower_6sec_req: parseFloat(fields[15] || '0'),
          raise_60sec_req: parseFloat(fields[16] || '0'),
          lower_60sec_req: parseFloat(fields[17] || '0'),
          raise_5min_req: parseFloat(fields[18] || '0'),
          lower_5min_req: parseFloat(fields[19] || '0'),
          raise_reg_req: parseFloat(fields[20] || '0'),
          lower_reg_req: parseFloat(fields[21] || '0'),
          // FCAS prices
          raise_6sec_price: parseFloat(fields[22] || '0'),
          lower_6sec_price: parseFloat(fields[23] || '0'),
          raise_60sec_price: parseFloat(fields[24] || '0'),
          lower_60sec_price: parseFloat(fields[25] || '0'),
          raise_5min_price: parseFloat(fields[26] || '0'),
          lower_5min_price: parseFloat(fields[27] || '0'),
          raise_reg_price: parseFloat(fields[28] || '0'),
          lower_reg_price: parseFloat(fields[29] || '0'),
        });
      }
      
      // PREDISPATCH_UNIT_SOLUTION
      if (fields[0] === 'D' && fields[1] === 'PREDISPATCH' && fields[2] === 'UNIT_SOLUTION') {
        const interval = TimeUtil.parseAEMOToUTC(fields[4]);
        const duid = fields[5];
        
        unitSolutions.push({
          interval_datetime: interval,
          duid: duid,
          traded_energy: parseFloat(fields[6] || '0'),
          cleared_mw: parseFloat(fields[7] || '0'),
          agc_status: parseInt(fields[8] || '0'),
          raise_6sec: parseFloat(fields[9] || '0'),
          lower_6sec: parseFloat(fields[10] || '0'),
          raise_60sec: parseFloat(fields[11] || '0'),
          lower_60sec: parseFloat(fields[12] || '0'),
          raise_5min: parseFloat(fields[13] || '0'),
          lower_5min: parseFloat(fields[14] || '0'),
          raise_reg: parseFloat(fields[15] || '0'),
          lower_reg: parseFloat(fields[16] || '0'),
        });
      }
      
      // PREDISPATCH_INTERCONNECTOR_SOLUTION
      if (fields[0] === 'D' && fields[1] === 'PREDISPATCH' && fields[2] === 'INTERCONNECTOR_SOLUTION') {
        const interval = TimeUtil.parseAEMOToUTC(fields[4]);
        
        interconnectorSolutions.push({
          interval_datetime: interval,
          interconnector_id: fields[5],
          flow_mw: parseFloat(fields[6] || '0'),
          losses_mw: parseFloat(fields[7] || '0'),
          export_limit: parseFloat(fields[8] || '0'),
          import_limit: parseFloat(fields[9] || '0'),
          marginal_value: parseFloat(fields[10] || '0'),
        });
      }
      
      // PREDISPATCH_CONSTRAINT_SOLUTION
      if (fields[0] === 'D' && fields[1] === 'PREDISPATCH' && fields[2] === 'CONSTRAINT_SOLUTION') {
        const interval = TimeUtil.parseAEMOToUTC(fields[4]);
        
        constraintSolutions.push({
          interval_datetime: interval,
          constraint_id: fields[5],
          rhs: parseFloat(fields[6] || '0'),
          marginal_value: parseFloat(fields[7] || '0'),
          violation_degree: parseFloat(fields[8] || '0'),
        });
      }
    }
    
    return {
      regionSolutions,
      unitSolutions,
      interconnectorSolutions,
      constraintSolutions
    };
  } catch (error) {
    console.error('Error parsing PREDISPATCH data:', error);
    throw error;
  }
}

/**
 * Parse ST PASA data (7-day ahead system adequacy)
 */
export async function parseStPasaData(arrayBuffer: ArrayBuffer): Promise<StPasaData> {
  try {
    const csvContent = await extractCSVFromZip(arrayBuffer);
    if (!csvContent) {
      throw new Error('No ST PASA CSV found in ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const regionSolutions: StPasaRegionSolution[] = [];
    const unitAvailability: StPasaUnitAvailability[] = [];
    
    for (const line of lines) {
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // STPASA_REGION_SOLUTION
      if (fields[0] === 'D' && fields[1] === 'STPASA' && fields[2] === 'REGION_SOLUTION') {
        const interval = TimeUtil.parseAEMOToUTC(fields[4]);
        const region = fields[5];
        
        regionSolutions.push({
          interval_datetime: interval,
          region: region,
          demand_forecast: parseFloat(fields[6] || '0'),
          demand_10_percent: parseFloat(fields[7] || '0'),
          demand_50_percent: parseFloat(fields[8] || '0'),
          demand_90_percent: parseFloat(fields[9] || '0'),
          scheduled_generation: parseFloat(fields[10] || '0'),
          semi_scheduled_generation: parseFloat(fields[11] || '0'),
          net_interchange: parseFloat(fields[12] || '0'),
          reserve_requirement: parseFloat(fields[13] || '0'),
          reserve_available: parseFloat(fields[14] || '0'),
          surplus_reserve: parseFloat(fields[15] || '0'),
          low_reserve_condition: parseInt(fields[16] || '0'),
          lack_of_reserve: parseInt(fields[17] || '0'),
        });
      }
      
      // STPASA_UNIT_AVAILABILITY
      if (fields[0] === 'D' && fields[1] === 'STPASA' && fields[2] === 'UNIT_AVAILABILITY') {
        const interval = TimeUtil.parseAEMOToUTC(fields[4]);
        const duid = fields[5];
        
        unitAvailability.push({
          interval_datetime: interval,
          duid: duid,
          pasa_availability: parseFloat(fields[6] || '0'),
          latest_offer_datetime: fields[7],
          energy_availability: parseFloat(fields[8] || '0'),
          raise_reg_availability: parseFloat(fields[9] || '0'),
          lower_reg_availability: parseFloat(fields[10] || '0'),
          agc_available: fields[11] === '1',
          dispatch_type: fields[12],
          max_capacity: parseFloat(fields[13] || '0'),
          current_mode: fields[14] || 'GENERATOR',
        });
      }
    }
    
    return {
      regionSolutions,
      unitAvailability
    };
  } catch (error) {
    console.error('Error parsing ST PASA data:', error);
    throw error;
  }
}

export async function parseTradingData(arrayBuffer: ArrayBuffer): Promise<TradingData> {
  try {
    console.log('Parsing TRADINGIS data, size:', arrayBuffer.byteLength);
    
    const csvContent = await extractCSVFromZip(arrayBuffer);
    if (!csvContent) {
      throw new Error('No CSV found in TRADINGIS ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const result: TradingData = {
      prices: [],
      regionSums: []
    };
    
    // Maps for dynamic field mapping per record type
    let priceFieldMap: FieldMap | null = null;
    let regionSumFieldMap: FieldMap | null = null;
    
    for (const line of lines) {
      if (line.startsWith('C,')) continue;  // Skip comments
      
      const fields = parseCSVLine(line);
      
      // Capture 'I' lines for headers/field maps
      if (fields[0] === 'I') {
        const recordType = fields[2];
        if (recordType === 'PRICE') {
          // Build field map from header, skipping first 4 fields (I,TRADING,PRICE,version)
          priceFieldMap = buildFieldMap(fields.slice(4));
          console.log('Built TRADING PRICE field map with', Object.keys(priceFieldMap).length, 'fields');
        } else if (recordType === 'REGIONSUM') {
          regionSumFieldMap = buildFieldMap(fields.slice(4));
          console.log('Built TRADING REGIONSUM field map with', Object.keys(regionSumFieldMap).length, 'fields');
        }
        continue;
      }
      
      // Data lines
      if (fields[0] !== 'D' || fields[1] !== 'TRADING') continue;
      
      const recordType = fields[2];
      
      if (recordType === 'PRICE') {
        const price = parseTradingPrice(fields, priceFieldMap);
        if (price) result.prices.push(price);
      } else if (recordType === 'REGIONSUM') {
        const regionSum = parseTradingRegionSum(fields, regionSumFieldMap);
        if (regionSum) result.regionSums.push(regionSum);
      }
    }
    
    console.log(`Parsed TRADINGIS data: ${result.prices.length} prices, ${result.regionSums.length} region sums`);
    
    return result;
    
  } catch (error) {
    console.error('Error parsing TRADINGIS data:', error);
    throw error;
  }
}

function parseTradingPrice(fields: string[], fieldMap: FieldMap | null): TradingPrice | null {
  if (fields.length < 30) return null;  // Minimum based on spec
  
  // Helper to get field by name with fallback to index
  const getField = (name: string, fallbackIndex: number): string => {
    if (fieldMap && fieldMap[name.toUpperCase()] !== undefined) {
      return fields[fieldMap[name.toUpperCase()] + 4] || '';  // +4 to account for header offset
    }
    return fields[fallbackIndex] || '';
  };
  
  const getFloatField = (name: string, fallbackIndex: number): number => {
    const value = getField(name, fallbackIndex);
    return parseFloat(value || '0');
  };
  
  const getIntField = (name: string, fallbackIndex: number): number => {
    const value = getField(name, fallbackIndex);
    return parseInt(value || '0');
  };
  
  const region = getField('REGIONID', 6);
  if (!region) return null;
  
  return {
    settlement_date: TimeUtil.parseAEMOToUTC(getField('SETTLEMENTDATE', 4)),
    run_no: getIntField('RUNNO', 5),
    region,
    period_id: getIntField('PERIODID', 7),
    rrp: validatePrice(getFloatField('RRP', 8), 'RRP'),
    eep: validatePrice(getFloatField('EEP', 9), 'EEP'),
    rop: validatePrice(getFloatField('ROP', 10), 'ROP'),
    apc_flag: getIntField('APCFLAG', 11),
    // FCAS prices - using similar positions as DISPATCH
    raise6sec_rrp: validatePrice(getFloatField('RAISE6SECRRP', 14), 'RAISE6SECRRP'),
    raise60sec_rrp: validatePrice(getFloatField('RAISE60SECRRP', 17), 'RAISE60SECRRP'),
    raise5min_rrp: validatePrice(getFloatField('RAISE5MINRRP', 20), 'RAISE5MINRRP'),
    raisereg_rrp: validatePrice(getFloatField('RAISEREGRRP', 23), 'RAISEREGRRP'),
    lower6sec_rrp: validatePrice(getFloatField('LOWER6SECRRP', 26), 'LOWER6SECRRP'),
    lower60sec_rrp: validatePrice(getFloatField('LOWER60SECRRP', 29), 'LOWER60SECRRP'),
    lower5min_rrp: validatePrice(getFloatField('LOWER5MINRRP', 32), 'LOWER5MINRRP'),
    lowerreg_rrp: validatePrice(getFloatField('LOWERREGRRP', 35), 'LOWERREGRRP'),
    raise1sec_rrp: fields.length > 48 ? validatePrice(getFloatField('RAISE1SECRRP', 48), 'RAISE1SECRRP') : undefined,
    lower1sec_rrp: fields.length > 51 ? validatePrice(getFloatField('LOWER1SECRRP', 51), 'LOWER1SECRRP') : undefined,
    price_status: getField('PRICE_STATUS', 38),
    lastchanged: getField('LASTCHANGED', 13),
    invalid_flag: getField('INVALIDFLAG', 39)
  };
}

function parseTradingRegionSum(fields: string[], fieldMap: FieldMap | null): TradingRegionSum | null {
  if (fields.length < 20) return null;
  
  const getField = (name: string, fallbackIndex: number): string => {
    if (fieldMap && fieldMap[name.toUpperCase()] !== undefined) {
      return fields[fieldMap[name.toUpperCase()] + 4] || '';
    }
    return fields[fallbackIndex] || '';
  };
  
  const getFloatField = (name: string, fallbackIndex: number): number => {
    const value = getField(name, fallbackIndex);
    return parseFloat(value || '0');
  };
  
  const getIntField = (name: string, fallbackIndex: number): number => {
    const value = getField(name, fallbackIndex);
    return parseInt(value || '0');
  };
  
  const region = getField('REGIONID', 6);
  if (!region) return null;
  
  return {
    settlement_date: TimeUtil.parseAEMOToUTC(getField('SETTLEMENTDATE', 4)),
    run_no: getIntField('RUNNO', 5),
    region,
    period_id: getIntField('PERIODID', 7),
    total_demand: validateMW(getFloatField('TOTALDEMAND', 8), 'TOTALDEMAND'),
    available_generation: validateMW(getFloatField('AVAILABLEGENERATION', 9), 'AVAILABLEGENERATION'),
    available_load: validateMW(getFloatField('AVAILABLELOAD', 10), 'AVAILABLELOAD'),
    demand_forecast: validateMW(getFloatField('DEMANDFORECAST', 11), 'DEMANDFORECAST'),
    dispatchable_generation: validateMW(getFloatField('DISPATCHABLEGENERATION', 12), 'DISPATCHABLEGENERATION'),
    dispatchable_load: validateMW(getFloatField('DISPATCHABLELOAD', 13), 'DISPATCHABLELOAD'),
    net_interchange: validateMW(getFloatField('NETINTERCHANGE', 14), 'NETINTERCHANGE'),
    excess_generation: validateMW(getFloatField('EXCESSGENERATION', 15), 'EXCESSGENERATION'),
    lowerreg_dispatch: getFloatField('LOWERREGDISPATCH', 70),
    raisereg_dispatch: getFloatField('RAISEREGDISPATCH', 74),
    lower5min_dispatch: getFloatField('LOWER5MINDISPATCH', 16),
    raise5min_dispatch: getFloatField('RAISE5MINDISPATCH', 44),
    lastchanged: getField('LASTCHANGED', 100)
  };
}

// ============================================
// EXPORTS
// ============================================

export {
  parseCSVLine,
  extractCSVFromZip
};