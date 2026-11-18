import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

async function syncDb() {
  console.log('--- Starting Database Sync: PROD -> TEST ---');

  const skippedCollections = new Set(['users']);

  const prodEnvPath = path.join(__dirname, '../../prod.env');
  const testEnvPath = path.join(__dirname, '../../dev.env');

  // We explicitly load the environments to extract the URIs
  const prodEnv = dotenv.config({ path: prodEnvPath }).parsed;
  const testEnv = dotenv.config({ path: testEnvPath }).parsed;

  const prodUri = prodEnv?.MONGO_URI;
  const testUri = testEnv?.MONGO_URI;

  if (!prodUri) {
    console.error('❌ Could not find MONGO_URI in prod.env');
    process.exit(1);
  }

  if (!testUri) {
    console.error('❌ Could not find MONGO_URI in dev.env');
    process.exit(1);
  }

  if (prodUri === testUri) {
    console.error('❌ PROD and TEST URIs are the same! Aborting to prevent data loss.');
    process.exit(1);
  }

  console.log('Connecting to PROD database...');
  const prodConn = await mongoose.createConnection(prodUri).asPromise();
  console.log('✅ Connected to PROD.');

  console.log('Connecting to TEST database...');
  const testConn = await mongoose.createConnection(testUri).asPromise();
  console.log('✅ Connected to TEST.');

  const prodDb = prodConn.db;
  const testDb = testConn.db;

  if (!prodDb || !testDb) {
    throw new Error('Could not access db objects on connections.');
  }

  try {
    const collections = await prodDb.listCollections().toArray();
    console.log(`Found ${collections.length} collections in PROD.`);

    for (const collInfo of collections) {
      const collName = collInfo.name;
      
      // Skip system collections
      if (collName.startsWith('system.')) continue;

      if (skippedCollections.has(collName.toLowerCase())) {
        console.log(`\nSkipping collection: [${collName}]`);
        continue;
      }

      // If specific collections are passed via arguments (e.g., --scheduledClasses)
      const args = process.argv.slice(2);
      const targetCollections = args
        .filter((arg) => arg.startsWith('--'))
        .map((arg) => arg.slice(2).toLowerCase());

      if (targetCollections.length > 0 && !targetCollections.includes(collName.toLowerCase())) {
        continue;
      }

      console.log(`\nSyncing collection: [${collName}]`);

      try {
        // Drop the collection in TEST if it exists
        try {
          await testDb.dropCollection(collName);
          console.log(`  -> Dropped existing collection in TEST.`);
        } catch (err: any) {
          if (err.codeName !== 'NamespaceNotFound') {
            console.warn(`  -> Warning dropping collection: ${err.message}`);
          }
        }

        // Create collection in TEST
        await testDb.createCollection(collName);

        // Copy documents first (before indexes, for faster insertion and index build)
        const docs = await prodDb.collection(collName).find({}).toArray();
        if (docs.length > 0) {
          // Batch inserts in chunks of 2000 to avoid document payload limits
          const CHUNK_SIZE = 2000;
          let totalInserted = 0;

          for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
            const chunk = docs.slice(i, i + CHUNK_SIZE);
            try {
              const res = await testDb.collection(collName).insertMany(chunk, { ordered: false });
              totalInserted += res.insertedCount ?? chunk.length;
            } catch (insertErr: any) {
              if (insertErr.code === 11000 || insertErr.name === 'MongoBulkWriteError') {
                const insertedInChunk = insertErr.result?.insertedCount ?? 0;
                totalInserted += insertedInChunk;
                console.warn(`  -> Note: Skipped duplicate keys (${insertedInChunk}/${chunk.length} inserted in chunk).`);
              } else {
                throw insertErr;
              }
            }
          }
          console.log(`  -> Inserted ${totalInserted}/${docs.length} documents.`);
        } else {
          console.log(`  -> Collection is empty. Skipped inserts.`);
        }

        // Read and recreate indexes in TEST after documents are inserted
        const indexes = await prodDb.collection(collName).indexes();
        const indexesToCreate = indexes
          .filter((idx) => idx.name !== '_id_')
          .map((idx) => {
            const { v, ns, ...rest } = idx as any;
            return rest;
          });

        if (indexesToCreate.length > 0) {
          try {
            await testDb.collection(collName).createIndexes(indexesToCreate);
            console.log(`  -> Created ${indexesToCreate.length} indexes.`);
          } catch (idxErr: any) {
            console.warn(`  -> Warning creating indexes on [${collName}]: ${idxErr.message}`);
          }
        }
      } catch (collErr: any) {
        console.error(`  ❌ Error syncing collection [${collName}]:`, collErr.message);
      }
    }

    console.log('\n✅ Database sync completed successfully!');
  } catch (error) {
    console.error('\n❌ Error during sync:', error);
  } finally {
    console.log('Closing connections...');
    await prodConn.close();
    await testConn.close();
    console.log('Done.');
  }
}

syncDb().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
