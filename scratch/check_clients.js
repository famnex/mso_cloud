const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/mso_cloud.db');
const db = new Database(DB_PATH);

console.log('--- REGISTRIERTE OAUTH CLIENTS ---');
try {
  const clients = db.prepare('SELECT id, client_name, client_id, redirect_uri FROM oauth_clients').all();
  console.log(JSON.stringify(clients, null, 2));
} catch (error) {
  console.error('Fehler beim Auslesen:', error.message);
}
db.close();
