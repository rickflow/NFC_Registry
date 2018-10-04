# NFC_Registry
This project was originally made to take attendance using nfc tags, however it can be used to register any object or person carrying a tag (NTAG2xx).
The system allows to store an ID in each tag and to store IDs with a specific name in a local database.
## Requirements
* Node.JS >= 8
* Arduino UNO
* Any NTAG2xx tag
* A  computer (Windows, OSX, Linux)
* [Adafruit PN532 Library for the Arduino](https://github.com/adafruit/Adafruit-PN532)
## Installation
1. Clone this repository.
```
git clone https://github.com/rickflow/NFC_Registry.git
```
2. Run
```
npm install
```
3. Compile and upload Assist2.ino to the Arduino. This step requires [this library](https://github.com/adafruit/Adafruit-PN532).
4. Modify config.json and set SERIALPORT to your Arduino's COM port (Windows) or path(OSX, Linux).
5. Run
```
npm start
```
6. Open your favorite web browser, preferably Google Chrome, in the specified ports.
```
http://localhost:<PORTNUMBER>
```
## Dependencies
* [Adafruit PN532 Library for the Arduino](https://github.com/adafruit/Adafruit-PN532)
* Node dependencies:
  * serialport
  * sqlite3

## Notes
This system has security flaws, it is not meant for a production environment.