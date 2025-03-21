#include <M5Core2.h>
#include <Adafruit_seesaw.h>
#include <BLEDevice.h>
#include <BLE2902.h>

///////////////////////////////////////////////////////////////
// Variables
///////////////////////////////////////////////////////////////
static BLERemoteCharacteristic *bleRemoteCharacteristic;
static BLEAdvertisedDevice *bleRemoteServer;
static boolean doConnect = false;
static boolean doScan = false;
bool deviceConnected = false;
bool gameOverFlag = false;  // Flag to track if the game is over

// Gamepad Variables
Adafruit_seesaw gamepad;
#define BUTTON_START 16
#define BUTTON_SELECT 0

// Button state tracking
bool startButtonPressed = false;
bool selectButtonPressed = false;

// Client's Blue Dot (Local)
int blueX = 150, blueY = 100, blueSpeed = 1;
bool showGameScreen = false;  // Flag to control screen transition

// Server's Red Dot (Remote)
int redX = -1, redY = -1;  // Red dot starts as invalid
bool redDotInitialized = false;  // Flag to track if we've received valid data for red dot

// Game timing
unsigned long gameStartTime = 0;
float gameTimeElapsed = 0.0;

// Collision threshold
const int COLLISION_DISTANCE = 10;

// Debug flags
bool debugMode = false;  // Set to true to display debug info

///////////////////////////////////////////////////////////////
// BLE UUIDs
///////////////////////////////////////////////////////////////
static BLEUUID SERVICE_UUID("4fafc201-1fb5-459e-8fcc-c5c9c331914b"); 
static BLEUUID CHARACTERISTIC_UUID("beb5483e-36e1-4688-b7f5-ea07361b26a8");

// BLE Broadcast Name
static String BLE_BROADCAST_NAME = "Mckaylas M5Core2024";

///////////////////////////////////////////////////////////////
// Forward Declarations
///////////////////////////////////////////////////////////////
void drawScreenTextWithBackground(String text, int backgroundColor);
void sendGamepadData();
void gameOver(float timeElapsed = -1.0);  // Game Over function
void checkCollision();

///////////////////////////////////////////////////////////////
// BLE Client Callback Methods (Handles Server Notifications)
///////////////////////////////////////////////////////////////
static void notifyCallback(BLERemoteCharacteristic *pBLERemoteCharacteristic, uint8_t *pData, size_t length, bool isNotify) {
    Serial.printf("Notify callback for characteristic %s of data length %d\n", 
                  pBLERemoteCharacteristic->getUUID().toString().c_str(), length);
    Serial.printf("\tData: %s\n", (char *)pData);

    String receivedData = String((char *)pData);

    if (receivedData == "CONNECTED") {
        showGameScreen = true;
        gameStartTime = millis(); // Start timing when connection is established
        Serial.println("Switching to game screen.");
    } 
    else if (receivedData.startsWith("GAMEOVER")) {
        // Parse server's game over time if available
        int dashIndex = receivedData.indexOf('-');
        if (dashIndex > 0) {
            float serverTime = receivedData.substring(dashIndex + 1).toFloat();
            gameOver(serverTime);
        } else {
            gameOver();
        }
    }
    else {
        int dashIndex = receivedData.indexOf('-');
        if (dashIndex > 0) {
            // Parse the position data
            int newRedX = receivedData.substring(0, dashIndex).toInt();
            int newRedY = receivedData.substring(dashIndex + 1).toInt();
            
            // Only update if values are valid (non-negative and within screen bounds)
            if (newRedX >= 0 && newRedY >= 0 && newRedX < 320 && newRedY < 240) {
                redX = newRedX;
                redY = newRedY;
                
                // Mark that we have valid data for the red dot
                if (!redDotInitialized) {
                    redDotInitialized = true;
                    
                    // Initialize blue dot in a different area to avoid immediate collision
                    if (abs(blueX - redX) < 50 && abs(blueY - redY) < 50) {
                        blueX = (redX < 160) ? random(200, 300) : random(20, 120);
                        blueY = (redY < 120) ? random(150, 220) : random(20, 90);
                    }
                }
                
                // Check for collision after updating position, but only if we've had valid data for a while
                // This prevents instant game over due to random positions or data initialization
                static unsigned long firstDataTime = 0;
                if (!firstDataTime) firstDataTime = millis();
                
                // Wait 2 seconds after first receiving data before allowing collisions
                if (!gameOverFlag && redDotInitialized && (millis() - firstDataTime > 2000)) {
                    checkCollision();
                }
            }
        }
    }
}

