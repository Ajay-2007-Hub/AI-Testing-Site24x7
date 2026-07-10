const { Index } = require('@upstash/vector');

const url = process.env.UPSTASH_VECTOR_URL || process.env.UPSTASH_VECTOR_REST_URL;
const token = process.env.UPSTASH_VECTOR_TOKEN || process.env.UPSTASH_VECTOR_REST_TOKEN;

let index = null;
if (url && token && !url.includes('your_upstash_vector_url_here') && url.trim() !== '') {
  index = new Index({ url, token });
}

async function queryVectors(queryVector, topK = 100) {
  if (!index) {
    throw new Error('Upstash Vector client is not configured. Please set UPSTASH_VECTOR_URL and UPSTASH_VECTOR_TOKEN in .env');
  }
  const response = await index.query({
    vector: queryVector,
    topK: topK,
    includeMetadata: false
  });
  
  const seen = new Set();
  const results = [];
  for (const match of response) {
    const apiIdStr = String(match.id).split(':')[0];
    const apiId = parseInt(apiIdStr, 10);
    if (!seen.has(apiId)) {
      seen.add(apiId);
      results.push({ id: apiId, score: match.score });
    }
  }
  return results;
}

module.exports = {
  index,
  queryVectors
};
