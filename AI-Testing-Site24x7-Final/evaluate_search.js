const fs = require('fs');

const data = JSON.parse(fs.readFileSync('site24x7_compact.json', 'utf8'));
const apis = data.apis;
const tfidf = JSON.parse(fs.readFileSync('tfidf_index.json', 'utf8'));

// Tokenizer
const STOPWORDS = new Set(['a','an','and','are','as','at','be','but','by','for','if','in','into','is','it','no','not','of','on','or','such','that','the','their','then','there','these','they','this','to','was','will','with']);
function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 1 && !STOPWORDS.has(t));
}

// Pre-tokenize APIs
apis.forEach(api => {
  var allText = [api.endpoint, api.subFeature, api.sheet, api.description, api.summaryText, api.searchText, (api.responseFields||[]).join(' '), (api.requestFields||[]).join(' ')].join(' ');
  api._tokens = tokenize(allText);
});

// Search Algorithms
function keywordScore(api, tokens) {
  var s = 0;
  var q = tokens.join(' ');
  tokens.forEach(tok => {
    if (api.endpoint.toLowerCase().includes(tok)) s += 12;
    if (api.subFeature.toLowerCase().includes(tok)) s += 10;
    if (api.sheet.toLowerCase().includes(tok)) s += 8;
    if (api.description.toLowerCase().includes(tok)) s += 6;
    if (api.responseFields && api.responseFields.some(f => f.toLowerCase().includes(tok))) s += 7;
    if (api.requestFields && api.requestFields.some(f => f.toLowerCase().includes(tok))) s += 5;
    if (api.summaryText && api.summaryText.toLowerCase().includes(tok)) s += 4;
    if (api.searchText && api.searchText.includes(tok)) s += 1;
  });
  if (api.subFeature.toLowerCase().includes(q)) s += 20;
  if (api.description.toLowerCase().includes(q)) s += 15;
  if (api.endpoint.toLowerCase().includes(q)) s += 18;
  return s;
}

function semanticScore(api, tokens) {
  var s = 0;
  var q = tokens.join(' ');
  var k1 = 1.5;
  var b = 0.75;
  var dl = api._tokens.length;
  var avgdl = tfidf.avgdl;

  tokens.forEach(tok => {
    var tf = 0;
    for (var i=0; i<api._tokens.length; i++) {
      if (api._tokens[i] === tok || api._tokens[i].startsWith(tok)) tf++; 
    }
    if (tf > 0) {
      var idf = tfidf.idf[tok] || Math.log(tfidf.N);
      var bm25 = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl))));
      s += (bm25 * 5);
    }
  });
  if (api.endpoint.toLowerCase().includes(q)) s += 40;
  return s + keywordScore(api, tokens);
}

// Load Dataset
const csv = fs.readFileSync('site24x7_Dataset.csv', 'utf8');
const lines = csv.split('\n');
let totalQueries = 0;
let keywordStats = { p1: 0, p3: 0, p5: 0 };
let semanticStats = { p1: 0, p3: 0, p5: 0 };
let failedQueries = [];

for (let i = 1; i < lines.length; i++) {
  if (lines[i].trim() === '') continue;
  
  // Basic CSV parser to handle quotes
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
  if (!correctApi) continue; // If API is missing from dataset
  
  totalQueries++;
  const tokens = tokenize(query);
  
  // Keyword Search
  let kResults = apis.map(api => ({id: api.id, score: keywordScore(api, tokens)}))
    .filter(r => r.score > 0)
    .sort((a,b) => b.score - a.score);
    
  let kRank = kResults.findIndex(r => r.id === correctApi.id);
  if (kRank === 0) keywordStats.p1++;
  if (kRank >= 0 && kRank < 3) keywordStats.p3++;
  if (kRank >= 0 && kRank < 5) keywordStats.p5++;

  // Semantic Search
  let sResults = apis.map(api => ({id: api.id, score: semanticScore(api, tokens)}))
    .filter(r => r.score > 0)
    .sort((a,b) => b.score - a.score);
    
  let sRank = sResults.findIndex(r => r.id === correctApi.id);
  if (sRank === 0) semanticStats.p1++;
  if (sRank >= 0 && sRank < 3) semanticStats.p3++;
  if (sRank >= 0 && sRank < 5) {
    semanticStats.p5++;
  } else {
    failedQueries.push(query);
  }
}

let report = '\nEvaluation Results\n';
report += '──────────────────\n';
report += `Total queries:     ${lines.length - 2}\n`; // approximate total based on csv rows
report += `Marked correct:    ${totalQueries}\n`;
report += 'Search Quality:\n';
report += `  Precision@1:     ${Math.round((semanticStats.p1/totalQueries)*100)}%  (${semanticStats.p1}/${totalQueries} correct APIs ranked #1)\n`;
report += `  Precision@3:     ${Math.round((semanticStats.p3/totalQueries)*100)}%  (${semanticStats.p3}/${totalQueries} correct APIs in top 3)\n`;
report += `  Precision@5:     ${Math.round((semanticStats.p5/totalQueries)*100)}%  (${semanticStats.p5}/${totalQueries} correct APIs in top 5)\n`;

if (failedQueries.length > 0) {
  report += 'Failed queries (correct API not in top 5):\n';
  failedQueries.forEach(q => report += `  - "${q}"\n`);
}

console.log(report);
console.log('\\nRun this after every change to search/AI to track whether things are improving.');

// Store the results to a file
fs.writeFileSync('evaluation_results.txt', report, 'utf8');
console.log('Saved results to evaluation_results.txt');
