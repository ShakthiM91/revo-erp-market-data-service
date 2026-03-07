const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.EQUITY_DB_HOST || process.env.DB_HOST || 'localhost',
  port: process.env.EQUITY_DB_PORT || process.env.DB_PORT || 3306,
  user: process.env.EQUITY_DB_USER || process.env.DB_USER || 'root',
  password: process.env.EQUITY_DB_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.EQUITY_DB_NAME || 'revo_equity',
  connectionLimit: 5,
  waitForConnections: true,
  queueLimit: 0
});

module.exports = pool;
