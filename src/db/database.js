const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_DB_PATH = path.join(DB_DIR, 'reminders.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

let dbInstance = null;

/**
 * Initializes and returns the SQLite database instance.
 * Ensures foreign keys and WAL mode are enabled, and executes schema DDL.
 */
function initDatabase(customPath) {
  const targetPath = customPath || DB_PATH;

  // Ensure data directory exists if not using memory db
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);

  // Enable foreign key constraints and WAL mode for high concurrency
  db.pragma('foreign_keys = ON');
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  // Run schema initialization
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }

  dbInstance = db;
  return db;
}

/**
 * Returns the active database instance, initializing if necessary.
 */
function getDatabase() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

/**
 * Close database connection
 */
function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase
};