///////////////////////////////////////////////////////////////
// Check for collision between dots
///////////////////////////////////////////////////////////////
void checkCollision() {
    // Only check collision if we have valid coordinates for red dot
    if (redX >= 0 && redY >= 0 && !gameOverFlag && redDotInitialized) {
        int dx = abs(blueX - redX);
        int dy = abs(blueY - redY);
        
        if (debugMode) {
            Serial.printf("Distance: dx=%d, dy=%d, threshold=%d\n", dx, dy, COLLISION_DISTANCE);
        }
        
        // Only trigger collision if dots are very close
        if (dx < COLLISION_DISTANCE && dy < COLLISION_DISTANCE) {
            if (debugMode) {
                Serial.println("COLLISION DETECTED");
            }
            gameOver();
        }
    }
}

///////////////////////////////////////////////////////////////
// BLE Server Callback Methods (Handles Connection/Disconnection)
///////////////////////////////////////////////////////////////
class MyClientCallback : public BLEClientCallbacks {
    void onConnect(BLEClient *pclient) {
        deviceConnected = true;
        gameOverFlag = false;
        redDotInitialized = false;  // Reset this flag on new connection
        gameStartTime = millis();
        Serial.println("Device connected...");
    }

    void onDisconnect(BLEClient *pclient) {
        deviceConnected = false;
        Serial.println("Device disconnected...");
        showGameScreen = true; // Ensure game screen still shows even if disconnected
    }
};

///////////////////////////////////////////////////////////////
// Connect to BLE Server
///////////////////////////////////////////////////////////////
bool connectToServer() {
    Serial.printf("Forming a connection to %s\n", bleRemoteServer->getName().c_str());
    BLEClient *bleClient = BLEDevice::createClient();
    bleClient->setClientCallbacks(new MyClientCallback());

    if (!bleClient->connect(bleRemoteServer)) {
        Serial.printf("FAILED to connect to server (%s)\n", bleRemoteServer->getName().c_str());
        showGameScreen = true;
        return false;
    }
    
    Serial.printf("Connected to server (%s)\n", bleRemoteServer->getName().c_str());

    BLERemoteService *bleRemoteService = bleClient->getService(SERVICE_UUID);
    if (bleRemoteService == nullptr) {
        Serial.printf("Failed to find our service UUID: %s\n", SERVICE_UUID.toString().c_str());
        bleClient->disconnect();
        showGameScreen = true;
        return false;
    }

    Serial.printf("Found our service UUID: %s\n", SERVICE_UUID.toString().c_str());

    bleRemoteCharacteristic = bleRemoteService->getCharacteristic(CHARACTERISTIC_UUID);
    if (bleRemoteCharacteristic == nullptr) {
        Serial.printf("Failed to find our characteristic UUID: %s\n", CHARACTERISTIC_UUID.toString().c_str());
        bleClient->disconnect();
        showGameScreen = true;
        return false;
    }

    Serial.printf("Found our characteristic UUID: %s\n", CHARACTERISTIC_UUID.toString().c_str());

    if (bleRemoteCharacteristic->canNotify())
        bleRemoteCharacteristic->registerForNotify(notifyCallback);

    showGameScreen = true;
    return true;
}

///////////////////////////////////////////////////////////////
// Scan for BLE servers and find the first one that advertises
// the service we are looking for.
///////////////////////////////////////////////////////////////
class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
    void onResult(BLEAdvertisedDevice advertisedDevice) {
        Serial.print("BLE Advertised Device found:");
        Serial.printf("\tName: %s\n", advertisedDevice.getName().c_str());

        if (advertisedDevice.haveServiceUUID() && 
            advertisedDevice.isAdvertisingService(SERVICE_UUID) && 
            advertisedDevice.getName() == BLE_BROADCAST_NAME.c_str()) {
            BLEDevice::getScan()->stop();
            bleRemoteServer = new BLEAdvertisedDevice(advertisedDevice);
            doConnect = true;
            doScan = true;
        }
    }
};

///////////////////////////////////////////////////////////////
// Setup Function
///////////////////////////////////////////////////////////////
void setup() {
    M5.begin();
    M5.Lcd.setTextSize(3);
    drawScreenTextWithBackground("Scanning for BLE server...", TFT_BLUE);

    // Assign random positions for the blue dot
    blueX = random(50, 250);
    blueY = random(50, 200);

    BLEDevice::init("");

    BLEScan *pBLEScan = BLEDevice::getScan();
    pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
    pBLEScan->setInterval(1349);
    pBLEScan->setWindow(449);
    pBLEScan->setActiveScan(true);
    pBLEScan->start(0, false);

    // Initialize Gamepad
    if (!gamepad.begin(0x50)) {
        Serial.println("ERROR! Gamepad not found.");
        while (1);
    }
    gamepad.pinMode(BUTTON_START, INPUT_PULLUP);
    gamepad.pinMode(BUTTON_SELECT, INPUT_PULLUP);
}

