AEMO Data Capture & Storage - Complete Technical Guide (Updated v2.0)
Overview
This scraper fetches comprehensive real-time and forecast energy market data from AEMO (Australian Energy Market Operator) every 5 minutes. AEMO operates the National Electricity Market (NEM) covering Queensland, New South Wales, ACT, Victoria, Tasmania, and South Australia. Updates align with AEMO's MMS Data Model v5.5, expanding to capture renewables (intermittent generation), generator details, constraints, and more for advanced analytics, price forecasting, and trading tools.

Table of Contents
Data Sources
Data Types Captured
CSV Format Specifications
Timezone Handling
Storage Schema
Processing Pipeline
Adding New Data Types
Troubleshooting
Data Sources
Primary AEMO URLs (Expanded)
text
Base URL: https://nemweb.com.au
├── /Reports/Current/DispatchIS_Reports/    # 5-minute dispatch prices, demand, generators, constraints
├── /Reports/Current/P5_Reports/            # 5-minute predispatch forecasts
├── /Reports/Current/TradingIS_Reports/     # Trading interval data (30-min settled prices)
├── /Reports/Current/Dispatch_SCADA/        # Real-time SCADA data for units/generators
├── /Reports/Current/Operational_Demand/    # Demand and intermittent (renewables) forecasts
├── /Reports/Current/PDPASA/                # Projected Assessment of System Adequacy (short-term forecasts)
├── /Data_Archive/Wholesale_Electricity/MMSDM/  # Historical backfill (monthly ZIPs with all data)
└── /Reports/Current/Bidmove_Complete/      # Generator bids and offers
File Naming Convention
AEMO files follow this pattern:

text
PUBLIC_<REPORT_TYPE>_<YYYYMMDDHHMI>_<SEQUENCE_NUMBER>.zip
Example: PUBLIC_DISPATCHIS_202403241905_0000000412345678.zip
For historical: MMSDM_<year>_<month>.zip containing CSVs for all tables.</month></year>

Data Types Captured (Expanded for Comprehensive Coverage)
Based on MMS Data Model v5.5 DISPATCH package, we've expanded to capture all key real-time data: prices, regionsums, interconnectors, constraints, unit solutions (generators), and case solutions. Added renewables forecasts, generator details, and bids for full analytics.

1. DISPATCH PRICES (Fully Implemented)
Frequency: Every 5 minutes
Source: /Reports/Current/DispatchIS_Reports/
File Pattern: PUBLIC_DISPATCHIS_*.zip
MMS Table: DISPATCHPRICE

Fields Captured (Aligned with MMS):
Field	Description	Unit	MMS Field Name	Position (0-indexed)	Example
region	NEM Region ID	-	REGIONID	6	NSW1
price	Regional Reference Price	$/MWh	RRP	9	134.85637
demand	Total Regional Demand (from REGIONSUM merge)	MW	TOTALDEMAND	9 (REGIONSUM)	9334.46
generation	Available Generation (from REGIONSUM merge)	MW	AVAILABLEGENERATION	10 (REGIONSUM)	11004.64122
net_interchange	Net Interchange (from REGIONSUM merge)	MW	NETINTERCHANGE	15 (REGIONSUM)	-123.45
settlement_date	Settlement Date (UTC)	UTC ISO	SETTLEMENTDATE	4	2025-08-23T09:05:00.000Z
intervention	Intervention Flag	0/1	INTERVENTION	8	0
rop	Raise Override Price	$/MWh	ROP	11	0
apc_flag	Administered Price Cap Flag	0/1	APCFLAG	12	0
raise6sec_rrp	Raise 6sec RRP	$/MW	RAISE6SECRRP	15	0.5
2. FCAS PRICES (Fully Implemented)
Frequency: Every 5 minutes
Source: Same DISPATCHIS files
Record Type: D,DISPATCH,PRICE (FCAS fields)
MMS Table: DISPATCHPRICE (FCAS RRPs)

FCAS Services (Aligned with MMS):
RAISE6SECRRP, RAISE60SECRRP, RAISE5MINRRP, RAISEREGBRP
LOWER6SECRRP, LOWER60SECRRP, LOWER5MINRRP, LOWERREGRRP
Fields: price (RRP), required (from REGIONSUM merge, e.g., RAISE6SECLOCALDISPATCH at position 16 in PRICE? Wait, PRICE has RRPs; REGIONSUM has LOCALDISPATCH for required).

3. P5MIN PREDISPATCH (Implemented)
Frequency: Every 5 minutes
Source: /Reports/Current/P5_Reports/
Purpose: 5-minute ahead price/demand forecasts
MMS Table: P5MIN_REGIONSOLUTION, P5MIN_PRICES

Fields: region, price, demand, interval_datetime, run_datetime.

4. INTERCONNECTOR FLOWS (Implemented)
Record Type: D,DISPATCH,INTERCONNECTORRES
MMS Table: DISPATCHINTERCONNECTORRES

