/*************************************************************
  Project: SmartGuard - Fingerprint Attendance System with AI
  Author: [Your Name/User]
  Created: Dec 2025
 *************************************************************/

// --- CONFIGURATION ---
#define ERA_DEBUG // Enable debug console

// WiFi Credentials
const char ssid[] = "TungAnhh";
const char pass[] = "12346789";

// Server Configuration (Local Node.js Server)
const char *SERVER_IP = "172.20.10.2"; // <--- CHANGE IP HERE
const int SERVER_PORT = 3000;

// ERa Platform Config
#define DEFAULT_MQTT_HOST "mqtt1.eoh.io"
#define ERA_AUTH_TOKEN "6270d904-0269-46fe-99fa-247da114aa74"

// Hardware Pins
#define FINGERPRINT_RX_PIN 16
#define FINGERPRINT_TX_PIN 17

// Fingerprint Settings
#define CONFIDENCE_THRESHOLD 60 // Minimum confidence to accept
#define MAX_RETRY_ATTEMPTS 3    // Max retries per scan
#define RETRY_DELAY 100         // ms delay between retries

// --- LIBRARIES ---
#include <Arduino.h>
#include <ERa.hpp>
#include <Adafruit_Fingerprint.h>
#include <LiquidCrystal_I2C.h>

// --- OBJECTS ---
LiquidCrystal_I2C lcd(0x27, 16, 2);
HardwareSerial mySerial(1);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);
WiFiClient mbTcpClient;

// --- VARIABLES ---
// LCD Control
unsigned long lastLCDUpdate = 0;
int currentDisplayState = 0;
String currentMessage1 = "";
String currentMessage2 = "";

// Time Control
#if defined(ERA_AUTOMATION)
#include <Automation/ERaSmart.hpp>
#include <Time/ERaEspTime.hpp>
ERaEspTime syncTime;
TimeElement_t ntpTime;
ERaSmart smart(ERa, syncTime);
#endif

// Logic Control
static uint16_t lastValidatedID = 0;
static unsigned long lastValidationTime = 0;
static bool authenticationInProgress = false;
static bool isSendingData = false;

// --- ID AUTH STRUCTURE ---
struct FingerprintAuth
{
  uint16_t id;
  uint16_t confidence;
  bool isValid;
};

// --- HELPER FUNCTIONS ---

// Display message on LCD (Clears screen)
void displayLCDMessage(String line1, String line2, unsigned long displayTime = 2000)
{
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
  lastLCDUpdate = millis();
}

// Display System Status
void displaySystemStatus()
{
  String wifiStatus = WiFi.isConnected() ? "WiFi: OK" : "WiFi: ERR";
  String eraStatus = ERa.connected() ? "ERa: OK" : "ERa: ERR";
  displayLCDMessage("System Status", wifiStatus + " " + eraStatus, 2000);
}

// Display Sensor Info
void displayFingerprintInfo()
{
  String line1 = "Templates: " + String(finger.templateCount);
  String line2 = "Threshold: " + String(CONFIDENCE_THRESHOLD);
  displayLCDMessage(line1, line2, 2000);
}

// Send Data to Node.js Server
// Send Data to Node.js Server
void sendToLocalServer(int id, const char *time, const char *date)
{
  displayLCDMessage("Data Sync...", "To Web Server", 1500);

  WiFiClient client;
  String payload = "{\"time\":\"" + String(time) + "\",\"id\":\"" + String(id) + "\",\"date\":\"" + String(date) + "\"}";

  Serial.printf("[HTTP] Connecting to server: %s:%d\n", SERVER_IP, SERVER_PORT);

  if (client.connect(SERVER_IP, SERVER_PORT))
  {
    Serial.println("[HTTP] Connected!");
    client.println("POST /api/log HTTP/1.1");
    client.print("Host: "); client.println(SERVER_IP);
    client.println("Content-Type: application/json");
    client.print("Content-Length: "); client.println(payload.length());
    client.println();
    client.println(payload);

    // Wait for response
    unsigned long timeout = millis();
    while (client.connected() && !client.available()) {
        if (millis() - timeout > 3000) {
            client.stop();
            return;
        }
        delay(10);
    }

    // Read Response for Name
    String responseName = "";
    bool headersEnded = false;
    
    while(client.available()) {
        String line = client.readStringUntil('\n');
        if (line == "\r") { headersEnded = true; continue; } // Header separator
        
        if (headersEnded) {
            // Parse simple JSON: {"message":"Success","name":"Tên Người"}
            int nameIdx = line.indexOf("\"name\":\"");
            if (nameIdx != -1) {
                int start = nameIdx + 8;
                int end = line.indexOf("\"", start);
                if (end != -1) responseName = line.substring(start, end);
            }
        }
    }

    Serial.println("[HTTP] Response Name: " + responseName);

    if (responseName == "No Data Found") {
        displayLCDMessage("Error:", "No Data Found", 3000);
    } else if (responseName.length() > 0) {
        displayLCDMessage("Successful", "", 3000);
    } else {
        displayLCDMessage("Synced!", "Web Updated", 2000);
    }
  }
  else
  {
    Serial.println("[HTTP] Connection failed!");
    displayLCDMessage("Sync Error", "Check Server", 2000);
  }
  client.stop();
}

