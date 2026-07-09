const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('site24x7_Admin_API.xlsx');

// Sheet descriptions (row 1 in each sheet)
const sheetDescriptions = {};
const allAPIs = [];

wb.SheetNames.forEach(sheetName => {
  const ws = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  // Row 1 (index 1) is the description
  if (rawData[1] && rawData[1][0]) {
    sheetDescriptions[sheetName] = rawData[1][0].toString().trim();
  }

  let lastHeaderRowIdx = -1;
  
  rawData.forEach((row, rowIdx) => {
    // Detect header rows (there can be multiple per sheet)
    if (row[0] === 'Sub-Feature' && row[1] === 'Endpoint Path') {
      lastHeaderRowIdx = rowIdx;
      return;
    }
    
    if (lastHeaderRowIdx >= 0 && rowIdx > lastHeaderRowIdx) {
      const subFeature = row[0] ? row[0].toString().trim() : '';
      const endpoint = row[1] ? row[1].toString().trim() : '';
      const method = row[2] ? row[2].toString().trim() : '';
      const statusCode = row[3] ? row[3].toString().trim() : '';
      const description = row[4] ? row[4].toString().trim() : '';
      const requestPayload = row[5] ? row[5].toString().trim() : '';
      const responseExample = row[6] ? row[6].toString().trim() : '';
      
      if (!subFeature || !endpoint || !method) return;
      if (subFeature === 'Sub-Feature' || endpoint === 'Endpoint Path') return;
      if (subFeature.startsWith('Below:')) return;
      
      // Parse response fields from summary
      let responseFields = [];
      let summaryText = '';
      
      try {
        const parsed = JSON.parse(responseExample);
        if (parsed.summary) {
          summaryText = parsed.summary;
          // Extract field names from "sample data fields: x, y, z"
          const match = summaryText.match(/sample data fields:\s*([^;\.]+)/i);
          if (match) {
            responseFields = match[1].split(',').map(f => f.trim()).filter(Boolean);
          }
        }
      } catch(e) {
        // Try regex extraction
        const fieldMatches = responseExample.match(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g);
        if (fieldMatches) {
          responseFields = [...new Set(fieldMatches.map(f => f.replace(/[":]/g, '').trim()))];
        }
      }
      
      // Extract request payload fields
      let requestFields = [];
      if (requestPayload && requestPayload !== 'No payload') {
        try {
          const parsed = JSON.parse(requestPayload);
          requestFields = Object.keys(parsed);
        } catch(e) {
          const fieldMatches = requestPayload.match(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g);
          if (fieldMatches) {
            requestFields = [...new Set(fieldMatches.map(f => f.replace(/[":]/g, '').trim()))];
          }
        }
      }
      
      const entry = {
        id: allAPIs.length,
        sheet: sheetName,
        subFeature,
        endpoint,
        method: method.toUpperCase(),
        statusCode,
        description,
        requestPayload: requestPayload !== 'No payload' ? requestPayload.substring(0, 800) : '',
        responseExample: responseExample.substring(0, 800),
        responseFields,
        requestFields,
        summaryText,
        searchText: [
          sheetName, subFeature, endpoint, method, description,
          requestFields.join(' '), responseFields.join(' '), summaryText
        ].join(' ').toLowerCase()
      };
      
      allAPIs.push(entry);
    }
  });
});

console.log(`Extracted ${allAPIs.length} API entries`);

// Generate the final data file for the app
const output = {
  sheets: wb.SheetNames,
  sheetDescriptions,
  apis: allAPIs
};

fs.writeFileSync('site24x7_api_data.json', JSON.stringify(output, null, 2));
console.log('Written to site24x7_api_data.json');
console.log('File size:', Math.round(fs.statSync('site24x7_api_data.json').size / 1024), 'KB');
