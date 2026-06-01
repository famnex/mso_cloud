-- Migration 005: Aktives News- und Nachrichten-System (Messages)
CREATE TABLE IF NOT EXISTS news_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL, -- 'temporary' oder 'until_confirmation'
  start_date TEXT,    -- ISO-String, z.B. '2026-06-01T12:00'
  end_date TEXT,      -- ISO-String, z.B. '2026-06-05T18:00'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_message_confirmations (
  user_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, message_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES news_messages(id) ON DELETE CASCADE
);
