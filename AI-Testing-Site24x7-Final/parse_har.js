const fs = require('fs');
const path = require('path');

const harDir = path.join(__dirname, 'Reports API');
const outputFile = path.join(__dirname, 'extracted_api_endpoints.json');

const EXCLUDED_ENDPOINTS = [
    '/api/client_data',
    '/api/top_message',
    '/api/cliq_chatlet',
    '/api/short/current_status',
    '/api/genai/workflows',
    '/api/account_settings',
    '/api/monitors/status/count',
    '/api/license_usage',
    '/api/users',
    '/api/location_template',
    '/api/short/dashboards/favourites',
    '/api/reports/download' // Just export functionality, unless we want it
];

function isExcluded(url) {
    try {
        const parsed = new URL(url);
        return EXCLUDED_ENDPOINTS.some(ex => parsed.pathname.includes(ex));
    } catch {
        return false;
    }
}

async function extractEndpoints() {
    const files = fs.readdirSync(harDir).filter(f => f.endsWith('.har'));
    
    let uniqueEndpoints = new Map();

    for (const file of files) {
        console.log(`Parsing ${file}...`);
        const filePath = path.join(harDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const har = JSON.parse(content);
        
        for (const entry of har.log.entries) {
            const req = entry.request;
            const url = req.url;
            
            // Only care about site24x7 API endpoints
            if (url.includes('site24x7.com') && (url.includes('/api/'))) {
                
                if (isExcluded(url)) continue;
                if (req.method === 'OPTIONS') continue;

                // Extract base path without query params for uniqueness check
                let basePath = url.split('?')[0];
                
                const key = `${req.method} ${basePath}`;
                
                if (!uniqueEndpoints.has(key)) {
                    let payload = null;
                    if (req.postData && req.postData.text) {
                        try {
                            payload = JSON.parse(req.postData.text);
                        } catch (e) {
                            payload = req.postData.text; // store raw if not json
                        }
                    }

                    uniqueEndpoints.set(key, {
                        method: req.method,
                        url: basePath,
                        exampleUrl: url,
                        queryString: req.queryString,
                        payload: payload
                    });
                }
            }
        }
    }

    const results = Array.from(uniqueEndpoints.values());
    console.log(`Extracted ${results.length} unique API endpoints.`);
    
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`Saved to ${outputFile}`);
}

extractEndpoints().catch(console.error);