// Authenticate Fingerprint Logic
FingerprintAuth authenticateFingerprint()
{
  Serial.println("[AUTH] Authenticating...");
  displayLCDMessage("Authenticating", "Please Wait...", 1000);

  FingerprintAuth result = {0, 0, false};

  for (int attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++)
  {
    uint8_t p = finger.getImage();
    if (p != FINGERPRINT_OK) {
        if (attempt < MAX_RETRY_ATTEMPTS) { delay(RETRY_DELAY); continue; }
        return result; 
    }

    p = finger.image2Tz();
    if (p != FINGERPRINT_OK) {
        if (attempt < MAX_RETRY_ATTEMPTS) { delay(RETRY_DELAY); continue; }
        return result;
    }

    p = finger.fingerFastSearch();
    if (p == FINGERPRINT_OK)
    {
      if (finger.confidence >= CONFIDENCE_THRESHOLD)
      {
        result.id = finger.fingerID;
        result.confidence = finger.confidence;
        result.isValid = true;
        displayLCDMessage("Auth Success!", "ID: " + String(result.id), 2000);
        return result;
      }
    }
  }
  
  displayLCDMessage("Not Found", "Try Again", 2000);
  return result;
}

// Handle Valid Fingerprint
void handleAuthenticatedFingerprint(FingerprintAuth auth)
{
  // Anti-spam cooldown (2 seconds same ID)
  if (auth.id == lastValidatedID && (millis() - lastValidationTime) < 2000)
  {
    displayLCDMessage("Duplicate Scan", "Please Wait", 2000);
    return;
  }

  isSendingData = true;

  // Get Time
  syncTime.getTime(ntpTime);
  char timeStr[12];
  sprintf(timeStr, "%02d:%02d:%02d", ntpTime.hour, ntpTime.minute, ntpTime.second);
  char dateStr[12];
  sprintf(dateStr, "%02d/%02d/%04d", ntpTime.day, ntpTime.month, ntpTime.year + 1970);

  // Send Data
  sendToLocalServer(auth.id, timeStr, dateStr);

  // ERa Virtual Write
  String idString = "ID" + String(auth.id);
  ERa.virtualWrite(V0, idString.c_str());

  lastValidatedID = auth.id;
  lastValidationTime = millis();
  isSendingData = false;
}

// Connection Callbacks
ERA_CONNECTED() {
  ERA_LOG(ERA_PSTR("ERa"), ERA_PSTR("Connected!"));
  displayLCDMessage("ERa Platform", "Connected!", 3000);
}
ERA_DISCONNECTED() {
  ERA_LOG(ERA_PSTR("ERa"), ERA_PSTR("Disconnected!"));
}

// Main Timer Loop (0.5s)
void timerEvent()
{
  if (authenticationInProgress || isSendingData) return;

  // Check fingerprint sensor
  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER) return;

  Serial.println("[DETECT] Finger detected!");
  authenticationInProgress = true;
  
  FingerprintAuth result = authenticateFingerprint();
  
  if (result.isValid) {
    handleAuthenticatedFingerprint(result);
  } else {
    // Finger scanned but NOT found -> Send "No Data Found" (ID 0)
    Serial.println("[AUTH] Failed. Sending 'No Data Found'...");
    
    // Get Time
    syncTime.getTime(ntpTime);
    char timeStr[12];
    sprintf(timeStr, "%02d:%02d:%02d", ntpTime.hour, ntpTime.minute, ntpTime.second);
    char dateStr[12];
    sprintf(dateStr, "%02d/%02d/%04d", ntpTime.day, ntpTime.month, ntpTime.year + 1970);

    // Send ID 0
    sendToLocalServer(0, timeStr, dateStr);
    
    // Cooldown to prevent spamming failure logs
    delay(2000); 
  }
  
  authenticationInProgress = false;
}

// Idle Display Cycle
void cycleLCDDisplay()
{
  if (millis() - lastLCDUpdate > 5000 && !authenticationInProgress && !isSendingData)
  {
    switch (currentDisplayState)
    {
    case 0: displayLCDMessage("System Ready", "Scan Finger", 4000); break;
    case 1: displaySystemStatus(); break;
    case 2: displayFingerprintInfo(); break;
    case 3: 
      syncTime.getTime(ntpTime);
      char timeStr[9]; sprintf(timeStr, "%02d:%02d:%02d", ntpTime.hour, ntpTime.minute, ntpTime.second);
      displayLCDMessage(String(timeStr), "SmartGuard AI", 4000);
      break;
    }
    currentDisplayState = (currentDisplayState + 1) % 4;
  }
}

// --- SETUP ---
void setup()
{
  Serial.begin(115200);
  
  // Init LCD
  lcd.init();
  lcd.backlight();
  displayLCDMessage("System Starting", "SmartGuard v2.0", 2000);

  // Init ERa & WiFi
  ERa.setModbusClient(mbTcpClient);
  ERa.setScanWiFi(true);
  ERa.begin(ssid, pass);
  
  ERa.addInterval(500L, timerEvent);
  ERa.addInterval(100L, cycleLCDDisplay);

  // Init Fingerprint Sensor
  mySerial.begin(57600, SERIAL_8N1, FINGERPRINT_RX_PIN, FINGERPRINT_TX_PIN);
  finger.begin(57600);
  
  if (finger.verifyPassword()) {
    displayLCDMessage("FP Sensor", "Connected!", 2000);
  } else {
    displayLCDMessage("FP Sensor", "ERROR!", 5000);
    while (1) delay(1);
  }

  finger.getTemplateCount();
  Serial.printf("Templates: %d\n", finger.templateCount);
}

// --- LOOP ---
void loop()
{
  ERa.run();
}