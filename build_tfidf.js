const fs = require('fs');

const DATA_FILE = 'site24x7_api_data.json';
const OUTPUT_FILE = 'tfidf_index.json';

// Standard English stop words
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','if','in',
  'into','is','it','no','not','of','on','or','such','that','the',
  'their','then','there','these','they','this','to','was','will','with'
]);

function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function buildIndex() {
  console.log(`Loading API data from ${DATA_FILE}`);
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const apis = data.apis || Object.values(data);
  
  const N = apis.length;
  console.log(`Found ${N} API endpoints.`);

  // 1. Compute document lengths and total tokens
  let totalTokens = 0;
  apis.forEach(api => {
    const allText = [
      api.endpoint,
      api.subFeature,
      api.sheet,
      api.description,
      api.summaryText,
      api.searchText,
      (api.responseFields || []).join(' '),
      (api.requestFields || []).join(' ')
    ].join(' ');
    
    api._tokens = tokenize(allText);
    totalTokens += api._tokens.length;
  });

  const avgdl = totalTokens / N;
  console.log(`Average document length (avgdl): ${Math.round(avgdl)} tokens`);

  // 2. Compute Document Frequency (DF) for each term
  const df = {};
  apis.forEach(api => {
    const uniqueTokens = new Set(api._tokens);
    uniqueTokens.forEach(tok => {
      df[tok] = (df[tok] || 0) + 1;
    });
  });

  // 3. Compute Inverse Document Frequency (IDF)
  const idf = {};
  Object.keys(df).forEach(tok => {
    // Standard BM25 IDF formulation
    idf[tok] = Math.log((N - df[tok] + 0.5) / (df[tok] + 0.5) + 1);
  });

  console.log(`Extracted ${Object.keys(idf).length} unique terms.`);

  // 4. Save Index
  const indexData = {
    N: N,
    avgdl: avgdl,
    idf: idf
  };

  console.log(`Writing IDF dictionary to ${OUTPUT_FILE}`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(indexData));
  console.log('Done!');
}

buildIndex();
