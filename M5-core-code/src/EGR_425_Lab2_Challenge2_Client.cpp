#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <M5Core2.h>

///////////////////////////////////////////////////////////////
// UUIDs and BLE Name
///////////////////////////////////////////////////////////////
// UUIDs for the custom BLE service and characteristic.
// These must match the client (React Native app).
#define SERVICE_UUID        "47b225e3-f89c-4885-8068-f64092c1b640"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
static String BLE_BROADCAST_NAME = "Player2 M5Core";

///////////////////////////////////////////////////////////////
// BLE Objects and State
///////////////////////////////////////////////////////////////
BLEServer *bleServer;
BLEService *bleService;
BLECharacteristic *bleCharacteristic;
bool deviceConnected = false;
bool previouslyConnected = false;

///////////////////////////////////////////////////////////////
// IMU Variables and Game Flags
///////////////////////////////////////////////////////////////
float accX, accY, accZ;                // Accelerometer data
bool waitForRestart = false;          // Whether game is over and waiting for restart
bool playAgainConfirmed = false;      // Whether user has touched to confirm restart

///////////////////////////////////////////////////////////////
// Function Declarations
///////////////////////////////////////////////////////////////
void drawScreenTextWithBackground(String text, int backgroundColor);

///////////////////////////////////////////////////////////////
// BLE Callback: Connection State
///////////////////////////////////////////////////////////////
class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *pServer) override {
        deviceConnected = true;
        previouslyConnected = true;
        Serial.println("iPhone connected!");
    }

    void onDisconnect(BLEServer *pServer) override {
        deviceConnected = false;
        Serial.println("iPhone disconnected!");
    }
};

///////////////////////////////////////////////////////////////
// BLE Callback: Handle Messages from Phone
///////////////////////////////////////////////////////////////
class MyCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) override {
        std::string value = pCharacteristic->getValue();
        Serial.print("Received: ");
        Serial.println(value.c_str());

        // If the phone sends "GAME_OVER", show restart prompt
        if (value == "GAME_OVER") {
            waitForRestart = true;
            playAgainConfirmed = false;
            drawScreenTextWithBackground("Game Over\nPlay Again?", TFT_RED);
        }
    }
};

///////////////////////////////////////////////////////////////
// Initialize BLE server, service, and characteristic
///////////////////////////////////////////////////////////////
void broadcastBleServer() {
    bleServer = BLEDevice::createServer();
    bleServer->setCallbacks(new MyServerCallbacks());

    bleService = bleServer->createService(SERVICE_UUID);

    bleCharacteristic = bleService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_NOTIFY |
        BLECharacteristic::PROPERTY_WRITE // allow phone to send commands
    );

    bleCharacteristic->addDescriptor(new BLE2902());
    bleCharacteristic->setValue("Waiting for motion data...");
    bleCharacteristic->setCallbacks(new MyCallbacks());  // Attach callback handler
    bleService->start();

    // Start BLE advertising
    BLEAdvertising *bleAdvertising = BLEDevice::getAdvertising();
    bleAdvertising->addServiceUUID(SERVICE_UUID);
    bleAdvertising->setScanResponse(true);
    bleAdvertising->setMinPreferred(0x06);
    bleAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("Advertising BLE service...");
}

///////////////////////////////////////////////////////////////
// Setup - initialize screen, IMU, and BLE
///////////////////////////////////////////////////////////////
void setup() {
    M5.begin();
    delay(100);  // Let hardware settle

    M5.IMU.Init();  // Initialize accelerometer
    M5.Lcd.setTextSize(3);  // Set default font size

    BLEDevice::init(BLE_BROADCAST_NAME.c_str());  // Set BLE name
    drawScreenTextWithBackground("Starting BLE server...", TFT_CYAN);
    broadcastBleServer();  // Start BLE services
    drawScreenTextWithBackground("BLE Server Active:\n" + BLE_BROADCAST_NAME, TFT_BLUE);
}

///////////////////////////////////////////////////////////////
// Main Loop - update game state and handle BLE behavior
///////////////////////////////////////////////////////////////
void loop() {
    M5.update();  // Reads button/touch input

    // === Normal Gameplay Mode ===
    if (deviceConnected && !waitForRestart) {
        M5.IMU.getAccelData(&accX, &accY, &accZ);

        // Convert to m/s^2 scale
        accX *= -9.8;
        accY *= -9.8;
        accZ *= -9.8;

        // Send current motion to phone
        String accelData = "X=" + String(accX, 2) + ",Y=" + String(accY, 2) + ",Z=" + String(accZ, 2);
        bleCharacteristic->setValue(accelData.c_str());
        bleCharacteristic->notify();

        Serial.println("Sent: " + accelData);
        drawScreenTextWithBackground("Sent:\n" + accelData, TFT_GREEN);
    }

    // === Game Over Screen - Wait for Touch ===
    else if (deviceConnected && waitForRestart && !playAgainConfirmed) {
        drawScreenTextWithBackground("Play Again?\nTouch to confirm", TFT_BLUE);

        // Confirm restart when touched
        if (M5.Touch.ispressed()) {
            playAgainConfirmed = true;
            bleCharacteristic->setValue("PLAY_AGAIN");
            bleCharacteristic->notify();
            drawScreenTextWithBackground("✅ Waiting for opponent...", TFT_GREEN);
            delay(1000);  // debounce
        }
    }

    // === Disconnected but was previously connected ===
    else if (previouslyConnected && !deviceConnected) {
        drawScreenTextWithBackground("Disconnected. Waiting...", TFT_ORANGE);
    }
}

///////////////////////////////////////////////////////////////
// Utility: Draw text over a background color
///////////////////////////////////////////////////////////////
void drawScreenTextWithBackground(String text, int backgroundColor) {
    M5.Lcd.fillScreen(backgroundColor);
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.println(text);
}
