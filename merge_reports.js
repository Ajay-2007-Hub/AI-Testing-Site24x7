const fs = require('fs');
const path = require('path');

const compactFile = path.join(__dirname, 'site24x7_compact.json');
const mappedFile = path.join(__dirname, 'mapped_endpoints.json');

console.log('Loading databases...');
const db = JSON.parse(fs.readFileSync(compactFile, 'utf8'));
const mappedEndpoints = JSON.parse(fs.readFileSync(mappedFile, 'utf8'));

// Ensure 'Reports' sheet exists
if (!db.sheets.includes('Reports')) {
    db.sheets.push('Reports');
    db.sheetDescriptions['Reports'] = "This module contains all reporting endpoints autonomously extracted from network traffic and mapped via Azure OpenAI. It covers ~320 subsections including Custom Reports, SLA Reports, Capacity Planning, and more.";
}

let nextId = db.apis.length > 0 ? Math.max(...db.apis.map(a => a.id)) + 1 : 0;
console.log(`Starting insertion at ID ${nextId}. Injecting ${mappedEndpoints.length} endpoints...`);

for (const ep of mappedEndpoints) {
    const reqPayload = ep.payload ? JSON.stringify(ep.payload, null, 2) : "";
    let reqFields = [];
    if (ep.payload && typeof ep.payload === 'object' && !Array.isArray(ep.payload)) {
        reqFields = Object.keys(ep.payload);
    }

    // Clean up url (some might be full URLs from HAR)
    let finalUrl = ep.url;
    if (finalUrl.startsWith('http')) {
        try {
            const urlObj = new URL(finalUrl);
            finalUrl = urlObj.pathname;
        } catch (e) {}
    }

    const searchText = `reports ${ep.subsection.toLowerCase()} ${finalUrl.toLowerCase()} ${ep.method.toLowerCase()}`;

    db.apis.push({
        id: nextId++,
        sheet: "Reports",
        subFeature: ep.subsection,
        endpoint: finalUrl,
        method: ep.method,
        statusCode: "200 OK",
        description: `Autonomously mapped ${ep.subsection} endpoint.`,
        requestFields: reqFields,
        responseFields: [],
        summaryText: "Data populated from automated HAR extraction.",
        requestPayload: reqPayload,
        searchText: searchText
    });
}

fs.writeFileSync(compactFile, JSON.stringify(db));
console.log(`Success! Injected endpoints into ${compactFile}. Total API count: ${db.apis.length}`);
