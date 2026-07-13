const fs = require('fs');
const path = require('path');
const dbHelper = require('./db');

const compactPath = path.join(__dirname, 'site24x7_compact.json');

if (!fs.existsSync(compactPath)) {
  console.error(`Error: ${compactPath} not found.`);
  process.exit(1);
}

console.log('Reading site24x7_compact.json...');
const data = JSON.parse(fs.readFileSync(compactPath, 'utf8'));

console.log('Migrating sheet descriptions...');
const sheetDescriptions = data.sheetDescriptions || {};
for (const [sheet, description] of Object.entries(sheetDescriptions)) {
  dbHelper.saveSheetDescription(sheet, description);
}
console.log(`Successfully migrated ${Object.keys(sheetDescriptions).length} sheet descriptions.`);

console.log('Migrating API entries...');
const apis = data.apis || [];
const db = dbHelper.db;

// Wrap in a transaction for speed
const insertTransaction = db.transaction((apiList) => {
  for (const api of apiList) {
    dbHelper.saveApi(api);
  }
});

insertTransaction(apis);
console.log(`Successfully migrated ${apis.length} API entries to SQLite.`);

console.log('Migration completed!');
