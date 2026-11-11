#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// Glove Motion Lab - ESP32-C3 + ADS1115 firmware
// Serial protocol (one line every 50 ms):
// DATA,thumb,index,middle,ring,pinky,fsr1,fsr2,fsr3

#define THUMB_PIN  0
#define INDEX_PIN  1
#define RING_PIN   3
#define PINKY_PIN  4

#define SDA_PIN    6
#define SCL_PIN    7
#define ADS_ADDRESS 0x48

Adafruit_ADS1115 ads;
const unsigned long SAMPLE_INTERVAL_MS = 50;
unsigned long lastSample = 0;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  Wire.begin(SDA_PIN, SCL_PIN);

  if (!ads.begin(ADS_ADDRESS, &Wire)) {
    Serial.println("ERROR,ADS1115_NOT_FOUND");
    while (true) delay(1000);
  }

  // +/-4.096 V range: safe for 0-3.3 V signals, with 0.125 mV/bit.
  ads.setGain(GAIN_ONE);
  ads.setDataRate(RATE_ADS1115_250SPS);
  delay(300);
  Serial.println("READY,GLOVE_MOTION_LAB");
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSample < SAMPLE_INTERVAL_MS) return;
  lastSample = now;

  // Four flex channels on ESP32 ADC1 (GPIO0, GPIO1, GPIO3, GPIO4).
  const int thumb = analogRead(THUMB_PIN);
  const int index = analogRead(INDEX_PIN);
  const int ring  = analogRead(RING_PIN);
  const int pinky = analogRead(PINKY_PIN);

  // ADS1115 channels: A3 = middle flex; A0-A2 = FSR1-FSR3.
  const int16_t fsr1   = ads.readADC_SingleEnded(0);
  const int16_t fsr2   = ads.readADC_SingleEnded(1);
  const int16_t fsr3   = ads.readADC_SingleEnded(2);
  const int16_t middle = ads.readADC_SingleEnded(3);

  // Keep this as a machine-readable CSV line; do not print the PuTTY dashboard.
  Serial.print("DATA,");
  Serial.print(thumb);  Serial.print(',');
  Serial.print(index);  Serial.print(',');
  Serial.print(middle); Serial.print(',');
  Serial.print(ring);   Serial.print(',');
  Serial.print(pinky);  Serial.print(',');
  Serial.print(fsr1);   Serial.print(',');
  Serial.print(fsr2);   Serial.print(',');
  Serial.println(fsr3);
}
