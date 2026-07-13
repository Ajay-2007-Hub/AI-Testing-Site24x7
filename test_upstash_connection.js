require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Index } = require('@upstash/vector');

async function testConnection() {
  const url = process.env.UPSTASH_VECTOR_URL || process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_TOKEN || process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!url || !token) {
    console.error('Credentials missing');
    process.exit(1);
  }

  console.log(`Connecting to URL: ${url}`);
  const index = new Index({ url, token });

  try {
    const info = await index.info();
    console.log('Connection successful!');
    console.log('Index Info:', JSON.stringify(info, null, 2));

    // Get expected dimension from site24x7_vector.json
    const vectorPath = path.join(__dirname, 'site24x7_vector.json');
    if (!fs.existsSync(vectorPath)) {
      throw new Error(`Vector file not found at ${vectorPath}`);
    }
    
    console.log('Reading site24x7_vector.json...');
    const vectorDB = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
    const firstKey = Object.keys(vectorDB)[0];
    const apiVectors = vectorDB[firstKey];
    
    let firstVector;
    if (Array.isArray(apiVectors[0])) {
      firstVector = apiVectors[0];
    } else {
      firstVector = apiVectors;
    }
    
    const fileDimension = firstVector.length;
    console.log(`File Vector Dimension: ${fileDimension}`);
    console.log(`Upstash Index Dimension: ${info.dimension}`);

    if (fileDimension === info.dimension) {
      console.log('Dimension match: YES');
    } else {
      console.log('Dimension match: NO');
      // Dimension mismatch is a failure.
      console.error(`Dimension mismatch! Upstash: ${info.dimension}, File: ${fileDimension}`);
      process.exit(2);
    }
  } catch (err) {
    console.error('Connection/Verification failed:', err.message || err);
    process.exit(1);
  }
}

testConnection();
