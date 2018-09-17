#include <Wire.h>
#include <SPI.h>
#include <Adafruit_PN532.h>
/*CMDs
 * nfcR
 * nfcW
 * endR
 * endW
 * nfcTXXXX
 * START!
 * ERROR!
 * TIMEOUT!
*/
#define PN532_IRQ   (2)
#define PN532_RESET (3) 
Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);
String serialString;
char url[20];
char err[] = "ERROR!";
uint8_t ndefprefix = NDEF_URIPREFIX_NONE;
uint16_t timeout_t  = 500;

uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0 }; 
uint8_t uidLength; 
//---------------------------------------------
void setup(void) {
  url[0] = '0';
  url[1] = '\0';
  
  Serial.begin(115200);
  Serial.setTimeout(20); 
  nfc.begin();
  Serial.println("START!");
  nfc.SAMConfig();
}
//---------------------------------------------
void serialEvent(){
  serialString = Serial.readString();
  
  if(serialString == "?nfcR"){
    nfcread();
  }
  else if(serialString == "?nfcW"){
    nfcwrite();
  }
  else if(serialString.startsWith("?nfcT") ){
    serialString.replace("?nfcT", "");
    timeout_t = serialString.toInt();
    Serial.println("endT");
  }
  else{
    serialString.toCharArray(url,20);
    Serial.println("endS");
  } 
}
//---------------------------------------------
void loop(void){
}
//LEER-----------------------------------------
void nfcread(){
  uint8_t i;
  uint8_t data[4];
  uint8_t last = 0x00;
  if( !nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, timeout_t) )return;
  for(i=7; i<12; i++){
    if( nfc.ntag2xx_ReadPage(i, data) ){
      for(uint8_t j =0; j<4; j++){
        if( data[j] > 0x1F ){
          Serial.print((char)data[j]);
          last = data[j];
        }
      }
    }
    else{
      if(last != 0x00 )
        Serial.print('\n');
      Serial.println(err);
      return;
    }
  }
  Serial.println("\nendR");
  
}
//ESCRIBIR-------------------------------------
void nfcwrite(){
  uint8_t i;
  uint8_t data[4];
  uint8_t dataLength;
  
  if( !nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, timeout_t) ) return;
  memset(data, 0, 4);
  if(nfc.ntag2xx_ReadPage(3, data)){
    dataLength = data[2]*8;

    for (uint8_t i = 4; i < (dataLength/4)+4; i++) {
      memset(data, 0, 4);
      if( !nfc.ntag2xx_WritePage(i, data) ){
        Serial.println(err);
        return;
      }
    }
    if ( !nfc.ntag2xx_WriteNDEFURI(ndefprefix, url, dataLength) ){
      Serial.println(err);
      return;
    }
    Serial.println("endW");
  }
  else{
    Serial.println(err);
  }
  
}


