const mysql = require('mysql2/promise');
require('dotenv').config();

// Determine database environment target:
// 1. Explicit toggle via DB_TARGET ('live' vs 'local') or USE_LIVE_DB
// 2. Auto-detected live host environments (Render sets RENDER=true, Clever Cloud sets MYSQL_ADDON_URI, etc.)
// 3. Defaults to 'local' for development on your machine
const isLiveEnvironment =
  process.env.DB_TARGET === 'live' ||
  process.env.USE_LIVE_DB === 'true' ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.MYSQL_ADDON_URI) ||
  Boolean(process.env.DATABASE_URL) ||
  (process.env.NODE_ENV === 'production' && process.env.DB_TARGET !== 'local');

let pool;

if (isLiveEnvironment) {
  // Live Cloud Database (Clever Cloud MySQL)
  const connectionUri =
    process.env.MYSQL_ADDON_URI ||
    process.env.DATABASE_URL ||
    process.env.LIVE_DB_URL ||
    `mysql://${process.env.LIVE_DB_USER || 'uvol69qsx7zwp2kg'}:${process.env.LIVE_DB_PASSWORD || 'YMO5QiHSWM2yWWTNQRx8'}@${process.env.LIVE_DB_HOST || 'b3q5arkwch2mobje41a1-mysql.services.clever-cloud.com'}:${process.env.LIVE_DB_PORT || '3306'}/${process.env.LIVE_DB_NAME || 'b3q5arkwch2mobje41a1'}`;

  console.log('🌐 [DB] Mode: LIVE (Clever Cloud MySQL: b3q5arkwch2mobje41a1)');

  pool = mysql.createPool({
    uri: connectionUri,
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
} else {
  // Local Database (Localhost XAMPP / MySQL)
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const database = process.env.DB_NAME || 'notes_db';

  console.log(`💻 [DB] Mode: LOCAL MySQL (${host}:${port}/${database})`);

  pool = mysql.createPool({
    host,
    port,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    waitForConnections: true,
    connectionLimit: 25,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
}

// Verification ping on boot
pool
  .query('SELECT 1')
  .then(() => {
    console.log(`✅ [DB] Successfully connected to ${isLiveEnvironment ? 'LIVE Clever Cloud' : 'LOCAL'} database.`);
  })
  .catch((err) => {
    console.error(`❌ [DB] Connection error (${isLiveEnvironment ? 'LIVE' : 'LOCAL'}):`, err.message);
  });

module.exports = pool;
