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

module.exports = {
  db,
  logQuery,
  updateFeedback
};
