// ==UserScript==
// @name         MSO Cloud Autologin für Schulportal Hessen
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Loggt MSO-Cloud-Nutzer automatisch beim Schulportal Hessen (Schule 9743) ein, sofern sie im MSO-Portal angemeldet sind.
// @author       Antigravity
// @match        https://login.schulportal.hessen.de/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Schulnummer konfigurieren
    const targetSchoolID = "9743";

    // Prüfen, ob wir auf der richtigen Login-Seite sind
    const urlParams = new URLSearchParams(window.location.search);
    const currentSchoolID = urlParams.get('i');

    if (currentSchoolID !== targetSchoolID) {
        return; // Nur ausführen, wenn die Schule der MSO ausgewählt ist
    }

    // Eingabefelder auf der Schulportal-Seite suchen
    const userField = document.querySelector('input[name="user"]');
    const passwordField = document.querySelector('input[name="password"]');
    const submitButton = document.querySelector('button[type="submit"]');

    if (!userField || !passwordField) {
        return; // Felder noch nicht geladen oder bereits eingeloggt
    }

    // Ermittle die Basis-URL des MSO Cloud Portals
    // Die Erkennung passt sich automatisch an (localhost oder Produktion)
    const msoCloudOrigin = window.location.origin.includes('localhost') 
        ? "http://localhost:8080" 
        : window.location.origin; // Falls abweichend, kann hier "https://cloud.mso-hef.de" fest eingetragen werden

    const apiUrl = `${msoCloudOrigin}/api/auth/sph-credentials`;

    console.log("[MSO Cloud SPH Autologin] Frage temporäre Anmeldedaten ab von:", apiUrl);

    // GM_xmlhttpRequest verwenden, da dieses CORS-Restriktionen umgeht und Session-Cookies mitsendet
    GM_xmlhttpRequest({
        method: "GET",
        url: apiUrl,
        withCredentials: true,
        onload: function(response) {
            if (response.status === 200) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.logged_in && data.username && data.password) {
                        console.log("[MSO Cloud SPH Autologin] Anmeldedaten erfolgreich empfangen für:", data.username);
                        
                        // Felder ausfüllen
                        userField.value = data.username;
                        passwordField.value = data.password;

                        // Trigger Change-Events für modern JS-Frameworks auf SPH
                        userField.dispatchEvent(new Event('input', { bubbles: true }));
                        userField.dispatchEvent(new Event('change', { bubbles: true }));
                        passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                        passwordField.dispatchEvent(new Event('change', { bubbles: true }));

                        // Einloggen nach kurzem Timeout für maximale Stabilität
                        setTimeout(() => {
                            if (submitButton) {
                                console.log("[MSO Cloud SPH Autologin] Sende Formular ab...");
                                submitButton.click();
                            }
                        }, 500);
                    }
                } catch (e) {
                    console.error("[MSO Cloud SPH Autologin] Fehler beim Parsen der API-Antwort:", e);
                }
            } else {
                console.log("[MSO Cloud SPH Autologin] Keine aktive MSO Cloud Session oder nicht eingeloggt (Status: " + response.status + ")");
            }
        },
        onerror: function(err) {
            console.error("[MSO Cloud SPH Autologin] Netzwerkfehler bei Abfrage der MSO Cloud:", err);
        }
    });
})();
