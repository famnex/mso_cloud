
 <html lang="de">

 <head>
     <title>MSO Cloud</title>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">

     <!-- JS -->
     <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>
     <script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.16.0/umd/popper.min.js"></script>
     <script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>

     <!-- CSS -->
     <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
     <link rel="stylesheet" href="style.css">
     <!-- FONTS -->
     <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
     <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128+Text&family=Open+Sans&display=swap" rel="stylesheet">
	 <script src="https://kit.fontawesome.com/a974660f94.js" crossorigin="anonymous"></script>




 </head>

 <body>

     <!-- Navigationsleiste -->
     <nav class="navbar navbar-expand-sm bg-light stickynav">
         <ul class="navbar-nav">
         <img src="logo.png" alt="logo" style="width:40px;">
         </ul>    
<ul>
             <a style="color: black;font-size: 110%;" >Die digitalen Dienste der MSO</a>
			 </ul>
			 <!--
			 <ul>
			 <b>Hilfe benötigt?</b> <span style="white-space: nowrap;"><i class="fa-solid fa-phone"></i> </span>
			 </ul>
             <ul>
			 -->
         </ul>
     </nav>
     <br>

	 <!--Formular-->
	 <div style="min-height:81%;">
	 <div class="container tabcontent maincontainer" id="error">
         <div class="jumbotron text-white" style="background: rgba(2, 64, 134, 0.9);">
             <h2>Liebe Schülerinnen und Schüler, liebe Kolleginnen und Kollegen, liebe Erziehungsberechtigte,</h2>

           auf dieser Auswahlseite erhalten Sie einen Überblick über die Cloud-Dienste der MSO und die Ausleihe der Geräte für den Distanzunterricht.
			  <br><br>
			  <div class="lobbyflex">
			  
			 
			  <div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/moodle/login/index.php');"><div class="lobbydataname"><b>Moodle</b></div><div class="lobbydata"><div style="font-size:9pt">Das LMS der Modellschule Obersberg</div></div><div class="lobbystatus" id="status_1" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-graduation-cap fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/osticket23');"><div class="lobbydataname"><b>Ticketsystem</b></div><div class="lobbydata"><div style="font-size:9pt">Fehlermeldungen bezüglich Hardwar, Software und Internet bitte hier einreichen</div></div><div class="lobbystatus" id="status_2" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-ticket fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/osticket23/kb/index.php');"><div class="lobbydataname"><b>Wissensdatenbank</b></div><div class="lobbydata"><div style="font-size:9pt">Alles Wissenswerte zu unseren Diensten. Wlan-Anmeldung, Office, Moodle, Onlinedienste und vieles mehr.</div></div><div class="lobbystatus" id="status_3" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-brain fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/launcher/booking/index.php/login');"><div class="lobbydataname"><b>Buchungskalender</b></div><div class="lobbydata"><div style="font-size:9pt">Raum- und Medienbuchungssystem</div></div><div class="lobbystatus" id="status_4" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-calendar-check fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/nextcloud');"><div class="lobbydataname"><b>Nextcloud</b></div><div class="lobbydata"><div style="font-size:9pt">Verbindung zum Schullaufwerk.</div></div><div class="lobbystatus" id="status_5" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-regular fa-folder-open fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://login.microsoftonline.com/?whr=mso-hef.de&sso_reload=true');"><div class="lobbydataname"><b>Microsoft 365</b></div><div class="lobbydata"><div style="font-size:9pt">Verbindung zu den Office-Diensten. Hier kann Office auch heruntergeladen werden.</div></div><div class="lobbystatus" id="status_6" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-brands fa-windows fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://outlook.com/mso-hef.de');"><div class="lobbydataname"><b>Outlook</b></div><div class="lobbydata"><div style="font-size:9pt">Outlook Schulpostfach für Lehrkräfte</div></div><div class="lobbystatus" id="status_7" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-regular fa-envelope fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/kalender_new');"><div class="lobbydataname"><b>Schulkalender</b></div><div class="lobbydata"><div style="font-size:9pt">Termine der Schule</div></div><div class="lobbystatus" id="status_8" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-regular fa-calendar fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://form.jotform.com/212721866101347');"><div class="lobbydataname"><b>Unterrichtsbefreiung für Lehrkräfte</b></div><div class="lobbydata"><div style="font-size:9pt">Onlineformular zur Unterrichtsbefreiung</div></div><div class="lobbystatus" id="status_9" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-regular fa-calendar-xmark fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/launcher/termin_new/server/public/');"><div class="lobbydataname"><b>Terminvereinbarung</b></div><div class="lobbydata"><div style="font-size:9pt">Termine können hier gebucht werden.</div></div><div class="lobbystatus" id="status_10" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-calendar-days fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/launcher/anmeldung_benutzerprofil.php');"><div class="lobbydataname"><b>Schulanmeldung & Benutzerprofil</b></div><div class="lobbydata"><div style="font-size:9pt">Hier meldet man sich für die MSO an. Diese Anmeldung ersetzt die klassische Papieranmeldung.

