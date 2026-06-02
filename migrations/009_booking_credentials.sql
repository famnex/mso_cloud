-- Tabelle für verschlüsselte Zugangsdaten des schulinternen Buchungssystems (classroombookings)
CREATE TABLE IF NOT EXISTS user_booking_credentials (
    user_id INTEGER PRIMARY KEY,
    booking_username TEXT NOT NULL,
    booking_password TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
