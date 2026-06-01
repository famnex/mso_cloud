<?php
// Fehlermeldungen aktivieren (optional, für Debugging)
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Datenbankverbindung einbinden
require_once('include/includes.php');

// Überprüfen, ob ein Token übergeben wurde
if (isset($_GET['token'])) {
    $token = $_GET['token'];
    
    // SQL-Abfrage zum Löschen des Tokens
    $sql = "DELETE FROM schueleremailtokens WHERE token = ?";
    $stmt = $conn->prepare($sql);
    
    if ($stmt) {
        $stmt->bind_param('s', $token);
        
        // Ausführen der Abfrage
        if ($stmt->execute()) {
            echo "Token erfolgreich gelöscht.";
        } else {
            echo "Fehler beim Löschen des Tokens.";
        }

        $stmt->close();
    } else {
        echo "Fehler bei der Vorbereitung der SQL-Anweisung.";
    }
} else {
    echo "Kein Token übergeben.";
}

// Datenbankverbindung schließen
$conn->close();
?>
