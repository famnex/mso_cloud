 <?php
require_once('../include/includes.php');	
$sql="SELECT * FROM settings";
$result = $conn->query($sql);
while($row = $result->fetch_assoc()) { 
	if($row['setting']=="maintainance"&&$row['value']=="1") $gesperrt=true;
	if($row['setting']=="maintainancetext") $text=$row['value'];	
}
if($gesperrt) die("<center><h1>Wartungsarbeiten</h1>".$text."</center>");
  ?>

 <html lang="de">

 <head>
     <title>Schülerportal</title>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">

     <!-- JS -->
     <script src="<?php echo $basepath?>/../include/jquery/jquery-3.6.1.min.js"></script>
     <script src="<?php echo $basepath?>/../include/popper/popper.min.js"></script>
     <script src="<?php echo $basepath?>/../include/bootstrap/bootstrap.min.js"></script>

     <!-- CSS -->
     <link rel="stylesheet" href="<?php echo $basepath?>/../include/bootstrap/bootstrap.min.css">
     <link rel="stylesheet" href="<?php echo $basepath?>/../schueler/style.css">







 </head>

 <body>

     <!-- Navigationsleiste -->
     <nav class="navbar navbar-expand-sm bg-light stickynav">
         <ul class="navbar-nav">
         <img src="../media/logo.png" alt="logo" style="width:40px;">
         </ul>    
<ul>
             <a style="color: black;font-size: 110%;" >Schülerportal</a>
			 </ul>
			 <ul>
			 <b>Hilfe benötigt?</b> <span style="white-space: nowrap;"><i class="fa-solid fa-phone"></i> <a href="https://cloud.mso-hef.de/osticket/">Ticket erstellen!</a></span>
			 </ul>
			 
		
     </nav>
      <br>




	 <!--Begrüßung-->
     <div class="container tabcontent" id="emaillogin">
         <div class="jumbotron text-white" style="background: #5f9e0f;">
             <h1>Herzlich willkommen!</h1>

             <p>
                 Benutzerkonten inklusive Passwörter und weitere Daten können über das Schülerportal abgefragt werden.<br>
                 Um sicherzustellen, dass Ihre Daten sicher sind und damit wir Sie erreichen können, benötigen wir zuerst Ihre E-Mail-Adresse.<br><br>
                 Im nächsten Schritt erhalten Sie dann eine E-Mail von uns. Nutzen Sie den Link in dieser E-Mail, um sich im System anzumelden.<br><br>
                 Prüfen Sie bitte auch ihren Spam-Ordner.<br><br>
				 <b>Hinweis: Sollte Ihr Benutzerkonto noch nicht erstellt worden sein, dann erhalten Sie hier auch noch keine E-Mail. Das funktioniert erst, nachdem wir Ihnen die Begrüßungsmail zugesandt haben. Bitte warten Sie diese E-Mail ab!</b>

             </p>
             <form method="post" action="javascript:;" onsubmit="senden()">
                 E-Mail-Adresse:<br>
                 <input class="form-control" type="text" size="40" maxlength="250" id="email" style="background:white!important;"><br>
				 <input type="checkbox" id="hinweise_gelesen" name="hinweise_gelesen" style="
    width: 19px;
    height: 19px;
"> <label for="hinweise_gelesen" style="display:inline;">Mit dem Aktivieren dieses Kästchens und dem Absenden dieses Formulars erklären Sie sich damit einverstanden, dass Ihre Daten verwendet und digital verarbeitet werden. Weitere Informationen und Widerrufshinweise finden Sie in der <a href="datenschutz.php"><b>Datenschutzerklärung</b></a>.</label><br><br>
                 <input class="btn btn-light text-body" type="button" id="submit" value="Anmeldelink anfordern" onclick="senden();">
                 <!--<a href="https://cloud.mso-hef.de/osticket/kb/faq.php?id=23" class="btn text-body btn-warning">Hilfe</a>--><br><div id="tenor"><img class="tenor" src="<?php echo $basepath?>/media/tenor.gif"/> Bitte warten</div>


             </form>




         </div>
     </div>
	 <!--Danke->Email gesendet-->
	 <div class="container tabcontent" id="emailsent" style="display:none">
         <div class="jumbotron text-white" style="background: #5f9e0f;">
             <h1>Vielen Dank!</h1>

             <p>
                 Wir haben Ihnen gerade eine E-Mail geschickt.<br>
                 In dieser E-Mail befindet sich ein Link. Bitte klicken Sie auf den Link, um sich im System anzumelden.<br><br>
                 Prüfen Sie bitte auch ihren Spam-Ordner. Sie können diese Seite jetzt schließen.<br><br>

             </p>
             




         </div>
     </div>
	 <!--Fehlermeldung-->
	 <div class="container tabcontent" id="error" style="display:none">
         <div class="jumbotron text-white" style="background: #5f9e0f;">
             <h1>Fehler :(</h1>

             <p>
                 Leider ist beim Versand Ihrer E-Mail ein Fehler aufgetreten.<br>
                 Bitte prüfen Sie, ob die Eingegebene E-Mail-Adresse<br>
				 <center><b><div id='maildisplay'></div></b></center><br>
				 korrekt ist. Sollte dies nicht der Fall sein, dann ändern Sie bitte Ihre E-Mail-Adresse. Tritt der Fehler weiter auf, dann kontaktieren Sie uns bitte unter itadmins@mso-hef.de, da es sich auch um eine technische Störung handeln könnte.<br><br>Fehlercode: <div id='errormessage'></div><br><br>
				 <a class="btn text-body btn-warning" onclick="location.reload();">E-Mail-Adresse ändern</a>
                 
				

             </p>
             




         </div>
     </div>


 </body>
 <script>
     function senden() {
		 var checkBox = document.getElementById("hinweise_gelesen");
		 if (checkBox.checked == false) alert("Sie müssen die Hinweise zum Datenschutz akzeptieren."); 
		 else {
			 document.getElementById("submit").disabled = true;
			 document.getElementById("tenor").style.display = "block";
			 var email = document.getElementById("email").value;
			 document.getElementById("maildisplay").innerHTML = email;
			 var sendData = function() {
				 $.post('sendmaillogin.php', {
					 email: email
				 }, function(response) {
					 console.log(response);
					 var message = response;
					 document.getElementById("emaillogin").style.display = "none";
					 if(message[0]=='0') {
					 document.getElementById("error").style.display = "block";
					 alert("Beim Versenden der E-Mail ist ein Fehler aufgetreten. Prüfen Sie die E-Mail-Adresse und versuchen Sie es erneut.");
					 }
					 if(message[0]=='1') {
					 document.getElementById("error").style.display = "block";
					 alert("Beim Versenden der E-Mail ist ein Fehler aufgetreten. Prüfen Sie die E-Mail-Adresse und versuchen Sie es erneut.");
					 }
					 if(message[0]=='2')
					 document.getElementById("emailsent").style.display = "block";
					 document.getElementById("errormessage").innerHTML = message.substr(1,message.length-1);
				 });
			 }
			 sendData();
		 }
	 }
 </script>

 </html>