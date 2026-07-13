/**
 * migrate_to_redis.js
 * 
 * Migrates site24x7_vector.json into Redis as HASH keys with binary Float32 vectors.
 * This is the correct format for RediSearch KNN vector similarity search.
 * 
 * Run: node migrate_to_redis.js
 * (or inside Docker: docker-compose exec proxy node migrate_to_redis.js)
 */

const { createClient, SchemaFieldTypes, VectorAlgorithms } = require('redis');
const fs = require('fs');

async function migrate() {
    const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', err => console.error('Redis Client Error', err));
    await client.connect();

    console.log('Connected to Redis.');

    // Drop old index and all keys
    console.log('Dropping old index and cleaning keys...');
    try {
        await client.ft.dropIndex('idx:api_vectors', { DD: true }); // DD = drop documents too
        console.log('Old index dropped.');
    } catch (e) {
        console.log('No existing index to drop, continuing...');
    }

    // Create a new index on HASH keys with a FLAT (brute force) vector field
    console.log('Creating new HASH-based index with binary vectors...');
    try {
        await client.ft.create('idx:api_vectors', {
            'api_id': {
                type: SchemaFieldTypes.NUMERIC,
            },
            'embedding': {
                type: SchemaFieldTypes.VECTOR,
                ALGORITHM: VectorAlgorithms.FLAT,
                TYPE: 'FLOAT32',
                DIM: 384,
                DISTANCE_METRIC: 'COSINE',
            }
        }, {
            ON: 'HASH',
            PREFIX: 'api:'
        });
        console.log('Index created successfully.');
    } catch (e) {
        console.error('Failed to create index:', e);
        process.exit(1);
    }

    console.log('Loading site24x7_vector.json...');
    const vectorsMap = JSON.parse(fs.readFileSync('site24x7_vector.json', 'utf8'));
    const apiIds = Object.keys(vectorsMap);

    let count = 0;
    let batch = client.multi();

    console.log(`Ingesting ${apiIds.length} APIs into Redis as binary HASH keys...`);

    for (const apiId of apiIds) {
        const vecs = vectorsMap[apiId];

        for (let i = 0; i < vecs.length; i++) {
            // Convert float array to raw binary Float32 buffer - this is what RediSearch expects
            const float32 = new Float32Array(vecs[i]);
            const binaryBuffer = Buffer.from(float32.buffer);

            batch.hSet(`api:${apiId}:${i}`, {
                api_id: parseInt(apiId, 10),
                embedding: binaryBuffer
            });
            count++;

            if (count % 5000 === 0) {
                await batch.exec();
                console.log(`Ingested ${count} vectors...`);
                batch = client.multi();
            }
        }
    }

    // Flush remaining
    if (count % 5000 !== 0) {
        await batch.exec();
    }

    console.log(`\n✅ Successfully migrated ${count} binary vectors into Redis.`);
    console.log(`   Index: idx:api_vectors | Type: HASH | Field: embedding | Algo: FLAT | DIM: 384`);
    await client.quit();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
