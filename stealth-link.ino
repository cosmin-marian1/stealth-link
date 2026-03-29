  #include <SPI.h>
  #include <RF24.h>
  #include <Preferences.h>
  #include "mbedtls/aes.h"
  #include <BLEDevice.h>
  #include <BLEServer.h>
  #include <BLEUtils.h>
  #include <BLE2902.h>

  // --- PINI (SuperMini C3) ---
  #define CE_PIN   6
  #define CSN_PIN  7
  #define PIN_SCK  4
  #define PIN_MISO 5
  #define PIN_MOSI 3
  #define LED_PIN  8

  RF24 radio(CE_PIN, CSN_PIN);
  Preferences preferences;

  // --- BLE CONFIG ---
  #define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E" 
  #define CHAR_RX_UUID           "6E400002-B5A3-F393-E0A9-E50E24DCCA9E" 
  #define CHAR_TX_UUID           "6E400003-B5A3-F393-E0A9-E50E24DCCA9E" 

  BLEServer *pServer = NULL;
  BLECharacteristic *pTxCharacteristic;
  bool deviceConnected = false;
  bool oldDeviceConnected = false;
  String bleBuffer = ""; 

  const uint64_t addresses[2] = { 0xF0F0F0F0E1LL, 0xF0F0F0F0D2LL };
  int myNodeId = -1;
  char myKey[17] = ""; 
  char myName[10] = "";
  char mySessionPass[16] = "";
  bool isConfigured = false;
  bool isLocked = true;
  bool isRadioWorking = false; 

  // Structuri date (Fix 32 bytes)
  struct DataPacket { char name[8]; char text[24]; };
  DataPacket payload;
  DataPacket encryptedPayload;

  unsigned long lastHeartbeatSend = 0;

  // --- BLE CALLBACKS ---
  class MyServerCallbacks: public BLEServerCallbacks {
      void onConnect(BLEServer* pServer) { deviceConnected = true; };
      void onDisconnect(BLEServer* pServer) { deviceConnected = false; }
  };
  class MyCallbacks: public BLECharacteristicCallbacks {
      void onWrite(BLECharacteristic *pCharacteristic) {
        String rxValue = pCharacteristic->getValue(); 
        if (rxValue.length() > 0) bleBuffer = rxValue; 
      }
  };

  // --- CURATARE AGRESIVA A GUNOIULUI AES ---
  // Aceasta functie pastreaza DOAR litere, cifre si semne de punctuatie normale
  String cleanStr(char* data, int len) {
    String s = "";
    for(int i=0; i<len; i++) {
      char c = data[i];
      if(c == 0) break; // Null terminator
      
      // Acceptam doar caractere ASCII printabile (fara simboluri ciudate)
      if(c >= 32 && c <= 126) {
        s += c;
      } else {
        break; // Oprim string-ul la primul gunoi gasit
      }
    }
    return s;
  }

  // --- SEND TO UI (USB + BLE Fragmentation) ---
  void sendToInterface(String data) {
    // 1. USB
    Serial.println(data);

    // 2. BLE (Chunking 20 bytes)
    if (deviceConnected) {
        int len = data.length();
        int pos = 0;
        while (pos < len) {
          int chunkLen = (len - pos > 20) ? 20 : (len - pos);
          String chunk = data.substring(pos, pos + chunkLen);
          pTxCharacteristic->setValue((uint8_t*)chunk.c_str(), chunk.length());
          pTxCharacteristic->notify();
          pos += chunkLen;
          delay(15); // Delay critic pt iPhone/Android
        }
    }
  }

  void sendLoginInfo() {
    String json = "{\"type\":\"login\",\"name\":\"" + String(myName) + 
                  "\",\"configured\":" + (isConfigured ? "true" : "false") + 
                  ",\"locked\":" + (isLocked ? "true" : "false") + 
                  ",\"radio\":" + (isRadioWorking ? "true" : "false") + "}";
    sendToInterface(json);
  }

  // --- CRYPTO ---
  void prepareKey(String rawKey, uint8_t *outputKey) {
    memset(outputKey, 0, 16); int len = rawKey.length(); if(len>16) len=16;
    for(int i=0; i<len; i++) outputKey[i] = (uint8_t)rawKey[i];
  }
  void encryptAES(DataPacket* inp, DataPacket* out) {
    mbedtls_aes_context aes; uint8_t key[16]; prepareKey(String(myKey), key);
    mbedtls_aes_init(&aes); mbedtls_aes_setkey_enc(&aes, key, 128);
    mbedtls_aes_crypt_ecb(&aes, MBEDTLS_AES_ENCRYPT, (uint8_t*)inp, (uint8_t*)out);
    mbedtls_aes_crypt_ecb(&aes, MBEDTLS_AES_ENCRYPT, (uint8_t*)inp+16, (uint8_t*)out+16);
    mbedtls_aes_free(&aes);
  }
  void decryptAES(DataPacket* inp, DataPacket* out) {
    mbedtls_aes_context aes; uint8_t key[16]; prepareKey(String(myKey), key);
    mbedtls_aes_init(&aes); mbedtls_aes_setkey_dec(&aes, key, 128);
    mbedtls_aes_crypt_ecb(&aes, MBEDTLS_AES_DECRYPT, (uint8_t*)inp, (uint8_t*)out);
    mbedtls_aes_crypt_ecb(&aes, MBEDTLS_AES_DECRYPT, (uint8_t*)inp+16, (uint8_t*)out+16);
    mbedtls_aes_free(&aes);
  }

  void startRadio(int id, String key, String name, String pass) {
    if(!isRadioWorking) return;
    myNodeId = id;
    key.toCharArray(myKey, 17); name.toCharArray(myName, 10); pass.toCharArray(mySessionPass, 16);
    if(id==0){ radio.openWritingPipe(addresses[0]); radio.openReadingPipe(1, addresses[1]); }
    else     { radio.openWritingPipe(addresses[1]); radio.openReadingPipe(1, addresses[0]); }
    radio.setChannel(120); radio.startListening(); isConfigured=true;
  }

  void setup() {
    Serial.begin(115200);
    Serial.setTimeout(5); // Fix USB blocaj
    pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW); 

    BLEDevice::init("Stealth Link");
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);
    pTxCharacteristic = pService->createCharacteristic(CHAR_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    pTxCharacteristic->addDescriptor(new BLE2902());
    BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(CHAR_RX_UUID, BLECharacteristic::PROPERTY_WRITE);
    pRxCharacteristic->setCallbacks(new MyCallbacks());
    pService->start();
    pServer->getAdvertising()->start();

    SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, CSN_PIN);
    if (radio.begin()) {
      isRadioWorking = true;
      radio.setPALevel(RF24_PA_LOW); radio.setDataRate(RF24_250KBPS); radio.setAutoAck(true);
    } else { isRadioWorking = false; }

    preferences.begin("chat-stealth", false);
    int savedId = preferences.getInt("node_id", -1);
    String savedKey = preferences.getString("net_key", "");
    String savedName = preferences.getString("user_name", "");
    String savedPass = preferences.getString("sess_pass", "");

    Serial.println(); Serial.println("{\"type\":\"sys\",\"msg\":\"BOOT_OK\"}");

    if (savedId != -1 && savedKey.length() > 0) startRadio(savedId, savedKey, savedName, savedPass);
    else isLocked = false;
  }

  void loop() {
    if (!deviceConnected && oldDeviceConnected) { delay(500); pServer->startAdvertising(); oldDeviceConnected = deviceConnected; }
    if (deviceConnected && !oldDeviceConnected) { oldDeviceConnected = deviceConnected; }

    // 1. INPUT
    String input = "";
    if (bleBuffer.length() > 0) { input = bleBuffer; bleBuffer = ""; input.trim(); }
    else if (Serial.available()) { input = Serial.readStringUntil('\n'); input.trim(); }

    if (input.length() > 0) {
      if (input == "GET_INFO") sendLoginInfo();
      else if (input == "RESET") { preferences.clear(); ESP.restart(); }
      else if (input.startsWith("UNLOCK,")) {
          if (input.substring(7).equals(String(mySessionPass))) { isLocked = false; sendToInterface("{\"type\":\"unlock_success\"}"); }
          else sendToInterface("{\"type\":\"unlock_fail\"}");
      }
      else if (input.startsWith("CFG,")) {
          int c1 = input.indexOf(','); int c2 = input.indexOf(',', c1+1); int c3 = input.indexOf(',', c2+1); int c4 = input.indexOf(',', c3+1);
          if (c4 > 0) {
            int id = input.substring(c1+1, c2).toInt();
            String key = input.substring(c2+1, c3);
            String name = input.substring(c3+1, c4);
            String pass = input.substring(c4+1);
            preferences.putInt("node_id", id); preferences.putString("net_key", key); preferences.putString("user_name", name); preferences.putString("sess_pass", pass);
            startRadio(id, key, name, pass);
            isLocked = false;
            sendLoginInfo(); 
          }
      }
      else if (isConfigured && !isLocked && isRadioWorking) {
          radio.stopListening();
          // --- CURATARE BUFFER INAINTE DE SCRIERE ---
          memset(&payload, 0, sizeof(payload)); 
          strncpy(payload.name, myName, sizeof(payload.name) - 1);
          input.toCharArray(payload.text, 24);
          
          encryptAES(&payload, &encryptedPayload);
          radio.write(&encryptedPayload, sizeof(encryptedPayload));
          radio.startListening();
          sendToInterface("{\"type\":\"tx_ok\"}");
          lastHeartbeatSend = millis();
      }
    }

    // 2. RADIO RX
    if (isConfigured && isRadioWorking && radio.available()) {
      memset(&encryptedPayload, 0, sizeof(encryptedPayload));
      memset(&payload, 0, sizeof(payload)); // Reset buffer
      radio.read(&encryptedPayload, sizeof(encryptedPayload));
      decryptAES(&encryptedPayload, &payload);

      if (!isLocked) {
        // --- CURATARE FINALA INAINTE DE JSON ---
        String cleanName = cleanStr(payload.name, 8);
        String cleanMsg = cleanStr(payload.text, 24);
        
        if (cleanName != "") {
            if (cleanMsg == "HB") {
                sendToInterface("{\"type\":\"status\",\"msg\":\"online\",\"partner\":\"" + cleanName + "\"}");
            } 
            else {
                // Trimitem doar textul curat
                sendToInterface("{\"type\":\"rx\",\"name\":\"" + cleanName + "\",\"msg\":\"" + cleanMsg + "\"}");
                sendToInterface("{\"type\":\"status\",\"msg\":\"online\",\"partner\":\"" + cleanName + "\"}");
            }
        } else {
            radio.flush_rx(); // Ignoram pachetul defect
        }
      }
    }

    if (isConfigured && isRadioWorking && (millis() - lastHeartbeatSend > 1500)) {
      radio.stopListening();
      memset(&payload, 0, sizeof(payload)); 
      strncpy(payload.name, myName, sizeof(payload.name) - 1);
      strcpy(payload.text, "HB"); 
      encryptAES(&payload, &encryptedPayload);
      radio.write(&encryptedPayload, sizeof(encryptedPayload));
      radio.startListening();
      lastHeartbeatSend = millis();
    }
  }