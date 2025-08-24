// AEMO Data Parser - Handles ZIP files and CSV extraction
// This replaces the mock data generation with real parsing

import { unzipSync } from 'fflate';
import { TimeUtil } from '../../../shared/utils/time';

interface DispatchRecord {
  region: string;
  price: number;
  demand: number;
  generation: number;
  settlementDate: string;
}

interface ScadaRecord {
  duid: string;
  scadaValue: number;
  settlementDate: string;
}

/**
 * Parse AEMO dispatch ZIP file containing price and demand data
 * AEMO files have a specific CSV format with multiple record types
 */
export async function parseDispatchData(arrayBuffer: ArrayBuffer): Promise<DispatchRecord[]> {
  try {
    console.log('parseDispatchData: ArrayBuffer size:', arrayBuffer.byteLength);
    const csvContent = await extractCSVFromZip(arrayBuffer, 'DISPATCHIS');
    
    if (!csvContent) {
      throw new Error('No DISPATCHIS CSV found in ZIP');
    }
    
    console.log('parseDispatchData: CSV content length:', csvContent.length);
    
    // Parse CSV - AEMO format has multiple record types
    const lines = csvContent.split('\n').filter(line => line.trim());
    const results: DispatchRecord[] = [];
    
    for (const line of lines) {
      // Skip comment lines
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // DISPATCHPRICE records contain the actual price data
      // Format: D,DISPATCH,PRICE,<version>,<SETTLEMENTDATE>,<RUNNO>,<REGIONID>,<interval>,<intervention>,<RRP>,...
      if (fields[0] === 'D' && fields[1] === 'DISPATCH' && fields[2] === 'PRICE') {
        const settlementDate = fields[4]; 
        const regionId = fields[6];
        const rrp = parseFloat(fields[9] || '0'); // RRP is at position 9 (0-indexed)
        
        // Skip invalid data
        if (!regionId || isNaN(rrp)) continue;
        
        results.push({
          region: regionId,
          price: rrp,
          demand: 0, // Will be filled from REGIONSUM records
          generation: 0,
          settlementDate: TimeUtil.parseAEMOToUTC(settlementDate)
        });
      }
      
      // DISPATCHREGIONSUM records contain demand data
      // Format: D,DISPATCH,REGIONSUM,<version>,<SETTLEMENTDATE>,<RUNNO>,<REGIONID>,<interval>,<intervention>,<TOTALDEMAND>,<AVAILABLEGENERATION>,...
      if (fields[0] === 'D' && fields[1] === 'DISPATCH' && fields[2] === 'REGIONSUM') {
        const settlementDate = fields[4];
        const regionId = fields[6];
        const totalDemand = parseFloat(fields[9] || '0');  // Position 9 for total demand
        const availableGeneration = parseFloat(fields[10] || '0'); // Position 10 for available generation
        
        // Update matching price record with demand data
        const priceRecord = results.find(r => 
          r.region === regionId && 
          r.settlementDate === TimeUtil.parseAEMOToUTC(settlementDate)
        );
        
        if (priceRecord) {
          priceRecord.demand = totalDemand;
          priceRecord.generation = availableGeneration;
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error parsing dispatch data:', error);
    throw error;
  }
}

interface P5MinRecord {
  region: string;
  price: number;
  demand: number;
  interval: string;
  type: string;
}

/**
 * Parse P5MIN predispatch data
 */
export async function parseP5MinData(arrayBuffer: ArrayBuffer): Promise<P5MinRecord[]> {
  try {
    const csvContent = await extractCSVFromZip(arrayBuffer, 'P5MIN');
    
    if (!csvContent) {
      throw new Error('No P5MIN CSV found in ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const results: P5MinRecord[] = [];
    
    for (const line of lines) {
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // P5MIN_REGIONSOLUTION records
      // Format: D,P5MIN,REGIONSOLUTION,<version>,<INTERVAL>,<RUNNO>,<REGIONID>,...,<RRP>,...,<TOTALDEMAND>
      if (fields[0] === 'D' && fields[1] === 'P5MIN' && fields[2] === 'REGIONSOLUTION') {
        const interval = fields[4];
        const regionId = fields[6];
        const rrp = parseFloat(fields[9] || '0');
        const totalDemand = parseFloat(fields[10] || '0');
        
        if (!regionId || isNaN(rrp)) continue;
        
        results.push({
          region: regionId,
          price: rrp,
          demand: totalDemand,
          interval: TimeUtil.parseAEMOToUTC(interval),
          type: 'P5MIN'
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error parsing P5MIN data:', error);
    throw error;
  }
}

interface FCASRecord {
  region: string;
  service: string;
  price: number;
  enablement_min: number;
  enablement_max: number;
  settlement_date: string;
}

interface InterconnectorRecord {
  interconnector: string;
  from_region: string;
  to_region: string;
  flow_mw: number;
  losses_mw: number;
  limit_mw: number;
  settlement_date: string;
}

interface ConstraintRecord {
  constraint_id: string;
  rhs: number;
  marginal_value: number;
  violation_degree: number;
  settlement_date: string;
}

interface GeneratorScadaRecord {
  duid: string;
  scada_mw: number;
  settlement_date: string;
}

/**
 * Parse FCAS (Frequency Control Ancillary Services) data
 */
export async function parseFCASData(arrayBuffer: ArrayBuffer): Promise<FCASRecord[]> {
  try {
    const csvContent = await extractCSVFromZip(arrayBuffer, 'FCAS');
    
    if (!csvContent) {
      // Try alternate name patterns
      const altContent = await extractCSVFromZip(arrayBuffer, 'ANCILLARY');
      if (!altContent) {
        throw new Error('No FCAS CSV found in ZIP');
      }
      return parseFCASContent(altContent);
    }
    
    return parseFCASContent(csvContent);
  } catch (error) {
    console.error('Error parsing FCAS data:', error);
    throw error;
  }
}

function parseFCASContent(csvContent: string): FCASRecord[] {
  const lines = csvContent.split('\n').filter(line => line.trim());
  const results: FCASRecord[] = [];
  const services = [
    'RAISE6SEC', 'RAISE60SEC', 'RAISE5MIN', 'RAISEREG',
    'LOWER6SEC', 'LOWER60SEC', 'LOWER5MIN', 'LOWERREG'
  ];
  
  for (const line of lines) {
    if (line.startsWith('C,') || line.startsWith('I,')) continue;
    
    const fields = parseCSVLine(line);
    
    // FCAS price records in DISPATCH files
    // Format varies but typically: D,DISPATCH,FCAS_PRICE,...
    if (fields[0] === 'D' && fields[2] === 'FCAS_PRICE') {
      const settlementDate = fields[4];
      const regionId = fields[6];
      const service = fields[7];
      const price = parseFloat(fields[8] || '0');
      const enablementMin = parseFloat(fields[9] || '0');
      const enablementMax = parseFloat(fields[10] || '0');
      
      if (services.includes(service) && !isNaN(price)) {
        results.push({
          region: regionId,
          service: service,
          price: price,
          enablement_min: enablementMin,
          enablement_max: enablementMax,
          settlement_date: TimeUtil.parseAEMOToUTC(settlementDate)
        });
      }
    }
  }
  
  return results;
}

/**
 * Parse SCADA data for generator output
 */
export async function parseScadaData(arrayBuffer: ArrayBuffer): Promise<ScadaRecord[]> {
  try {
    console.log('parseScadaData: ArrayBuffer size:', arrayBuffer.byteLength);
    const csvContent = await extractCSVFromZip(arrayBuffer, 'DISPATCHSCADA');
    
    if (!csvContent) {
      throw new Error('No DISPATCHSCADA CSV found in ZIP');
    }
    
    console.log('parseScadaData: CSV content length:', csvContent.length);
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const results: ScadaRecord[] = [];
    
    for (const line of lines) {
      // Skip comment and header lines
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // UNIT_SCADA records: D,DISPATCH,UNIT_SCADA,1,settlementdate,DUID,SCADAVALUE
      if (fields[0] === 'D' && fields[1] === 'DISPATCH' && fields[2] === 'UNIT_SCADA') {
        const settlementDate = fields[4];
        const duid = fields[5];
        const scadaValue = parseFloat(fields[6] || '0');
        
        // Only include positive generation (negative = consumption)
        if (duid && !isNaN(scadaValue)) {
          results.push({
            duid: duid,
            scadaValue: scadaValue,
            settlementDate: TimeUtil.parseAEMOToUTC(settlementDate)
          });
        }
      }
    }
    
    console.log(`parseScadaData: Parsed ${results.length} SCADA records`);
    return results;
  } catch (error) {
    console.error('Error parsing SCADA data:', error);
    throw error;
  }
}

/**
 * Parse battery dispatch data from DISPATCHLOAD
 */
export async function parseBatteryDispatchData(arrayBuffer: ArrayBuffer): Promise<any[]> {
  try {
    console.log('parseBatteryDispatchData: ArrayBuffer size:', arrayBuffer.byteLength);
    const csvContent = await extractCSVFromZip(arrayBuffer, 'DISPATCHLOAD');
    
    if (!csvContent) {
      throw new Error('No DISPATCHLOAD CSV found in ZIP');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    const results: any[] = [];
    
    for (const line of lines) {
      if (line.startsWith('C,') || line.startsWith('I,')) continue;
      
      const fields = parseCSVLine(line);
      
      // DISPATCHLOAD records for batteries
      // D,DISPATCH,LOAD,2,settlementdate,duid,tradetype,dispatchmode,agcstatus,initialmw,totalcleared,rampdownrate,rampuprate,...
      if (fields[0] === 'D' && fields[1] === 'DISPATCH' && fields[2] === 'LOAD') {
        const settlementDate = fields[4];
        const duid = fields[5];
        const totalCleared = parseFloat(fields[10] || '0');
        
        // Only include battery units (BES, BATT in name)
        if (duid && (duid.includes('BES') || duid.includes('BATT') || duid.includes('BATTERY'))) {
          results.push({
            duid: duid,
            totalcleared: totalCleared,
            settlement_date: TimeUtil.parseAEMOToUTC(settlementDate),
            // Additional fields can be added as needed
            soc_percent: 0, // Would need separate data source
            energy_mwh: 0   // Would need separate data source
          });
        }
      }
    }
    
    console.log(`parseBatteryDispatchData: Parsed ${results.length} battery records`);
    return results;
  } catch (error) {
    console.error('Error parsing battery dispatch data:', error);
    throw error;
  }
}

/**
 * Extract CSV content from ZIP file using fflate
 */
async function extractCSVFromZip(arrayBuffer: ArrayBuffer, filePattern: string): Promise<string | null> {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    const unzipped = unzipSync(uint8Array);
    
    // AEMO files are named like PUBLIC_DISPATCHIS_*.CSV
    // We look for files containing DISPATCHIS regardless of prefix
    for (const [filename, data] of Object.entries(unzipped)) {
      const upperFilename = filename.toUpperCase();
      const upperPattern = filePattern.toUpperCase();
      
      // Check if this is the right type of file
      if (upperFilename.includes(upperPattern) && upperFilename.endsWith('.CSV')) {
        console.log(`Extracting CSV: ${filename} for pattern: ${filePattern}`);
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(data);
      }
    }
    
    // If no match, just take the first CSV file (AEMO ZIPs usually have just one)
    const csvFile = Object.keys(unzipped).find(f => f.toUpperCase().endsWith('.CSV'));
    if (csvFile) {
      console.log(`Using first CSV: ${csvFile} for pattern: ${filePattern}`);
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(unzipped[csvFile]);
    }
    
    console.log('Available files in ZIP:', Object.keys(unzipped));
    return null;
  } catch (error) {
    console.error('Error extracting CSV from ZIP:', error);
    return null;
  }
}

/**
 * Parse CSV line handling quoted fields
 */
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

/**
 * Handle truncated HTML from NEMWEB
 * NEMWEB sometimes returns incomplete HTML responses
 */
export async function fetchWithTruncationHandling(url: string, maxRetries = 3): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Check for truncation indicators
      const isTruncated = 
        !html.includes('</html>') || 
        !html.includes('</body>') ||
        html.length < 500 ||
        html.endsWith('...') ||
        html.includes('<!-- truncated');
      
      if (isTruncated) {
        console.log(`Truncated HTML detected (attempt ${attempt + 1}/${maxRetries}), length: ${html.length}`);
        
        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }
        
        // On last attempt, try to work with what we have
        console.log('Using partial HTML after max retries');
        return html;
      }
      
      return html;
      
    } catch (error) {
      console.error(`Fetch attempt ${attempt + 1} failed:`, error);
      
      if (attempt === maxRetries - 1) {
        throw error;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  
  throw new Error('Failed to fetch complete HTML after all retries');
}

/**
 * Extract ZIP file links from potentially truncated HTML
 */
export function extractZipLinksFromHTML(html: string): string[] {
  const links: string[] = [];
  
  // Multiple strategies for extracting links
  
  // Strategy 1: Standard href extraction
  const hrefRegex = /href=["']([^"']*\.zip)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    // Extract just the filename, not the full path
    const fullPath = match[1];
    const filename = fullPath.split('/').pop() || fullPath;
    links.push(filename);
  }
  
  // Strategy 2: Look for AEMO filename patterns even without href
  const filenameRegex = /PUBLIC_[A-Z]+_\d{12}_\d+\.zip/gi;
  while ((match = filenameRegex.exec(html)) !== null) {
    if (!links.includes(match[0])) {
      links.push(match[0]);
    }
  }
  
  // Strategy 3: Alternative patterns
  const altPatterns = [
    /DISPATCHIS_\d+\.zip/gi,
    /P5MIN_\d+\.zip/gi,
    /DISPATCH_SCADA_\d+\.zip/gi,
    /TRADINGIS_\d+\.zip/gi
  ];
  
  for (const pattern of altPatterns) {
    pattern.lastIndex = 0; // Reset regex
    while ((match = pattern.exec(html)) !== null) {
      if (!links.includes(match[0])) {
        links.push(match[0]);
      }
    }
  }
  
  // Filter out full URLs, we only want filenames
  return links
    .filter(link => !link.startsWith('http'))
    .filter(link => link.endsWith('.zip'))
    .filter((link, index, self) => self.indexOf(link) === index); // Remove duplicates
}

/**
 * Get latest file from a list of AEMO files
 * AEMO files have timestamps in their names
 */
export function getLatestFile(files: string[], pattern: string): string | null {
  const matchingFiles = files.filter(f => 
    f.toUpperCase().includes(pattern.toUpperCase())
  );
  
  if (matchingFiles.length === 0) {
    return null;
  }
  
  // Sort by embedded timestamp (files are like PUBLIC_DISPATCHIS_202401151430_0000001234.zip)
  return matchingFiles.sort((a, b) => {
    const timestampA = extractTimestamp(a);
    const timestampB = extractTimestamp(b);
    return timestampB - timestampA;
  })[0];
}

function extractTimestamp(filename: string): number {
  // Extract YYYYMMDDHHMI timestamp
  const match = filename.match(/(\d{12})/);
  if (!match) return 0;
  
  const ts = match[1];
  const year = parseInt(ts.substring(0, 4));
  const month = parseInt(ts.substring(4, 6));
  const day = parseInt(ts.substring(6, 8));
  const hour = parseInt(ts.substring(8, 10));
  const minute = parseInt(ts.substring(10, 12));
  
  return new Date(year, month - 1, day, hour, minute).getTime();
}