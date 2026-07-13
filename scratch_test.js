const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');

const queries = [
  "something about reports",
  "delete a thing that monitors stuff",
  "retrieve configuration list or details but not for SLAs"
];

const db = new Database(path.join(__dirname, 'site24x7.db'));

function fetchQuery(q) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:3334/semantic_search?q=${encodeURIComponent(q)}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          resolve({ results, logId: res.headers['x-query-log-id'] });
        } catch(e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log("Sending vague/borderline search queries...");
  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    const { results } = await fetchQuery(q);
    
    // Print top 3 results
    const topResults = results.slice(0, 3);
    if (topResults.length > 0) {
      topResults.forEach((res, index) => {
        const api = db.prepare('SELECT * FROM apis WHERE id = ?').get(res.id);
        console.log(`  Rank ${index + 1}: ID=${res.id}, Score=${res.score.toFixed(4)}`);
        console.log(`    Endpoint: ${api.method} ${api.endpoint}`);
        console.log(`    Description: ${api.description}`);
      });
    } else {
      console.log("  No results returned");
    }
  }
}

run().catch(console.error);
