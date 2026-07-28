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

      // Drop the collection in TEST if it exists
      try {
        await testDb.dropCollection(collName);
        console.log(`  -> Dropped existing collection in TEST.`);
      } catch (err: any) {
        if (err.codeName !== 'NamespaceNotFound') {
          console.warn(`  -> Warning dropping collection: ${err.message}`);
        }
      }

      // Read indexes from PROD
      const indexes = await prodDb.collection(collName).indexes();
      
      // Create collection in TEST
      await testDb.createCollection(collName);
      
      // Recreate indexes in TEST (excluding the default _id_ index)
      const indexesToCreate = indexes
        .filter(idx => idx.name !== '_id_')
        .map(idx => {
          // Remove internal properties that can't be copied directly
          const { v, ns, ...rest } = idx as any;
          return rest;
        });

      if (indexesToCreate.length > 0) {
        await testDb.collection(collName).createIndexes(indexesToCreate);
        console.log(`  -> Created ${indexesToCreate.length} indexes.`);
      }

      // Copy documents
      const docs = await prodDb.collection(collName).find({}).toArray();
      if (docs.length > 0) {
        await testDb.collection(collName).insertMany(docs);
        console.log(`  -> Inserted ${docs.length} documents.`);
      } else {
        console.log(`  -> Collection is empty. Skipped inserts.`);
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
