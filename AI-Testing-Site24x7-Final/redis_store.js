const Redis = require('ioredis');
const fs = require('fs');

const redisClient = new Redis(process.env.REDIS_URL);

async function initStore() {
  try {
    const isLoaded = await redisClient.get('vectors:loaded');
    if (!isLoaded) {
      console.log('[redis_store] vectors:loaded missing. Loading from site24x7_vector.json...');
      const vectorDB = JSON.parse(fs.readFileSync('site24x7_vector.json', 'utf8'));
      let count = 0;
      
      let pipeline = redisClient.pipeline();
      
      for (const apiId in vectorDB) {
        const flat = [];
        for (const emb of vectorDB[apiId]) {
          flat.push(...emb);
        }
        const float32 = new Float32Array(flat);
        const buffer = Buffer.from(float32.buffer);
        
        pipeline.set(`vec:${apiId}`, buffer);
        count++;
        
        if (count % 1000 === 0) {
          console.log(`[redis_store] Stored ${count} vectors...`);
          await pipeline.exec();
          pipeline = redisClient.pipeline();
        }
      }
      
      if (count % 1000 !== 0) {
        await pipeline.exec();
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
  let cursor = '0';
  const allIds = [];
  do {
    const res = await redisClient.scan(cursor, 'MATCH', 'vec:*', 'COUNT', 1000);
    cursor = res[0];
    for (const key of res[1]) {
      allIds.push(key.replace('vec:', ''));
    }
  } while (cursor !== '0');
  return allIds;
}

async function getVector(apiId) {
  await initPromise;
  const buffer = await redisClient.getBuffer(`vec:${apiId}`);
  if (!buffer) return null;
  
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
