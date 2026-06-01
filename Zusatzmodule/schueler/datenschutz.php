<?php
   require_once('../include/includes.php');	
     ?>
<html lang="de">
   <head>
      <title>SchülerInnenregistrierung</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
           <!-- JS -->
     <script src="<?php echo $basepath?>/../include/jquery/jquery-3.6.1.min.js"></script>
     <script src="<?php echo $basepath?>/../include/popper/popper.min.js"></script>
     <script src="<?php echo $basepath?>/../include/bootstrap/bootstrap.min.js"></script>

     <!-- CSS -->
     <link rel="stylesheet" href="<?php echo $basepath?>/../include/bootstrap/bootstrap.min.css">
     <link rel="stylesheet" href="<?php echo $basepath?>/../schueler/style.css">
      <style>
         body {
         background: url("media/background.jpg") no-repeat center center fixed;
         background-repeat: no-repeat;
         -webkit-background-size: cover;
         -moz-background-size: cover;
         -o-background-size: cover;
         background-size: cover;
         }
      </style>
   </head>
   <body>
      <!-- Navigationsleiste -->
      <nav class="navbar navbar-expand-sm bg-light">
         <ul class="navbar-nav">
            <a class="navbar-brand" href="#" style="color: black">
               <li>
                  <img src="../media/logo.png" alt="logo" style="width:40px;">
            </a>
            <a style="margin-top: 2%;color: black;position: relative;top: -11px;" class="navbar-brand">Schülerportal</a>
            </li>
         </ul>
      </nav>
      <br>
      <!--Begrüßung-->
      <div class="container tabcontent" id="emaillogin" style="width:80%">
         <div class="jumbotron text-white" style="background: #5f9e0f;">
            <!--BEGINN DSGVO-->
            <h1>Datenschutzerklärung</h1>
			<input class="btn btn-light text-body" type="button" id="submit" value="Zurück" onclick="history.back();">
			<br/><br/>
            <h2>Einleitung</h2>
            <p>Mit der folgenden Datenschutzerklärung möchten wir Sie darüber aufklären, welche Arten Ihrer personenbezogenen Daten (nachfolgend auch kurz als "Daten“ bezeichnet) wir zu welchen Zwecken und in welchem Umfang verarbeiten. Die Datenschutzerklärung gilt für alle von uns durchgeführten Verarbeitungen personenbezogener Daten auf unserem Dienst "Digitale Schulanmeldung".</p>
            <p>Die verwendeten Begriffe sind nicht geschlechtsspezifisch.</p>
            <p>Stand: 29. August 2022</p>
            <h2>Inhaltsübersicht</h2>
            <ul class="index">
               <li><a class="index-link" href="#m14">Einleitung</a></li>
               <li><a class="index-link" href="#m3">Verantwortlicher</a></li>
               <li><a class="index-link" href="#m11">Kontakt Datenschutzbeauftragter</a></li>
               <li><a class="index-link" href="#mOverview">Übersicht der Verarbeitungen</a></li>
               <li><a class="index-link" href="#m13">Maßgebliche Rechtsgrundlagen</a></li>
               <li><a class="index-link" href="#m27">Sicherheitsmaßnahmen</a></li>
               <li><a class="index-link" href="#m12">Löschung von Daten</a></li>
               <li><a class="index-link" href="#m182">Kontakt- und Anfragenverwaltung</a></li>
               <li><a class="index-link" href="#m15">Änderung und Aktualisierung der Datenschutzerklärung</a></li>
               <li><a class="index-link" href="#m10">Rechte der betroffenen Personen</a></li>
               <li><a class="index-link" href="#m42">Begriffsdefinitionen</a></li>
            </ul>
            <h2 id="m3">Verantwortlicher</h2>
            <p>Modellschule Obersberg<br>Am Obersberg 25<br>36251 Bad Hersfeld</p>
            Vertretungsberechtigte Personen: 
            <p>Karsten Backhaus</p>
            E-Mail-Adresse: 
            <p>verwaltung@mso-hef.de</p>
            <h2 id="m11">Kontakt Datenschutzbeauftragter</h2>
            <p>Jürgen Schenk (<a href="mailto:j.schenk@mso.hef.de">j.schenk@mso.hef.de</a>)</p>
            <h2 id="mOverview">Übersicht der Verarbeitungen</h2>
            <p>Die nachfolgende Übersicht fasst die Arten der verarbeiteten Daten und die Zwecke ihrer Verarbeitung zusammen und verweist auf die betroffenen Personen.</p>
            <h3>Arten der verarbeiteten Daten</h3>
            
			
			<?php
			$sql="SELECT * FROM pages";
            $result = $conn->query($sql);
            while($row = $result->fetch_assoc()) {
				echo "<h5>".$row['title']."</h5><ul>";
				$sql2="SELECT * FROM fields where page=".$row['ID']." order by position";
                $result2 = $conn->query($sql2);
				while($row2 = $result2->fetch_assoc()) {
					echo "<li>".$row2['title']."</li>";
				}
				echo "</ul>";
			}
			?>
            
            <h3>Kategorien betroffener Personen</h3>
            <ul>
               <li>Schüler.</li>
			   <li>Eltern.</li>
			   <li>Erziehungsberechtigte.</li>
			   <li>Ausbilder.</li>
            </ul>
            <h3>Zwecke der Verarbeitung</h3>
            <ul>
               <li>Stammdatenerfassung zur Übertragung an die LuSD.</li>
               <li>Sammeln von notwendigen Dokumenten zur Schulanmeldung.</li>
               <li>Erstellung eines Schülerausweises.*</li>
               <li>Generierung eines Leseausweises für die Mediothek.</li>
               <li>Erstellung von Zugangsdaten für verschiedene digitale Dienste der Schule.*</li>
			   <li>Sicherstellung der Datensicherheit des Anmeldesystems</li>
			   Der mit * gekennzeichneten Zwecke können im Verlauf der Anmeldung widersprochen werden.
            </ul>
            <h3 id="m13">Maßgebliche Rechtsgrundlagen</h3>
            <p>Im Folgenden erhalten Sie eine Übersicht der Rechtsgrundlagen der DSGVO, auf deren Basis wir personenbezogene Daten verarbeiten. Bitte nehmen Sie zur Kenntnis, dass neben den Regelungen der DSGVO nationale Datenschutzvorgaben in Ihrem bzw. unserem Wohn- oder Sitzland gelten können. Sollten ferner im Einzelfall speziellere Rechtsgrundlagen maßgeblich sein, teilen wir Ihnen diese in der Datenschutzerklärung mit.</p>
            <ul>
               <li><strong>Einwilligung (Art. 6 Abs. 1 S. 1 lit. a) DSGVO)</strong> - Die betroffene Person hat ihre Einwilligung zu der Verarbeitung der sie betreffenden personenbezogenen Daten für einen oder mehrere bestimmte Zwecke gegeben.</li>
               
            </ul>
            <p>Zusätzlich zu den Datenschutzregelungen der Datenschutz-Grundverordnung gelten nationale Regelungen zum Datenschutz in Deutschland. Hierzu gehört insbesondere das Gesetz zum Schutz vor Missbrauch personenbezogener Daten bei der Datenverarbeitung (Bundesdatenschutzgesetz – BDSG). Das BDSG enthält insbesondere Spezialregelungen zum Recht auf Auskunft, zum Recht auf Löschung, zum Widerspruchsrecht, zur Verarbeitung besonderer Kategorien personenbezogener Daten, zur Verarbeitung für andere Zwecke und zur Übermittlung sowie automatisierten Entscheidungsfindung im Einzelfall einschließlich Profiling. Des Weiteren regelt es die Datenverarbeitung für Zwecke des Beschäftigungsverhältnisses (§ 26 BDSG), insbesondere im Hinblick auf die Begründung, Durchführung oder Beendigung von Beschäftigungsverhältnissen sowie die Einwilligung von Beschäftigten. Ferner können Landesdatenschutzgesetze der einzelnen Bundesländer zur Anwendung gelangen.</p>
            <h2 id="m27">Sicherheitsmaßnahmen</h2>
            <p>Wir treffen nach Maßgabe der gesetzlichen Vorgaben unter Berücksichtigung des Stands der Technik, der Implementierungskosten und der Art, des Umfangs, der Umstände und der Zwecke der Verarbeitung sowie der unterschiedlichen Eintrittswahrscheinlichkeiten und des Ausmaßes der Bedrohung der Rechte und Freiheiten natürlicher Personen geeignete technische und organisatorische Maßnahmen, um ein dem Risiko angemessenes Schutzniveau zu gewährleisten.</p>
            <p>Zu den Maßnahmen gehören insbesondere die Sicherung der Vertraulichkeit, Integrität und Verfügbarkeit von Daten durch Kontrolle des physischen und elektronischen Zugangs zu den Daten als auch des sie betreffenden Zugriffs, der Eingabe, der Weitergabe, der Sicherung der Verfügbarkeit und ihrer Trennung. Des Weiteren haben wir Verfahren eingerichtet, die eine Wahrnehmung von Betroffenenrechten, die Löschung von Daten und Reaktionen auf die Gefährdung der Daten gewährleisten. Ferner berücksichtigen wir den Schutz personenbezogener Daten bereits bei der Entwicklung bzw. Auswahl von Hardware, Software sowie Verfahren entsprechend dem Prinzip des Datenschutzes, durch Technikgestaltung und durch datenschutzfreundliche Voreinstellungen.</p>
            <p>SSL-Verschlüsselung (https): Um Ihre via unserem Online-Angebot übermittelten Daten zu schützen, nutzen wir eine SSL-Verschlüsselung. Sie erkennen derart verschlüsselte Verbindungen an dem Präfix https:// in der Adresszeile Ihres Browsers.</p>
            <h2 id="m12">Löschung von Daten</h2>
            <p>Die von uns verarbeiteten Daten werden nach Maßgabe der gesetzlichen Vorgaben gelöscht, sobald deren zur Verarbeitung erlaubten Einwilligungen widerrufen werden oder sonstige Erlaubnisse entfallen (z.B. wenn der Zweck der Verarbeitung dieser Daten entfallen ist oder sie für den Zweck nicht erforderlich sind). Sofern die Daten nicht gelöscht werden, weil sie für andere und gesetzlich zulässige Zwecke erforderlich sind, wird deren Verarbeitung auf diese Zwecke beschränkt. D.h., die Daten werden gesperrt und nicht für andere Zwecke verarbeitet. Das gilt z.B. für Daten, die aus handels- oder steuerrechtlichen Gründen aufbewahrt werden müssen oder deren Speicherung zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen oder zum Schutz der Rechte einer anderen natürlichen oder juristischen Person erforderlich ist. </p>
            <p>Unsere Datenschutzhinweise können ferner weitere Angaben zu der Aufbewahrung und Löschung von Daten beinhalten, die für die jeweiligen Verarbeitungen vorrangig gelten.</p>
            <h2 id="m182">Kontakt- und Anfragenverwaltung</h2>
            <p>Bei der Kontaktaufnahme mit uns (z.B. per Kontaktformular, E-Mail, Telefon oder via soziale Medien) sowie im Rahmen bestehender Nutzer- und Geschäftsbeziehungen werden die Angaben der anfragenden Personen verarbeitet soweit dies zur Beantwortung der Kontaktanfragen und etwaiger angefragter Maßnahmen erforderlich ist.</p>
            <p>Die Beantwortung der Kontaktanfragen sowie die Verwaltung von Kontakt- und Anfragedaten im Rahmen von vertraglichen oder vorvertraglichen Beziehungen erfolgt zur Erfüllung unserer vertraglichen Pflichten oder zur Beantwortung von (vor)vertraglichen Anfragen und im Übrigen auf Grundlage der berechtigten Interessen an der Beantwortung der Anfragen und Pflege von Nutzer- bzw. Geschäftsbeziehungen.</p>
            <ul class="m-elements">
               <li><strong>Verarbeitete Datenarten:</strong> Kontaktdaten (z.B. E-Mail, Telefonnummern); Inhaltsdaten (z.B. Eingaben in Onlineformularen); Nutzungsdaten (z.B. besuchte Webseiten, Interesse an Inhalten, Zugriffszeiten); Meta-/Kommunikationsdaten (z.B. Geräte-Informationen, IP-Adressen).</li>
               <li><strong>Betroffene Personen:</strong> Kommunikationspartner.</li>
               <li><strong>Zwecke der Verarbeitung:</strong> Kontaktanfragen und Kommunikation; Verwaltung und Beantwortung von Anfragen; Feedback (z.B. Sammeln von Feedback via Online-Formular); Bereitstellung unseres Onlineangebotes und Nutzerfreundlichkeit; Erbringung vertraglicher Leistungen und Kundenservice.</li>
               <li><strong>Rechtsgrundlagen:</strong> Vertragserfüllung und vorvertragliche Anfragen (Art. 6 Abs. 1 S. 1 lit. b) DSGVO); Berechtigte Interessen (Art. 6 Abs. 1 S. 1 lit. f) DSGVO).</li>
            </ul>
            <p><strong>Weitere Hinweise zu Verarbeitungsprozessen, Verfahren und Diensten:</strong></p>
            <ul class="m-elements">
               <li><strong>Kontaktformular: </strong>Wenn Nutzer über unser Kontaktformular, E-Mail oder andere Kommunikationswege mit uns in Kontakt treten, verarbeiten wir die uns in diesem Zusammenhang mitgeteilten Daten zur Bearbeitung des mitgeteilten Anliegens. Zu diesem Zweck verarbeiten wir personenbezogene Daten im Rahmen vorvertraglicher und vertraglicher Geschäftsbeziehungen, soweit dies zu deren Erfüllung erforderlich ist und im Übrigen auf Grundlage unserer berechtigten Interessen sowie der Interessen der Kommunikationspartner an der Beantwortung der Anliegen und unserer gesetzlichen Aufbewahrungspflichten; <strong>Rechtsgrundlagen:</strong> Art. 6 Abs. 1 S. 1 lit. 4 DSGVO</li>
            </ul>
            <h2 id="m15">Änderung und Aktualisierung der Datenschutzerklärung</h2>
            <p>Wir bitten Sie, sich regelmäßig über den Inhalt unserer Datenschutzerklärung zu informieren. Wir passen die Datenschutzerklärung an, sobald die Änderungen der von uns durchgeführten Datenverarbeitungen dies erforderlich machen. Wir informieren Sie, sobald durch die Änderungen eine Mitwirkungshandlung Ihrerseits (z.B. Einwilligung) oder eine sonstige individuelle Benachrichtigung erforderlich wird.</p>
            <p>Sofern wir in dieser Datenschutzerklärung Adressen und Kontaktinformationen von Unternehmen und Organisationen angeben, bitten wir zu beachten, dass die Adressen sich über die Zeit ändern können und bitten die Angaben vor Kontaktaufnahme zu prüfen.</p>
            <h2 id="m10">Rechte der betroffenen Personen</h2>
            <p>Ihnen stehen als Betroffene nach der DSGVO verschiedene Rechte zu, die sich insbesondere aus Art. 15 bis 21 DSGVO ergeben:</p>
            <ul>
               <li><strong>Widerspruchsrecht: Sie haben das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit gegen die Verarbeitung der Sie betreffenden personenbezogenen Daten, die aufgrund von Art. 6 Abs. 1 lit. e oder f DSGVO erfolgt, Widerspruch einzulegen; dies gilt auch für ein auf diese Bestimmungen gestütztes Profiling. Werden die Sie betreffenden personenbezogenen Daten verarbeitet, um Direktwerbung zu betreiben, haben Sie das Recht, jederzeit Widerspruch gegen die Verarbeitung der Sie betreffenden personenbezogenen Daten zum Zwecke derartiger Werbung einzulegen; dies gilt auch für das Profiling, soweit es mit solcher Direktwerbung in Verbindung steht.</strong></li>
               <li><strong>Widerrufsrecht bei Einwilligungen:</strong> Sie haben das Recht, erteilte Einwilligungen jederzeit zu widerrufen.</li>
               <li><strong>Auskunftsrecht:</strong> Sie haben das Recht, eine Bestätigung darüber zu verlangen, ob betreffende Daten verarbeitet werden und auf Auskunft über diese Daten sowie auf weitere Informationen und Kopie der Daten entsprechend den gesetzlichen Vorgaben.</li>
               <li><strong>Recht auf Berichtigung:</strong> Sie haben entsprechend den gesetzlichen Vorgaben das Recht, die Vervollständigung der Sie betreffenden Daten oder die Berichtigung der Sie betreffenden unrichtigen Daten zu verlangen.</li>
               <li><strong>Recht auf Löschung und Einschränkung der Verarbeitung:</strong> Sie haben nach Maßgabe der gesetzlichen Vorgaben das Recht, zu verlangen, dass Sie betreffende Daten unverzüglich gelöscht werden, bzw. alternativ nach Maßgabe der gesetzlichen Vorgaben eine Einschränkung der Verarbeitung der Daten zu verlangen.</li>
               <li><strong>Recht auf Datenübertragbarkeit:</strong> Sie haben das Recht, Sie betreffende Daten, die Sie uns bereitgestellt haben, nach Maßgabe der gesetzlichen Vorgaben in einem strukturierten, gängigen und maschinenlesbaren Format zu erhalten oder deren Übermittlung an einen anderen Verantwortlichen zu fordern.</li>
               <li><strong>Beschwerde bei Aufsichtsbehörde:</strong> Sie haben unbeschadet eines anderweitigen verwaltungsrechtlichen oder gerichtlichen Rechtsbehelfs das Recht auf Beschwerde bei einer Aufsichtsbehörde, insbesondere in dem Mitgliedstaat ihres gewöhnlichen Aufenthaltsorts, ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes, wenn Sie der Ansicht sind, dass die Verarbeitung der Sie betreffenden personenbezogenen Daten gegen die Vorgaben der DSGVO verstößt.</li>
            </ul>
			<h2 id="N">Nutzung externer Tools</h2>
			<p>Wir nutzen extern entwickelte Werkzeuge, um die Webseite zu betreiben. Diese werden jedoch, wie die gesamte Webseite, lokal auf unseren Schulservern gehostet. Genutzt werden:</p>
			<ul>
			<li>jQuery</li>
			<li>Popper</li>
			<li>Bootstrap</li>
			<li>Google Fonts</li>
			<li>pico</li>
			<li>crop</li>
			<li>fontawesome</li>
			<li>facefinder</li>
			</ul>
						
            <h2 id="m42">Begriffsdefinitionen</h2>
            <p>In diesem Abschnitt erhalten Sie eine Übersicht über die in dieser Datenschutzerklärung verwendeten Begrifflichkeiten. Viele der Begriffe sind dem Gesetz entnommen und vor allem im Art. 4 DSGVO definiert. Die gesetzlichen Definitionen sind verbindlich. Die nachfolgenden Erläuterungen sollen dagegen vor allem dem Verständnis dienen. Die Begriffe sind alphabetisch sortiert.</p>
            <ul class="glossary">
               <li><strong>Personenbezogene Daten:</strong> "Personenbezogene Daten“ sind alle Informationen, die sich auf eine identifizierte oder identifizierbare natürliche Person (im Folgenden "betroffene Person“) beziehen; als identifizierbar wird eine natürliche Person angesehen, die direkt oder indirekt, insbesondere mittels Zuordnung zu einer Kennung wie einem Namen, zu einer Kennnummer, zu Standortdaten, zu einer Online-Kennung (z.B. Cookie) oder zu einem oder mehreren besonderen Merkmalen identifiziert werden kann, die Ausdruck der physischen, physiologischen, genetischen, psychischen, wirtschaftlichen, kulturellen oder sozialen Identität dieser natürlichen Person sind. </li>
               <li><strong>Verantwortlicher:</strong> Als "Verantwortlicher“ wird die natürliche oder juristische Person, Behörde, Einrichtung oder andere Stelle, die allein oder gemeinsam mit anderen über die Zwecke und Mittel der Verarbeitung von personenbezogenen Daten entscheidet, bezeichnet. </li>
               <li><strong>Verarbeitung:</strong> "Verarbeitung" ist jeder mit oder ohne Hilfe automatisierter Verfahren ausgeführte Vorgang oder jede solche Vorgangsreihe im Zusammenhang mit personenbezogenen Daten. Der Begriff reicht weit und umfasst praktisch jeden Umgang mit Daten, sei es das Erheben, das Auswerten, das Speichern, das Übermitteln oder das Löschen. </li>
            </ul>
            <p class="seal"><a href="https://datenschutz-generator.de/" title="Rechtstext von Dr. Schwenke - für weitere Informationen bitte anklicken." target="_blank" rel="noopener noreferrer nofollow"><img src="https://datenschutz-generator.de/wp-content/plugins/ts-dsg/images/dsg-seal/dsg-seal-pp-de.png" alt="Rechtstext von Dr. Schwenke - für weitere Informationen bitte anklicken." width="250" height="250"></a></p>
            <!--ENDE DSGVO-->
			<input class="btn btn-light text-body" type="button" id="submit" value="Zurück" onclick="history.back();">
         </div>
      </div>
   </body>
</html>