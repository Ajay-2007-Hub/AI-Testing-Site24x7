const dbHelper = require('./db');

/**
 * Computes accuracy statistics from the query log.
 */
function getAccuracyStats() {
  const db = dbHelper.db;
  
  // Total queries logged
  const totalQueriesRow = db.prepare('SELECT COUNT(*) AS total FROM query_log').get();
  const total_queries = totalQueriesRow ? totalQueriesRow.total : 0;
  
  // Total feedback given
  const feedbackCountRow = db.prepare(`
    SELECT COUNT(*) AS count FROM query_log 
    WHERE feedback IN ('correct', 'incorrect')
  `).get();
  const feedback_count = feedbackCountRow ? feedbackCountRow.count : 0;
  
  // Correct feedback count
  const correctCountRow = db.prepare(`
    SELECT COUNT(*) AS count FROM query_log 
    WHERE feedback = 'correct'
  `).get();
  const correctCount = correctCountRow ? correctCountRow.count : 0;
  
  // Calculate accuracy percentage
  const accuracy_pct = feedback_count > 0 ? parseFloat(((correctCount / feedback_count) * 100).toFixed(2)) : 0.0;
  
  return {
    total_queries,
    feedback_count,
    accuracy_pct
  };
}

module.exports = {
  getAccuracyStats
};