///////////////////////////////////////////////////////////////
// Main Loop
///////////////////////////////////////////////////////////////
void loop() {
    if (gameOverFlag) return; // Stop the game loop if game over

    if (doConnect) {
        if (connectToServer()) {
            Serial.println("Connected to BLE Server.");
            drawScreenTextWithBackground("Connected to BLE server!", TFT_GREEN);
            doConnect = false;
            delay(1000);
        } else {
            Serial.println("Failed to connect to server.");
            drawScreenTextWithBackground("FAILED to connect to BLE server.", TFT_RED);
            delay(1000);
        }
    }

    if (deviceConnected && showGameScreen && !gameOverFlag) {
        sendGamepadData();
        
        // Update game time
        gameTimeElapsed = (millis() - gameStartTime) / 1000.0;
    } else if (doScan && !gameOverFlag) {
        drawScreenTextWithBackground("Disconnected... re-scanning for BLE server...", TFT_ORANGE);
        BLEDevice::getScan()->start(0);
    }

    delay(30); // Smooth movement update rate
}

///////////////////////////////////////////////////////////////
// Send Gamepad Data to BLE Server
///////////////////////////////////////////////////////////////
void sendGamepadData() {
    if (gameOverFlag) return;

    uint32_t buttons = gamepad.digitalReadBulk(0xFFFF);
    int joyX = 1023 - gamepad.analogRead(14);
    int joyY = 1023 - gamepad.analogRead(15);

    // Check Start button - Increase speed, wrap around from 5 to 1
    // Note: Using digitalRead() directly for buttons since it's more reliable for edge detection
    bool startCurrent = !gamepad.digitalRead(BUTTON_START); // Button is active LOW (pressed = 0)
    if (startCurrent && !startButtonPressed) {
        // Start button was just pressed (rising edge)
        blueSpeed++;
        if (blueSpeed > 5) blueSpeed = 1;
        
        // Display speed briefly
        M5.Lcd.fillRect(0, 0, 100, 30, BLACK);
        M5.Lcd.setCursor(5, 5);
        M5.Lcd.setTextSize(2);
        M5.Lcd.printf("Speed: %d", blueSpeed);
        M5.Lcd.setTextSize(3);
    }
    startButtonPressed = startCurrent;

    // Check Select button - Warp to random position
    bool selectCurrent = !gamepad.digitalRead(BUTTON_SELECT); // Button is active LOW
    if (selectCurrent && !selectButtonPressed) {
        // Select button was just pressed (rising edge)
        blueX = random(10, 310);
        blueY = random(10, 230);
    }
    selectButtonPressed = selectCurrent;

    float normX = (joyX - 512) / 512.0;
    float normY = (joyY - 512) / 512.0;

    if (abs(normX) > 0.2) blueX += (normX > 0 ? blueSpeed : -blueSpeed);
    if (abs(normY) > 0.2) blueY -= (normY > 0 ? blueSpeed : -blueSpeed);

    blueX = constrain(blueX, 0, 315);
    blueY = constrain(blueY, 0, 235);

    // Check for collision
    checkCollision();

    // Draw game screen
    M5.Lcd.fillScreen(BLACK);
    M5.Lcd.fillRect(blueX, blueY, 5, 5, BLUE);
    
    // Only draw red dot if valid coordinates received
    if (redX >= 0 && redY >= 0) {
        M5.Lcd.fillRect(redX, redY, 5, 5, RED);
    }
    
    // Show game time and current speed
    M5.Lcd.setCursor(5, 5);
    M5.Lcd.setTextSize(1);
    M5.Lcd.printf("Time: %.2fs  Speed: %d", gameTimeElapsed, blueSpeed);
    M5.Lcd.setTextSize(3);

    // Send position to server
    String position = String(blueX) + "-" + String(blueY);
    if (bleRemoteCharacteristic && bleRemoteCharacteristic->canWrite()) {
        bleRemoteCharacteristic->writeValue(position.c_str(), position.length());
    }
}

///////////////////////////////////////////////////////////////
// Game Over Function
///////////////////////////////////////////////////////////////
void gameOver(float serverTime) {
    gameOverFlag = true;
    
    // Calculate time if not provided by server
    if (serverTime < 0) {
        gameTimeElapsed = (millis() - gameStartTime) / 1000.0;
    } else {
        // Use server's time if provided (for consistency)
        gameTimeElapsed = serverTime;
    }
    
    M5.Lcd.fillScreen(RED);
    M5.Lcd.setTextColor(WHITE);
    M5.Lcd.setTextSize(3);
    
    M5.Lcd.setCursor(50, 100);
    M5.Lcd.print("GAME OVER");
    
    M5.Lcd.setCursor(50, 150);
    M5.Lcd.setTextSize(2);
    M5.Lcd.printf("Time: %.2f seconds", gameTimeElapsed);
}

///////////////////////////////////////////////////////////////
// Screen Display Function
///////////////////////////////////////////////////////////////
void drawScreenTextWithBackground(String text, int backgroundColor) {
    M5.Lcd.fillScreen(backgroundColor);
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.println(text);
}