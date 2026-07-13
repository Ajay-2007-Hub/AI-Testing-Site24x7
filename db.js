const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'site24x7.db');
const db = new Database(dbPath);

// Initialize table
db.exec(`
  CREATE TABLE IF NOT EXISTS query_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT,
    timestamp TEXT,
    top_result_api_id INTEGER,
    top_result_score REAL,
    results_json TEXT,
    feedback TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS sheet_descriptions (
    sheet TEXT PRIMARY KEY,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS apis (
    id INTEGER PRIMARY KEY,
    sheet TEXT,
    subFeature TEXT,
    endpoint TEXT,
    method TEXT,
    statusCode TEXT,
    description TEXT,
    requestFields TEXT,
    responseFields TEXT,
    summaryText TEXT,
    requestPayload TEXT,
    searchText TEXT,
    module TEXT,
    subModule TEXT
  );
`);

/**
 * Log a semantic search query and its top results
 */
function logQuery(queryText, topResultApiId, topResultScore, resultsJson) {
  const timestamp = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO query_log (query, timestamp, top_result_api_id, top_result_score, results_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(queryText, timestamp, topResultApiId, topResultScore, resultsJson);
  return info.lastInsertRowid;
}

/**
 * Update feedback for a query log entry
 */
function updateFeedback(id, correct) {
  const feedbackValue = correct ? 'correct' : 'incorrect';
  const stmt = db.prepare(`
    UPDATE query_log
    SET feedback = ?
    WHERE id = ?
  `);
  const info = stmt.run(feedbackValue, id);
  return info.changes > 0;
}

/**
 * Get all API entries from SQLite
 */
function getAllApis() {
  const stmt = db.prepare('SELECT * FROM apis');
  const rows = stmt.all();
  return rows.map(row => ({
    ...row,
    requestFields: JSON.parse(row.requestFields || '[]'),
    responseFields: JSON.parse(row.responseFields || '[]')
  }));
}

/**
 * Get all sheet descriptions from SQLite as a key-value object
 */
function getSheetDescriptions() {
  const stmt = db.prepare('SELECT * FROM sheet_descriptions');
  const rows = stmt.all();
  const descriptions = {};
  for (const row of rows) {
    descriptions[row.sheet] = row.description;
  }
  return descriptions;
}

/**
 * Insert or replace a sheet description
 */
function saveSheetDescription(sheet, description) {
  const stmt = db.prepare('INSERT OR REPLACE INTO sheet_descriptions (sheet, description) VALUES (?, ?)');
  stmt.run(sheet, description);
}

/**
 * Insert or replace an API entry
 */
function saveApi(api) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO apis (
      id, sheet, subFeature, endpoint, method, statusCode, description,
      requestFields, responseFields, summaryText, requestPayload, searchText, module, subModule
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    api.id,
    api.sheet,
    api.subFeature,
    api.endpoint,
    api.method,
    api.statusCode,
    api.description,
    JSON.stringify(api.requestFields || []),
    JSON.stringify(api.responseFields || []),
    api.summaryText,
    api.requestPayload,
    api.searchText,
    api.module,
    api.subModule
  );
}

module.exports = {
  db,
  logQuery,
  updateFeedback,
  getAllApis,
  getSheetDescriptions,
  saveSheetDescription,
  saveApi
};