Fields Captured:
Field	Description	Unit	MMS Field Name	Position	Example
interconnector_id	Interconnector ID	-	INTERCONNECTORID	6	NSW1-QLD1
metered_mw_flow	Metered MW Flow	MW	METEREDMWFLOW	9	450.23
mw_flow	MW Flow	MW	MWFLOW	10	450.0
mw_losses	MW Losses	MW	MWLOSSES	11	5.67
marginal_value	Marginal Value	$/MW	MARGINALVALUE	12	-0.5
violation_degree	Violation Degree	MW	VIOLATIONDEGREE	13	0
settlement_date	Settlement Date	UTC ISO	SETTLEMENTDATE	4	2025-08-23T09:05:00.000Z
Key Interconnectors: NSW1-QLD1, VIC1-NSW1, V-SA, T-V-MNSP1, V-S-MNSP1.

5. GENERATOR DISPATCH (New - Implemented)
Frequency: Every 5 minutes
Source: Same DISPATCHIS files
Record Type: D,DISPATCH,UNIT_SOLUTION
MMS Table: DISPATCHUNIT_SOLUTION

Fields Captured:
Field	Description	Unit	MMS Field Name	Position	Example
duid	Dispatchable Unit ID	-	DUID	6	AGLEA1
initialmw	Initial MW	MW	INITIALMW	11	100.0
totalcleared	Total Cleared	MW	TOTALCLEARED	12	120.5
rampdownrate	Ramp Down Rate	MW/min	RAMPDOWNRATE	13	5
rampuprate	Ramp Up Rate	MW/min	RAMPUPRATE	14	5
availability	Availability	MW	AVAILABILITY	23	150
settlement_date	Settlement Date	UTC ISO	SETTLEMENTDATE	4	2025-08-23T09:05:00.000Z
6. CONSTRAINTS (New - Implemented)
Record Type: D,DISPATCH,CONSTRAINT
MMS Table: DISPATCHCONSTRAINT

Fields Captured:
Field	Description	Unit	MMS Field Name	Position	Example
constraint_id	Constraint ID	-	CONSTRAINTID	6	Q>NIL_QLD1
rhs	Right Hand Side	-	RHS	9	500
marginal_value	Marginal Value	$/MW	MARGINALVALUE	10	10.5
violation_degree	Violation Degree	MW	VIOLATIONDEGREE	11	0
settlement_date	Settlement Date	UTC ISO	SETTLEMENTDATE	4	2025-08-23T09:05:00.000Z
7. INTERMITTENT GENERATION FORECASTS (New - For Renewables)
Frequency: Every 30 minutes
Source: /Reports/Current/Operational_Demand/
MMS Table: INTERMITTENT_GEN_FCST, INTERMITTENT_GEN_FCST_DATA

Fields: duid, run_datetime, interval_datetime, power_mean, power_poe10, power_poe50, power_poe90.

8. CASE SOLUTION (New - Dispatch Run Metadata)
Record Type: D,DISPATCH,CASE_SOLUTION
MMS Table: DISPATCHCASESOLUTION

Fields: settlement_date, run_no, intervention, solutionstatus, totalobjective, totalgenericviolation, etc.

9. DEMAND FORECAST (Expanded)
Source: /Reports/Current/Operational_Demand/
MMS Table: PERDEMAND, RESDEMANDTRK

Fields: region, forecast_date, forecast_demand, poe10, poe50, poe90.

10. GENERATOR BIDS (New)
Source: /Reports/Current/Bidmove_Complete/
MMS Table: BIDPEROFFER_D

Fields: duid, bidtype, periodid, bandavail1-10, bandprice1-10.

CSV Format Specifications (Updated with MMS Alignment)
AEMO CSV Structure
CSVs have headers (I lines) and data (D lines). All dates in AEST (convert to UTC).

Key Record Types in DISPATCHIS Files (Expanded)
PRICE Records
CSV Example:

csv
D,DISPATCH,PRICE,2,2025/08/23 19:05:00,1,NSW1,1,0,134.85637,0,0,0,...
Field Positions (0-indexed, per MMS):

4: SETTLEMENTDATE
6: REGIONID
9: RRP
15: RAISE6SECRRP
16: RAISE6SECROP (not required, but localdispatch in REGIONSUM at similar offsets for required).
REGIONSUM Records
Positions:

4: SETTLEMENTDATE
6: REGIONID
9: TOTALDEMAND
10: AVAILABLEGENERATION
15: NETINTERCHANGE
40: TOTALINTERMITTENTGENERATION (renewables proxy)
42: UIGF (Unconstrained Intermittent Gen Forecast)
INTERCONNECTORRES Records
Positions:

4: SETTLEMENTDATE
6: INTERCONNECTORID
9: METEREDMWFLOW
10: MWFLOW
11: MWLOSSES
12: MARGINALVALUE
16: IMPORTLIMIT
17: EXPORTLIMIT
CONSTRAINT Records
Positions:

4: SETTLEMENTDATE
6: CONSTRAINTID
9: RHS
10: MARGINALVALUE
11: VIOLATIONDEGREE
UNIT_SOLUTION Records
Positions:

4: SETTLEMENTDATE
6: DUID
11: INITIALMW
12: TOTALCLEARED
13: RAMPDOWNRATE
14: RAMPUPRATE
23: AVAILABILITY
36: SEMIDISPATCHCAP
CASE_SOLUTION Records
Positions:

