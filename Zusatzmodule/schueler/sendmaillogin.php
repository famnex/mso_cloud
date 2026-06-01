<?php
require_once('../include/includes.php');
if(isset($_POST["email"])) $email=$_POST["email"]; else die("0"); //Keine Emailadresse

$token=bin2hex(random_bytes(24));

$text_success='<h2>Guten Tag,</h2>vielen Dank, dass Sie sich mit dieser E-Mail-Adresse beim Schülerportal der Modellschule Obersberg in Bad Hersfeld angemeldet haben.<br>Um sich im System anzumelden, können Sie folgenden Link nutzen:<br><br>
<a href="'.$basepath.'/schueler/lobby.php?token='.$token.'">Schülerportal MSO</a><br><br>
Dieser Link ist für 20 Minuten gültig. Sollte er abgelaufen sein, dann können Sie sich über <a href="'.$basepath.'/schueler">diese Seite</a> erneut anmelden.
<br>Beachten Sie bitte unsere <a href="'.$basepath.'/schueler/datenschutz.php">Datenschutzerklärung</a>, in welcher wir Ihnen mitteilen, wie Ihre Daten bei uns verarbeitet werden.<br><br>Mit freundlichen Grüßen<br>Modellschule Obersberg<br><br><i>Diese E-Mail wurde automatisch erstellt.<i/>';

$text_fail='<h2>Guten Tag,</h2>Sie haben versucht, sich mit dieser E-Mail-Adresse beim Schülerportal der Modellschule Obersberg in Bad Hersfeld anzumelden.<br>Leider wurde Ihre Anmeldung noch nicht final bearbeitet, sodass wir Sie noch um etwas Geduld bitten.<br>
<br>
Wir senden Ihnen eine Begrüßungsmail, sobald Ihr Zugang freigeschaltet ist.
<br><br>Mit freundlichen Grüßen<br>Modellschule Obersberg<br><br><i>Diese E-Mail wurde automatisch erstellt.<i/>';

//Emailversand

$mail->AddAddress($email);
$mail->Subject = "[MSO] Schülerportal";

   
   //Datenbankverarbeitung
   //-Email vorhanden?
   $sql="select * from
(SELECT *  FROM `fieldvalues` WHERE `field` = 18 and value='".$email."') as fieldvalues join 
(select * from applications where status=10) as applications on applications.ID=fieldvalues.application;";
   $result = $conn->query($sql);
   if ($result->num_rows > 0) {
	    while($row = $result->fetch_assoc()) {
          $id = $row['application'];
		  $mail->Body = $text_success;
     }
   } else {
		$sql="select * from
(SELECT *  FROM `fieldvalues` WHERE `field` = 18 and value='".$email."') as fieldvalues join 
(select * from applications where status<10) as applications on applications.ID=fieldvalues.application;";
   $result = $conn->query($sql);
   if ($result->num_rows > 0) {
	   $mail->Body = $text_fail; 
	   if(!$mail->Send()) {
        die("1".$mail->ErrorInfo); //Technische Problem beim Senden
	}
   }
		die("2");
   }
   
   
   //Token erstellen und speichern
   $sql="INSERT INTO schueleremailtokens(token,IDapplication) VALUES ('".$token."',".$id.")";
     if ($conn->query($sql) === TRUE) {     
	 //DOK//
	   $sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,NULL,'Information','Erhebung/Veränderung','sendmaillogin',NULL,'Neuer Token erstellt: ".$token."','".$email."','".$ip."')";
		$conn->query($sql); 
		//DOK//
   } 
   
   if(!$mail->Send()) {
        die("1".$mail->ErrorInfo); //Technische Problem beim Senden
	}
   
   echo("2");

?>