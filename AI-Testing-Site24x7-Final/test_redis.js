const { createClient } = require('redis');

(async () => {
  const client = createClient({ url: 'redis://redis:6379' });
  await client.connect();

  const arr = new Float32Array(384).fill(0.1);
  const blob = Buffer.from(arr.buffer);

  try {
    const raw = await client.sendCommand([
      'FT.EXPLAINCLI', 'idx:api_vectors',
      '*=>[KNN 5 @embedding $BLOB]',
      'PARAMS', '2', 'BLOB', blob,
      'DIALECT', '2'
    ]);
    console.log('EXPLAINCLI results:\n', raw);
  } catch (e) {
    console.error('EXPLAINCLI failed:', e.message);
  }

  await client.quit();
})();
