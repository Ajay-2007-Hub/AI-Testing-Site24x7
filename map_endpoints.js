require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const path = require('path');

const endpointsFile = path.join(__dirname, 'extracted_api_endpoints.json');
const subsectionsFile = path.join(__dirname, 'reports_subsections_list.txt');
const outputFile = path.join(__dirname, 'mapped_endpoints.json');

async function mapEndpoints() {
    console.log('Loading extracted endpoints and subsections...');
    const endpoints = JSON.parse(fs.readFileSync(endpointsFile, 'utf8'));
    
    // Some basic filtering to reduce noise before sending to LLM
    const filteredEndpoints = endpoints.filter(e => 
        e.url.includes('/api/reports') || 
        e.url.includes('/api/monitors') ||
        e.url.includes('/api/data') ||
        e.url.includes('/api/admin') ||
        e.url.includes('/api/custom')
    );

    const subsections = fs.readFileSync(subsectionsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    
    console.log(`Mapping ${filteredEndpoints.length} endpoints to ${subsections.length} subsections...`);

    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL;

    if (!OPENAI_BASE_URL || !OPENAI_API_KEY) {
        console.error('Error: OPENAI_BASE_URL or OPENAI_API_KEY not found in .env');
        return;
    }

    const batchSize = 30; // Process 30 endpoints at a time
    const results = [];

    // Iterate over all endpoints in batches
    for (let i = 0; i < filteredEndpoints.length; i += batchSize) {
        const batch = filteredEndpoints.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(filteredEndpoints.length / batchSize)}...`);

        const prompt = `
You are an expert system administrator for Site24x7.
I have a list of API endpoints extracted from network traffic and a list of report subsections in the UI.
Your task is to map each API endpoint to the most likely report subsection it belongs to, based on the URL path and query parameters.
If an endpoint doesn't seem to belong to any specific subsection, map it to "General/Unknown".

Report Subsections:
${subsections.join(', ')}

Endpoints to map:
${batch.map((e, idx) => `[${idx}] ${e.method} ${e.exampleUrl}`).join('\n')}

Output JSON format exactly like this:
{
  "mappings": [
    { "endpoint_index": 0, "mapped_subsection": "Name of Subsection" }
  ]
}`;

        try {
            const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: OPENAI_MODEL,
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant that outputs only valid JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1
                })
            });

            if (!response.ok) {
                console.error('API Error:', response.status, await response.text());
                continue;
            }

            const data = await response.json();
            let content = data.choices[0].message.content;
            content = content.replace(/^```json/im, '').replace(/```$/im, '').trim();
            const parsed = JSON.parse(content);
            parsed.mappings.forEach(m => {
                const endpoint = batch[m.endpoint_index];
                if (endpoint) {
                    results.push({
                        ...endpoint,
                        subsection: m.mapped_subsection
                    });
                }
            });
            
            console.log(`Batch processed successfully.`);
        } catch (err) {
            console.error('Error processing batch:', err);
        }
    }

    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`Saved partial mapped results to ${outputFile}`);
    console.log('To process all endpoints, remove the loop limit in map_endpoints.js');
}

mapEndpoints().catch(console.error);
