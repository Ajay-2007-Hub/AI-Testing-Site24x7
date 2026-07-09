const fs = require('fs');

// Helper function to compute cosine similarity between two vectors
function cos_sim(arr1, arr2) {
  let dot = 0.0, norm1 = 0.0, norm2 = 0.0;
  for (let i = 0; i < arr1.length; i++) {
    dot += arr1[i] * arr2[i];
    norm1 += arr1[i] * arr1[i];
    norm2 += arr2[i] * arr2[i];
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

async function evaluateVectors() {
  console.log("Loading Transformers.js...");
  const { pipeline } = require('@xenova/transformers');
  
  console.log("Loading all-MiniLM-L6-v2 model...");
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  console.log("Loading databases...");
  const vectorDB = JSON.parse(fs.readFileSync('site24x7_vector.json', 'utf8'));
  const data = JSON.parse(fs.readFileSync('site24x7_compact.json', 'utf8'));
  const apis = data.apis;

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

  console.log(`Evaluating ${validQueries.length} queries via Vector Search... This will take a few minutes.`);
  
  let totalQueries = validQueries.length;
  let stats = { p1: 0, p3: 0, p5: 0 };
  let failedQueries = [];
  
  let count = 0;
  for (const item of validQueries) {
    // Generate vector for the test query
    const output = await extractor(item.query, { pooling: 'mean', normalize: true });
    const queryVector = Array.from(output.data);
    
    // Compare against the Vector DB
    const results = [];
    for (const [apiId, apiVectors] of Object.entries(vectorDB)) {
      if (!apiVectors || apiVectors.length === 0) continue;
      
      let maxScore = -1;
      if (Array.isArray(apiVectors[0])) {
        for (const vec of apiVectors) {
          const score = cos_sim(queryVector, vec);
          if (score > maxScore) maxScore = score;
        }
      } else {
        maxScore = cos_sim(queryVector, apiVectors);
      }
      results.push({ id: parseInt(apiId), score: maxScore });
    }
    
    results.sort((a, b) => b.score - a.score);
    
    // Check rank
    let rank = results.findIndex(r => r.id === item.apiId);
    if (rank === 0) stats.p1++;
    if (rank >= 0 && rank < 3) stats.p3++;
    if (rank >= 0 && rank < 5) {
      stats.p5++;
    } else {
      failedQueries.push(`[Rank ${rank === -1 ? 'N/A' : rank + 1}] ${item.query}`);
    }
    
    count++;
    if (count % 100 === 0) {
      console.log(`Evaluated ${count}/${totalQueries} queries... Precision@1 so far: ${Math.round((stats.p1/count)*100)}%`);
    }
  }

  let report = '\nVector Search Evaluation Results\n';
  report += '────────────────────────────────\n';
  report += `Total queries:     ${totalQueries}\n`;
  report += 'Search Quality (Multi-Vector Embeddings):\n';
  report += `  Precision@1:     ${Math.round((stats.p1/totalQueries)*100)}%  (${stats.p1}/${totalQueries} correct APIs ranked #1)\n`;
  report += `  Precision@3:     ${Math.round((stats.p3/totalQueries)*100)}%  (${stats.p3}/${totalQueries} correct APIs in top 3)\n`;
  report += `  Precision@5:     ${Math.round((stats.p5/totalQueries)*100)}%  (${stats.p5}/${totalQueries} correct APIs in top 5)\n`;

  if (failedQueries.length > 0) {
    report += '\nFailed queries (correct API not in top 5):\n';
    failedQueries.slice(0, 50).forEach(q => report += `  - "${q}"\n`);
    if (failedQueries.length > 50) report += `  ... and ${failedQueries.length - 50} more\n`;
  }

  console.log(report);
  fs.writeFileSync('vector_evaluation_results.txt', report, 'utf8');
  console.log('Saved results to vector_evaluation_results.txt');
}

evaluateVectors().catch(console.error);
