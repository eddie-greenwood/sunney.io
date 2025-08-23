// AEMO Data Parser - Handles ZIP files and CSV extraction
// This replaces the mock data generation with real parsing

import { parse } from 'csv-parse/sync';

/**
 * Parse AEMO dispatch ZIP file containing price and demand data
 * AEMO files have a specific CSV format with multiple record types
 */
export async function parseDispatchData(arrayBuffer: ArrayBuffer): Promise<any[]> {
  try {
    // Note: In Cloudflare Workers, we need to use a lightweight unzip
    // For now, using a simple implementation that works with CF Workers
    const csvContent = await extractCSVFromZip(arrayBuffer, 'DISPATCHIS');
    
    if (!csvContent) {
      throw new Error('No DISPATCHIS CSV found in ZIP');
    }
    
    // Parse CSV with AEMO's format (skip first row which is metadata)
    const lines = csvContent.split('\n');
    const dataLines = lines.slice(1); // Skip header info
    
    const results = [];
    
    for (const line of dataLines) {
      // AEMO CSVs use comma separation
      const fields = line.split(',');
      
      // Check if this is a PRICE record (D,DISPATCH,PRICE,...)
      if (fields[0] === 'D' && fields[2] === 'PRICE') {
        const settlementDate = fields[4]; // SETTLEMENTDATE
        const regionId = fields[6];       // REGIONID
        const rrp = parseFloat(fields[10]); // RRP (Regional Reference Price)
        
        // Additional fields if available
        const totalDemand = fields[11] ? parseFloat(fields[11]) : 0;
        const availableGeneration = fields[17] ? parseFloat(fields[17]) : 0;
        
        results.push({
          region: regionId,
          price: rrp,
          demand: totalDemand,
          generation: availableGeneration,
          settlementDate: formatAEMODate(settlementDate)
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error parsing dispatch data:', error);
    throw error;
  }
}

/**
 * Parse P5MIN predispatch data
 */
export async function parseP5MinData(arrayBuffer: ArrayBuffer): Promise<any[]> {
  try {
    const csvContent = await extractCSVFromZip(arrayBuffer, 'P5MIN');
    
    if (!csvContent) {
      throw new Error('No P5MIN CSV found in ZIP');
    }
    
    const lines = csvContent.split('\n');
    const dataLines = lines.slice(1);
    
    const results = [];
    
    for (const line of dataLines) {
      const fields = line.split(',');
      
      // P5MIN REGIONSOLUTION records
      if (fields[0] === 'D' && fields[2] === 'REGIONSOLUTION') {
        const interval = fields[4];
        const regionId = fields[6];
        const rrp = parseFloat(fields[10]);
        const totalDemand = parseFloat(fields[14]);
        
        results.push({
          region: regionId,
          price: rrp,
          demand: totalDemand,
          interval: formatAEMODate(interval),
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

/**
 * Parse FCAS (Frequency Control Ancillary Services) data
 */
export async function parseFCASData(arrayBuffer: ArrayBuffer): Promise<any[]> {
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

function parseFCASContent(csvContent: string): any[] {
  const lines = csvContent.split('\n');
  const dataLines = lines.slice(1);
  
  const results = [];
  const services = [
    'RAISE6SEC', 'RAISE60SEC', 'RAISE5MIN', 'RAISEREG',
    'LOWER6SEC', 'LOWER60SEC', 'LOWER5MIN', 'LOWERREG'
  ];
  
  for (const line of dataLines) {
    const fields = line.split(',');
    
    // FCAS price records
    if (fields[0] === 'D' && fields[2] === 'FCAS_PRICE') {
      const settlementDate = fields[4];
      const regionId = fields[6];
      const service = fields[8];
      const price = parseFloat(fields[10]);
      const enablementMin = parseFloat(fields[11] || '0');
      const enablementMax = parseFloat(fields[12] || '0');
      
      if (services.includes(service)) {
        results.push({
          region: regionId,
          service: service,
          price: price,
          enablement_min: enablementMin,
          enablement_max: enablementMax,
          settlement_date: formatAEMODate(settlementDate)
        });
      }
    }
  }
  
  return results;
}

/**
 * Extract CSV content from ZIP file
 * This is a simplified version for Cloudflare Workers
 * In production, use proper ZIP library
 */
async function extractCSVFromZip(arrayBuffer: ArrayBuffer, filePattern: string): Promise<string | null> {
  // Convert ArrayBuffer to Uint8Array
  const bytes = new Uint8Array(arrayBuffer);
  
  // Simple ZIP structure parsing (works for single-file ZIPs)
  // ZIP files have a specific structure with local file headers
  
  // Look for the file pattern in the ZIP
  const decoder = new TextDecoder();
  const fullContent = decoder.decode(bytes);
  
  // Find CSV content boundaries (simplified - assumes single CSV)
  // In production, use proper ZIP library like JSZip
  const csvStart = fullContent.indexOf('D,');
  if (csvStart === -1) {
    return null;
  }
  
  // Extract until the end of CSV data (before ZIP footer)
  let csvEnd = fullContent.indexOf('PK', csvStart); // Next ZIP header
  if (csvEnd === -1) {
    csvEnd = fullContent.length;
  }
  
  const csvContent = fullContent.substring(csvStart, csvEnd);
  
  // Clean up any binary artifacts
  return csvContent.replace(/[^\x20-\x7E\n\r]/g, '');
}

/**
 * Format AEMO date string to ISO format
 * AEMO format: "YYYY/MM/DD HH:MM:SS"
 * Output: ISO 8601
 */
function formatAEMODate(aemoDate: string): string {
  if (!aemoDate) return new Date().toISOString();
  
  // Handle AEMO format: "2024/01/15 14:30:00"
  const parts = aemoDate.trim().replace(/"/g, '').split(' ');
  if (parts.length !== 2) return aemoDate;
  
  const [datePart, timePart] = parts;
  const [year, month, day] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  
  // Create date in AEST (UTC+10)
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second || '0')
  );
  
  // Adjust for AEST to UTC (subtract 10 hours)
  date.setHours(date.getHours() - 10);
  
  return date.toISOString();
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
          'User-Agent': 'Mozilla/5.0 (compatible; AEMO-Scraper/1.0)',
          'Accept': 'text/html,application/xhtml+xml'
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
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    links.push(match[1]);
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
  const year = parseInt(ts.substr(0, 4));
  const month = parseInt(ts.substr(4, 2));
  const day = parseInt(ts.substr(6, 2));
  const hour = parseInt(ts.substr(8, 2));
  const minute = parseInt(ts.substr(10, 2));
  
  return new Date(year, month - 1, day, hour, minute).getTime();
}