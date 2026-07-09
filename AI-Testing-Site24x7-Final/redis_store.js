const { Redis } = require('@upstash/redis');
const fs = require('fs');

const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

async function initStore() {
  try {
    const isLoaded = await redisClient.get('vectors:loaded');
    if (!isLoaded) {
      console.log('[redis_store] vectors:loaded missing. Loading from site24x7_vector.json...');
      const vectorDB = JSON.parse(fs.readFileSync('site24x7_vector.json', 'utf8'));
      let count = 0;
      
      let p = redisClient.pipeline();
      
      for (const apiId in vectorDB) {
        const flat = [];
        for (const emb of vectorDB[apiId]) {
          flat.push(...emb);
        }
        const float32 = new Float32Array(flat);
        const base64Str = Buffer.from(float32.buffer).toString('base64');
        
        p.set(`vec:${apiId}`, base64Str);
        count++;
        
        if (count % 1000 === 0) {
          console.log(`[redis_store] Stored ${count} vectors...`);
          await p.exec();
          p = redisClient.pipeline();
        }
      }
      
      if (count % 1000 !== 0) {
        await p.exec();
      }
      
      await redisClient.set('vectors:loaded', 'true');
      console.log(`[redis_store] Finished storing ${count} vectors. Set vectors:loaded=true.`);
    } else {
      console.log('[redis_store] vectors:loaded is true. Skipping JSON load.');
    }
  } catch (err) {
    console.error('[redis_store] Error initializing vector store:', err);
  }
}

const initPromise = initStore();

async function getAllVectorIds() {
  await initPromise;
  let cursor = 0;
  const allIds = [];
  do {
    const [nextCursor, keys] = await redisClient.scan(cursor, { match: 'vec:*', count: 1000 });
    cursor = Number(nextCursor);
    for (const key of keys) {
      allIds.push(key.replace('vec:', ''));
    }
  } while (cursor !== 0);
  return allIds;
}

async function getVector(apiId) {
  await initPromise;
  const base64Str = await redisClient.get(`vec:${apiId}`);
  if (!base64Str) return null;
  
  const buffer = Buffer.from(base64Str, 'base64');
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const embeddings = [];
  for (let i = 0; i < float32.length; i += 384) {
    embeddings.push(float32.subarray(i, i + 384));
  }
  return embeddings;
}

module.exports = {
  getAllVectorIds,
  getVector
};
