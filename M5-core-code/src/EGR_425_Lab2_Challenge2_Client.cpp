#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <M5Core2.h>

///////////////////////////////////////////////////////////////
// UUIDs and BLE Name
///////////////////////////////////////////////////////////////
#define SERVICE_UUID        "47b225e3-f89c-4885-8068-f64092c1b640"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
static String BLE_BROADCAST_NAME = "Player1 M5Core";

///////////////////////////////////////////////////////////////
// BLE Objects and State
///////////////////////////////////////////////////////////////
BLEServer *bleServer;
BLEService *bleService;
BLECharacteristic *bleCharacteristic;
bool deviceConnected = false;
bool previouslyConnected = false;

///////////////////////////////////////////////////////////////
// IMU Variables
///////////////////////////////////////////////////////////////
float accX, accY, accZ;

///////////////////////////////////////////////////////////////
// BLE Callback
///////////////////////////////////////////////////////////////
class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *pServer) {
        deviceConnected = true;
        previouslyConnected = true;
        Serial.println("iPhone connected!");
    }

    void onDisconnect(BLEServer *pServer) {
        deviceConnected = false;
        Serial.println("iPhone disconnected!");
    }
};

///////////////////////////////////////////////////////////////
// Setup BLE server
///////////////////////////////////////////////////////////////
void broadcastBleServer() {
    bleServer = BLEDevice::createServer();
    bleServer->setCallbacks(new MyServerCallbacks());

    bleService = bleServer->createService(SERVICE_UUID);
    bleCharacteristic = bleService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_NOTIFY
    );

    bleCharacteristic->addDescriptor(new BLE2902());
    bleCharacteristic->setValue("Waiting for motion data...");
    bleService->start();

    BLEAdvertising *bleAdvertising = BLEDevice::getAdvertising();
    bleAdvertising->addServiceUUID(SERVICE_UUID);
    bleAdvertising->setScanResponse(true);
    bleAdvertising->setMinPreferred(0x06);
    bleAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();
    Serial.println("Advertising BLE service...");
}

///////////////////////////////////////////////////////////////
// Setup
///////////////////////////////////////////////////////////////
void setup() {
    M5.begin();
    M5.IMU.Init();
    M5.Lcd.setTextSize(3);
    BLEDevice::init(BLE_BROADCAST_NAME.c_str());

    drawScreenTextWithBackground("Starting BLE server...", TFT_CYAN);
    broadcastBleServer();
    drawScreenTextWithBackground("BLE Server Active:\n" + BLE_BROADCAST_NAME, TFT_BLUE);
}

///////////////////////////////////////////////////////////////
// Main Loop
///////////////////////////////////////////////////////////////
void loop() {
    if (deviceConnected) {
        M5.IMU.getAccelData(&accX, &accY, &accZ);
        accX *= 9.8;
        accY *= 9.8;
        accZ *= 9.8;

        String accelData = "X=" + String(accX, 2) + ",Y=" + String(accY, 2) + ",Z=" + String(accZ, 2);
        bleCharacteristic->setValue(accelData.c_str());
        bleCharacteristic->notify();

        Serial.println("Sent: " + accelData);
        drawScreenTextWithBackground("Sent:\n" + accelData, TFT_GREEN);
    }
    else if (previouslyConnected) {
        drawScreenTextWithBackground("Disconnected. Waiting...", TFT_ORANGE);
    }

    delay(1000);
}

///////////////////////////////////////////////////////////////
// Utility
///////////////////////////////////////////////////////////////
void drawScreenTextWithBackground(String text, int backgroundColor) {
    M5.Lcd.fillScreen(backgroundColor);
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.println(text);
}
