const { createClient } = require('redis');
const fs = require('fs');

(async () => {
  const client = createClient({ url: 'redis://redis:6379' });
  await client.connect();

  const vectorDB = JSON.parse(fs.readFileSync('site24x7_vector.json', 'utf8'));
  const firstApiId = Object.keys(vectorDB)[0];
  const firstVec = vectorDB[firstApiId][0]; // first vector for this API
  
  const float32 = new Float32Array(firstVec);
  const blob = Buffer.from(float32.buffer);

  try {
    const raw = await client.sendCommand([
      'FT.SEARCH', 'idx:api_vectors',
      '*=>[KNN 5 @embedding $BLOB]',
      'PARAMS', '2', 'BLOB', blob,
      'DIALECT', '2',
      'LIMIT', '0', '5'
    ]);
    console.log('Results with actual vector:', JSON.stringify(raw));
  } catch (e) {
    console.error('Failed:', e.message);
  }

  await client.quit();
})();
