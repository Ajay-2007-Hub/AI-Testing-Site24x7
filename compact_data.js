const fs = require('fs');
const data = JSON.parse(fs.readFileSync('site24x7_api_data.json', 'utf8'));

// Build a compact version for embedding in HTML (strip huge response examples to keep it manageable)
const compact = {
  sheets: data.sheets,
  sheetDescriptions: data.sheetDescriptions,
  apis: data.apis.map(api => ({
    id: api.id,
    sheet: api.sheet,
    subFeature: api.subFeature,
    endpoint: api.endpoint,
    method: api.method,
    statusCode: api.statusCode,
    description: api.description,
    requestFields: api.requestFields,
    responseFields: api.responseFields,
    summaryText: api.summaryText,
    requestPayload: api.requestPayload ? api.requestPayload.substring(0, 300) : '',
    searchText: api.searchText
  }))
};

const json = JSON.stringify(compact);
console.log('Compact data size:', Math.round(json.length / 1024), 'KB');
fs.writeFileSync('site24x7_compact.json', json);
console.log('Done');
