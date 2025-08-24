// Test PREDISPATCH fetching
const AEMO_BASE = 'https://nemweb.com.au';

async function testPredispatch() {
  const url = `${AEMO_BASE}/Reports/Current/PredispatchIS_Reports/`;
  
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
    const filename = match[1].split('/').pop() || match[1];
    zipLinks.push(filename);
  }
  
  console.log('Found ZIP files:', zipLinks.length);
  
  // Find PREDISPATCH files
  const predispatchFiles = zipLinks.filter(f => 
    f.toUpperCase().includes('PREDISPATCH')
  );
  
  console.log('PREDISPATCH files found:', predispatchFiles.length);
  console.log('Sample files:', predispatchFiles.slice(-5));
  
  if (predispatchFiles.length > 0) {
    const latestFile = predispatchFiles.sort().pop();
    console.log('Latest PREDISPATCH file:', latestFile);
  }
}

testPredispatch().catch(console.error);