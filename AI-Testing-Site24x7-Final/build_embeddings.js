const fs = require('fs');

async function buildEmbeddings() {
  console.log("Loading Transformers.js...");
  const { pipeline } = require('@xenova/transformers');

  console.log("Loading all-MiniLM-L6-v2 model...");
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const dbHelper = require('./db');
  const data = {
    sheetDescriptions: dbHelper.getSheetDescriptions(),
    apis: dbHelper.getAllApis()
  };
  const apis = data.apis;
  
  // vectors[api.id] = array of vectors
  const vectors = {};
  
  console.log(`Initializing vectors for ${apis.length} APIs...`);
  for (let i = 0; i < apis.length; i++) {
    const api = apis[i];
    vectors[api.id] = [];
    
    // Embed the original description as well
    const textToEmbed = `${api.subModule} - ${api.description}. Endpoint: ${api.method} ${api.endpoint}. Fields: ${(api.requestFields || []).join(' ')}`;
    const output = await extractor(textToEmbed, { pooling: 'mean', normalize: true });
    vectors[api.id].push(Array.from(output.data));
  }

  // Load and parse CSV
  console.log("Loading site24x7_Dataset.csv...");
  const csv = fs.readFileSync('site24x7_Dataset.csv', 'utf8');
  const lines = csv.split('\n');
  
  let validQueries = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    
    let parts = [];
    let current = '';
    let inQuotes = false;
    for(let j=0; j<lines[i].length; j++) {
        if(lines[i][j] === '"') inQuotes = !inQuotes;
        else if(lines[i][j] === ',' && !inQuotes) { parts.push(current); current = ''; }
        else if(lines[i][j] !== '\r') current += lines[i][j];
    }
    parts.push(current);
    
    if (parts.length < 6) continue;
    
    let query = parts[0].trim();
    let correctEndpoint = parts[1].trim();
    let correctMethod = parts[2].trim();
    
    if (!query || !correctEndpoint || !correctMethod) continue;
    
    let correctApi = apis.find(a => a.endpoint === correctEndpoint && a.method === correctMethod);
    if (!correctApi) continue;
    
    validQueries.push({ apiId: correctApi.id, query: query });
  }
  
  console.log(`Found ${validQueries.length} valid queries in dataset. Generating embeddings... This will take a few minutes.`);
  
  let count = 0;
  for (const item of validQueries) {
    const output = await extractor(item.query, { pooling: 'mean', normalize: true });
    vectors[item.apiId].push(Array.from(output.data));
    count++;
    if (count % 100 === 0) {
      console.log(`Processed ${count}/${validQueries.length} queries...`);
    }
  }

  console.log("Finished generating embeddings.");
  fs.writeFileSync('site24x7_vector.json', JSON.stringify(vectors), 'utf8');
  console.log(`Saved site24x7_vector.json. Size: ${Math.round(fs.statSync('site24x7_vector.json').size / 1024)} KB`);
}

buildEmbeddings().catch(console.error);

