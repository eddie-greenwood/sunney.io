#!/usr/bin/env node

// Script to update all apps to use new Sunney.io architecture
const fs = require('fs');
const path = require('path');

const APPS_DIR = path.join(__dirname, '../pages/public');
const OLD_ENDPOINTS = [
    'https://aemo-unified-source.eddie-37d.workers.dev',
    'https://nem-harvester.eddie-37d.workers.dev',
    'https://nem-archive-worker.eddie-37d.workers.dev',
    'https://letool-bess.eddie-37d.workers.dev'
];

const NEW_API = 'https://api.sunney.io';

// Files to update
const filesToUpdate = [
    'apps/trading/index.html',
    'apps/trading/trading.js',
    'apps/bess-optimizer/index.html',
    'apps/forward-lite/index.html',
    'apps/forward-lite/forward-lite.html',
    'apps/forward-lite/forward-lite-final.js',
    'dashboards/nem-live/index.html',
    'dashboards/nem-refined/index.html',
    'dashboards/aemo-full/index.html'
];

// Add authentication check to HTML files
const authScriptTag = `
    <!-- Sunney.io Authentication -->
    <script src="/assets/js/auth.js"></script>
    <script src="/assets/js/api-client.js"></script>
    <script>
        // Check authentication
        if (!window.sunneyAuth.requireAuth()) {
            // Redirect to login
        }
    </script>
`;

function updateFile(filePath) {
    const fullPath = path.join(APPS_DIR, filePath);
    
    if (!fs.existsSync(fullPath)) {
        console.log(`Skipping ${filePath} - file not found`);
        return;
    }
    
    let content = fs.readFileSync(fullPath, 'utf8');
    let updated = false;
    
    // Replace old endpoints
    OLD_ENDPOINTS.forEach(oldEndpoint => {
        if (content.includes(oldEndpoint)) {
            content = content.replace(new RegExp(oldEndpoint, 'g'), NEW_API);
            updated = true;
            console.log(`Updated endpoint in ${filePath}`);
        }
    });
    
    // Add authentication for HTML files
    if (filePath.endsWith('.html')) {
        // Check if auth is already added
        if (!content.includes('auth.js')) {
            // Add before closing </head> tag
            content = content.replace('</head>', `${authScriptTag}\n</head>`);
            updated = true;
            console.log(`Added authentication to ${filePath}`);
        }
        
        // Update title
        content = content.replace(/LeTool/g, 'Sunney.io');
        
        // Add user display element if not exists
        if (!content.includes('user-name')) {
            const userDisplay = `
                <div class="user-info" style="position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.8); padding: 10px; border-radius: 5px; color: white; z-index: 1000;">
                    <span class="user-name"></span>
                    <button class="logout-btn" style="margin-left: 10px; padding: 5px 10px; background: #ff4444; color: white; border: none; border-radius: 3px; cursor: pointer;">Logout</button>
                </div>
            `;
            content = content.replace('<body>', `<body>\n${userDisplay}`);
        }
    }
    
    // Update JavaScript files
    if (filePath.endsWith('.js')) {
        // Replace direct fetch calls with API client
        if (content.includes('fetch(')) {
            // Add API client reference at top
            if (!content.includes('sunneyAPI')) {
                content = `// Using Sunney.io API Client\nconst api = window.sunneyAPI;\n\n${content}`;
            }
            
            // Replace fetch patterns
            content = content.replace(
                /fetch\(`?\$\{API_ENDPOINT\}\/api\/latest`?\)/g,
                'api.getLatestPrices()'
            );
            
            content = content.replace(
                /fetch\(`?\$\{API_ENDPOINT\}\/api\/trading\/.*`?\)/g,
                'api.getTradingPositions()'
            );
            
            updated = true;
            console.log(`Updated API calls in ${filePath}`);
        }
    }
    
    if (updated) {
        fs.writeFileSync(fullPath, content);
        console.log(`✅ Updated ${filePath}`);
    }
}

console.log('🔧 Updating apps to use Sunney.io architecture...\n');

filesToUpdate.forEach(updateFile);

console.log('\n✨ Update complete!');
console.log('\nNext steps:');
console.log('1. Test each app with authentication');
console.log('2. Verify API endpoints are working');
console.log('3. Check WebSocket connections');
console.log('4. Update any hardcoded URLs manually');