Neues Foto für den Schülerausweis? Benutzerdaten inklusive Passwort abrufen? Das geht hier!</div></div><div class="lobbystatus" id="status_11" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"></i><i class="fa-solid fa-person-circle-plus fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/launcher/dsb/');"><div class="lobbydataname"><b>Vertretungsplan</b></div><div class="lobbydata"><div style="font-size:9pt">Der Vertretungsplan - nur online.</div></div><div class="lobbystatus" id="status_15" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-virus fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://login.schulportal.hessen.de/?i=9743');"><div class="lobbydataname"><b>Schulportal Hessen</b></div><div class="lobbydata"><div style="font-size:9pt">Zu Testzwecken für ausgewählte Kurse.</div></div><div class="lobbystatus" id="status_16" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-school fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/launcher/fobi');"><div class="lobbydataname"><b>Fortbildungssystem</b></div><div class="lobbydata"><div style="font-size:9pt">Zu schulinternen Fortbildungen anmelden und interne Fortbildung anbieten.</div></div><div class="lobbystatus" id="status_17" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-chalkboard-user fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://cloud.mso-hef.de/mahara');"><div class="lobbydataname"><b>Mahara</b></div><div class="lobbydata"><div style="font-size:9pt">Erstelle dein eigenes digitales Portfolio mit Mahara!</div></div><div class="lobbystatus" id="status_14" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-id-badge fa-2xl"></i></div></div><div class="lobbybox" onclick="openlink('https://www.mso-hef.de/impressum/');"><div class="lobbydataname"><b>Impressum</b></div><div class="lobbydata"><div style="font-size:9pt">Das Impressum unserer Homepage</div></div><div class="lobbystatus" id="status_12" style="background:gray;" data-toggle="tooltip" title="Wird geprüft..."> </div><div class="icon"><i class="fa-solid fa-gavel fa-2xl"></i></div></div>			  			  
			  
              </div>  
             <br>
			 
			 
			 
				

             </p>
             




         </div>
     </div>

</div>
<!--
<div class="navbar navbar-expand-sm bg-light stickynav_bottom">
               <a class="btn text-body btn-success" onclick="location.reload();">Aktualisieren</a>
			 <a class="btn text-body btn-Danger" onclick="logoff();">Abmelden</a>
			 <a class="btn text-body btn-Warning" onclick="window.open('hilfe/index.php','_blank');">Hilfe</a> 
			 <div id="errormessage"></div>
            </div>
			
			-->
	
<script>
    $(document).ready(function() {
        // Aktiviert Tooltips für alle Elemente, die data-toggle="tooltip" verwenden
        $('[data-toggle="tooltip"]').tooltip();

        // Prüfe alle Links asynchron
        $(".lobbybox").each(function() {
            var link = $(this).attr("onclick").match(/openlink\('(.+)'\)/)[1];
            var elementId = $(this).find(".lobbystatus").attr("id");
            var lobbybox = $(this);

            // Timeout-Variable zum Feststellen, ob die Anfrage abgeschlossen wurde
            var requestCompleted = false;

            // AJAX-Aufruf zur Überprüfung des Links
            var xhr = $.ajax({
                url: 'check_links.php',
                type: 'GET',
                data: { link: link },
                timeout: 10000, // 10 Sekunden Timeout
                success: function(response) {
                    requestCompleted = true;
                    var result = JSON.parse(response);
                    // Setze die Hintergrundfarbe und aktualisiere den Tooltip
                    $("#" + elementId).css("background", "#" + result.color);
                    $("#" + elementId).attr("title", result.reason).tooltip('dispose').tooltip();

                    // Wenn der Link nicht erreichbar ist, die Box deaktivieren
                    if (result.color === "e77f7f") {
                        disableLobbybox(lobbybox);
                    }
                },
                error: function() {
                    requestCompleted = true;
                    // Fehlerfall: Hintergrund auf Rot setzen und Tooltip-Text aktualisieren
                    $("#" + elementId).css("background", "#e77f7f");
                    $("#" + elementId).attr("title", "Fehler bei der Überprüfung").tooltip('dispose').tooltip();
                    disableLobbybox(lobbybox); // Box deaktivieren
                }
            });

            // Setze ein Timeout, um zu prüfen, ob die Anfrage innerhalb von 10 Sekunden abgeschlossen ist
            setTimeout(function() {
                if (!requestCompleted) {
                    // Anfrage hat das Timeout überschritten
                    xhr.abort(); // Anfrage abbrechen
                    $("#" + elementId).css("background", "#ffa500"); // Orange setzen
                    $("#" + elementId).attr("title", "Timeout: Keine Antwort nach 10 Sekunden").tooltip('dispose').tooltip();
                    disableLobbybox(lobbybox); // Box deaktivieren
                }
            }, 10000);
        });

        // Funktion zum Deaktivieren der Lobbybox
        function disableLobbybox(lobbybox) {
            lobbybox.addClass("disabled"); // Füge die Klasse 'disabled' hinzu
            lobbybox.off("click"); // Deaktiviere Klick-Events
            lobbybox.removeAttr("onclick"); // Entferne das onclick-Attribut
            lobbybox.append('<div class="unavailable-message">Dienst momentan nicht verfügbar.</div>'); // Hinweis hinzufügen
        }
    });
</script>





 </body>
<script>

	 
	 function openlink(link) {
			if(status==0){
				document.location.href=link;
			}
	 }
	 
	 

 </script>

 </html>