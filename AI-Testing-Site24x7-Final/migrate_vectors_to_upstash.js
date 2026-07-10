require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Index } = require('@upstash/vector');

const url = process.env.UPSTASH_VECTOR_URL;
const token = process.env.UPSTASH_VECTOR_TOKEN;

if (!url || !token || url.includes('your_upstash_vector_url_here') || url.trim() === '') {
  console.error('\n============================================================');
  console.error('ERROR: Upstash Vector credentials are not configured.');
  console.error('Please configure UPSTASH_VECTOR_URL and UPSTASH_VECTOR_TOKEN in your .env file.');
  console.error('============================================================\n');
  process.exit(1);
}

const index = new Index({ url, token });

const vectorPath = path.join(__dirname, 'site24x7_vector.json');
if (!fs.existsSync(vectorPath)) {
  console.error(`Error: ${vectorPath} not found.`);
  process.exit(1);
}

console.log('Reading site24x7_vector.json...');
const vectorDB = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));

console.log('Preparing vectors for upsert...');
const uploadBatch = [];
for (const [apiId, apiVectors] of Object.entries(vectorDB)) {
  if (!apiVectors || apiVectors.length === 0) continue;
  
  if (Array.isArray(apiVectors[0])) {
    apiVectors.forEach((vec, idx) => {
      uploadBatch.push({
        id: `${apiId}:${idx}`,
        vector: vec
      });
    });
  } else {
    uploadBatch.push({
      id: `${apiId}:0`,
      vector: apiVectors
    });
  }
}

console.log(`Total vectors to migrate: ${uploadBatch.length}`);

async function runMigration() {
  const CHUNK_SIZE = 200; // Batch upsert limits
  for (let i = 0; i < uploadBatch.length; i += CHUNK_SIZE) {
    const chunk = uploadBatch.slice(i, i + CHUNK_SIZE);
    console.log(`Upserting vectors ${i} to ${Math.min(i + CHUNK_SIZE, uploadBatch.length)}...`);
    await index.upsert(chunk);
  }
  console.log('Migration completed successfully!');
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
