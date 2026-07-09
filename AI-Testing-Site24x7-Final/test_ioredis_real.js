const Redis = require('ioredis');
const fs = require('fs');

(async () => {
  const c = new Redis('redis://redis:6379');
  
  const vectorDB = JSON.parse(fs.readFileSync('site24x7_vector.json', 'utf8'));
  const firstApiId = Object.keys(vectorDB)[0];
  const firstVec = vectorDB[firstApiId][0];
  
  const float32 = new Float32Array(firstVec);
  const blob = Buffer.from(float32.buffer);

  try {
    const r = await c.call('FT.SEARCH', 'idx:api_vectors', '(*)=>[KNN 5 @embedding $BLOB]', 'PARAMS', '2', 'BLOB', blob, 'DIALECT', '2');
    console.log('SUCCESS total:', r[0]);
    console.log('Results:', r);
  } catch(e) {
    console.error('FAIL:', e.message);
  }

  c.quit();
})();
