require("dotenv").config();

const mysql = require("mysql2/promise");

const config = {
  db: {
    host: process.env.DB_CONTAINER,
    port: process.env.DB_PORT,
    user: process.env.MYSQL_ROOT_USER,
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
  },
};

const pool = mysql.createPool(config.db);

async function query(sql, params) {
  if (params === undefined || params === null || params.length === 0) {
    const [rows] = await pool.query(sql);
    return rows;
  }

  const [rows] = await pool.query(sql, params); // <-- was pool.execute()
  return rows;
}

async function waitForDb(retries, delayMs) {
  retries = retries || 10;
  delayMs = delayMs || 3000;

  for (var i = 1; i <= retries; i++) {
    try {
      var conn = await pool.getConnection();
      conn.release();
      console.log("Database connected successfully.");
      return;
    } catch (err) {
      console.log("Waiting for database, attempt " + i + "/" + retries + "...");
      if (i === retries) throw err;
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
  }
}

waitForDb();

module.exports = {
  query,
};