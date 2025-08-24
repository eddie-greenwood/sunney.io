// Test SCADA fetching
const AEMO_BASE = 'https://nemweb.com.au';

async function testScadaFetch() {
  const url = `${AEMO_BASE}/Reports/Current/Dispatch_SCADA/`;
  
  console.log('Fetching:', url);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  
  if (!response.ok) {
    console.error('Failed:', response.status);
    return;
  }
  
  const html = await response.text();
  console.log('HTML length:', html.length);
  
  // Extract ZIP file links
  const zipLinks = [];
  const linkRegex = /<a[^>]+href="([^"]+\.zip)"[^>]*>/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    zipLinks.push(match[1]);
  }
  
  console.log('Found ZIP files:', zipLinks.length);
  console.log('Sample files:', zipLinks.slice(0, 5));
  
  // Find DISPATCH_UNIT_SCADA files
  const scadaFiles = zipLinks.filter(f => 
    f.toUpperCase().includes('DISPATCH_UNIT_SCADA') || 
    f.toUpperCase().includes('DISPATCHSCADA')
  );
  
  console.log('SCADA files found:', scadaFiles.length);
  console.log('SCADA files:', scadaFiles.slice(0, 5));
  
  if (scadaFiles.length > 0) {
    const latestFile = scadaFiles.sort().pop();
    console.log('Latest SCADA file:', latestFile);
    
    // Try to download it
    const fileUrl = `${url}${latestFile}`;
    console.log('Downloading:', fileUrl);
    
    const fileResponse = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (fileResponse.ok) {
      const buffer = await fileResponse.arrayBuffer();
      console.log('Downloaded bytes:', buffer.byteLength);
    } else {
      console.error('Download failed:', fileResponse.status);
    }
  }
}

testScadaFetch().catch(console.error);