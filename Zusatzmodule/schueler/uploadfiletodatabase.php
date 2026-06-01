<?php
require_once('../include/includes.php');	
if(isset($_POST['token'])) $token=$_POST['token']; else die("1Kein Token übergeben. Bitte wenden Sie sich an einen Administrator.");
if(isset($_POST['application'])) $application=$_POST['application']; else die("1Keinen Antrag übergeben. Bitte wenden Sie sich an einen Administrator.");
if(isset($_POST['field'])) $field=$_POST['field']; else die("1Kein Feld übergeben. Bitte wenden Sie sich an einen Administrator.");
if(isset($_POST['imagetobesent'])) $image=$_POST['imagetobesent']; else die("1Keine Datei übergeben.");
if (substr($image,0,14)<>"data:image/png") die("1Keine passende Bilddatei übergeben.");

$sql="SELECT * FROM schueleremailtokens WHERE token='".$token."' AND IDapplication='".$application."'" ;
$result = $conn->query($sql);
$id="x";
while($row = $result->fetch_assoc()) {
	$id=$row["IDemail"]; 
}
//DOKUMENTATION//
if ($id=="x") {
	$sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,".$application.",'Warnung','Abfrage','uploadfiletodatabase',NULL,'Tokenüberprüfung fehlgeschlagen','".$token."','".$ip."')";
	die("1Das Token ist fehlerhaft oder es wurde kein passender Antrag gefunden. Bitte wenden Sie sich an einen Administrator.");
} else $sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,".$application.",'Information','Abfrage','uploadfiletodatabase',NULL,'Tokenüberprüfung erfolgreich','".$token."','".$ip."')";

//user = Backendbenutzer
//application = Antragsnummer
//category = Information, Kritisch, Fehler, Warnung
//task = Erhebung/Veränderung, Abfrage, Übermittlung, Kombination, Löschung
//element = Betroffenes Feld,...
//comment = Kommentar
//value = Neuer Wert
//ip = Ausführende IP 

$conn->query($sql); 

//ENDE DOKUMENTATION//

$sql="REPLACE INTO images (file,application,field) VALUES ('".$image."',".$application.",".$field.")";
if ($conn->query($sql) === TRUE) {
  $idnew = $conn->insert_id;
  echo "0".$idnew;
  } else {
	 //DOK//
	 $sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,".$application.",'Fehler','Erhebung/Veränderung','uploadfiletodatabase','".$field."','Bilderupload zu Datenbank fehlgeschlagen.',NULL,'".$ip."')";
	 $conn->query($sql); 
	 //DOK//
     die("1Fehler beim Upload eines Bilds in die Datenbank. Bitte wenden Sie sich an einen Administrator.");
}

//DOK//
$sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,".$application.",'Information','Erhebung/Veränderung','uploadfiletodatabase','".$field."','Neuer Bilderupload in Datenbank',NULL,'".$ip."')";
$conn->query($sql); 
//DOK//

 $sql="UPDATE `fieldvalues` SET value='1130' WHERE application=".$application." and field=158";
$conn->query($sql); 

 $sql="UPDATE schueleremailtokens SET `datetime`=NOW() WHERE `token`='".$token."'";
     if ($conn->query($sql) === TRUE) {
	 NULL;
   } else {
	 //DOK//
	 $sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,".$application.",'Fehler','Erhebung/Veränderung','uploadfiletodatabase',NULL,'Emailtoken konnte nicht aktualisiert werden','".$token."','".$ip."')";	
	 $conn->query($sql);
	 //DOK//
     die("1Fehler beim Aktualisieren des Tokens. Bitte wenden Sie sich an einen Administrator.");
   }  
   //DOK//
   $sql="INSERT INTO `documentation`(`user`, `application`, `category`, `task`, `page`, `element`, `comment`, `value`, `ip`) VALUES (NULL,".$application.",'Information','Erhebung/Veränderung','uploadfiletodatabase',NULL,'Emailtoken aktualisiert','".$token."','".$ip."')";	
   $conn->query($sql); 
   //DOK// 
	
?>