4: SETTLEMENTDATE
5: RUNNO
6: INTERVENTION
8: SOLUTIONSTATUS
11: TOTALOBJECTIVE
14: TOTALGENERICVIOLATION
For other files (P5_Reports, etc.), similar structure with I headers listing fields.

Timezone Handling (Unchanged - Aligned)
All AEMO dates are AEST (UTC+10, no DST). Store as UTC ISO.

Storage Schema (Expanded)
Added tables for new types: generators_dispatch, constraints, intermittent_gen_fcst, case_solution, demand_forecast_detail, generator_bids.

dispatch_prices (Updated with MMS Fields)
sql
CREATE TABLE dispatch_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    rrp REAL NOT NULL,
    rop REAL,
    apc_flag INTEGER,
    demand REAL,
    generation REAL,
    net_interchange REAL,
    total_intermittent_generation REAL,  -- Renewables proxy
    uigf REAL,
    settlement_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(region, settlement_date)
);
fcas_prices (Updated)
sql
CREATE TABLE fcas_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    service TEXT NOT NULL,
    rrp REAL NOT NULL,
    rop REAL,
    required REAL,
    settlement_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(region, service, settlement_date)
);
generators_dispatch (New)
sql
CREATE TABLE generators_dispatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duid TEXT NOT NULL,
    initialmw REAL,
    totalcleared REAL,
    rampdownrate REAL,
    rampuprate REAL,
    availability REAL,
    semidispatch_cap REAL,
    settlement_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(duid, settlement_date)
);
constraints (New)
sql
CREATE TABLE constraints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    constraint_id TEXT NOT NULL,
    rhs REAL,
    marginal_value REAL,
    violation_degree REAL,
    settlement_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(constraint_id, settlement_date)
);
intermittent_gen_fcst (New)
sql
CREATE TABLE intermittent_gen_fcst (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duid TEXT NOT NULL,
    run_datetime TEXT NOT NULL,
    interval_datetime TEXT NOT NULL,
    power_mean REAL,
    power_poe10 REAL,
    power_poe50 REAL,
    power_poe90 REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(duid, interval_datetime, run_datetime)
);
case_solution (New)
sql
CREATE TABLE case_solution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_date TEXT NOT NULL UNIQUE,
    run_no INTEGER,
    intervention INTEGER,
    solution_status INTEGER,
    total_objective REAL,
    total_generic_violation REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
demand_forecast_detail (New)
sql
CREATE TABLE demand_forecast_detail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    forecast_date TEXT NOT NULL,
    forecast_demand REAL NOT NULL,
    poe10 REAL,
    poe50 REAL,
    poe90 REAL,
    run_datetime TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(region, forecast_date, run_datetime)
);
generator_bids (New)
sql
CREATE TABLE generator_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duid TEXT NOT NULL,
    bidtype TEXT NOT NULL,
    periodid INTEGER NOT NULL,
    bandavail1 REAL,
    bandprice1 REAL,
    -- ... up to band10
    bandavail10 REAL,
    bandprice10 REAL,
    settlement_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(duid, periodid, settlement_date)
);
KV Cache: Expand to "dispatch:latest" with full DispatchData JSON.

R2 Archive: Unchanged.

Processing Pipeline (Updated for New Types)
1-4: Unchanged (fetch HTML, extract links, find latest, download ZIP).

Extract & Parse CSV: Use comprehensive parser to extract all records.
Parse Records: Expanded switch for UNIT_SOLUTION, CONSTRAINT, CASE_SOLUTION.
Store in Database: Batch inserts for new tables; merge REGIONSUM into prices before insert.
For new sources (e.g., Operational_Demand): Add fetch functions, parse INTERMITTENT_GEN_FCST_DATA records.

Adding New Data Types (Updated with Examples)
Step 1-5: Unchanged.

Examples:

For Generator Bids: Source Bidmove_Complete; parse BIDPEROFFER_D records (positions: 4 SETTLEMENTDATE, 6 DUID, 7 BIDTYPE, 8 PERIODID, 9-28 BANDAVAIL1-10 and BANDPRICE1-10).
For Demand Forecast: Parse PERDEMAND (fields: PREDVALUE for forecast_demand, POE10, etc.).
Troubleshooting (Updated)
Add: Issue: Missing Records? Verify CSV has D lines for new types; check AEMO lag (up to 15 min for some).

Testing (Updated)
Add queries for new tables, e.g.:

bash
npx wrangler d1 execute sunney-market --command "SELECT * FROM generators_dispatch LIMIT 5" --remote
Performance Considerations (Updated)
Add: For high-volume (e.g., 1000+ generators per interval), use batch size <500 to avoid D1 limits.

AEMO Data Quality Notes (Updated)
Add: Intervention (1) means admin pricing; filter for analytics. Violations >0 indicate constraints binding.

Future Enhancements (Updated)
Add: Integrate MTPASA for long-term forecasts; backfill script using MMSDM archives.

References (Updated)
AEMO NEMWEB
MMS Data Model v5.5
AEMO Data Model Report
FCAS Guide