#include <DHT.h>
#include <WiFi.h>
#include <PubSubClient.h>

// WiFi credentials
const char* ssid = "Apple";
const char* password = "123456789";

// MQTT Broker
const char* mqtt_server = "broker.emqx.io";
const int mqtt_port = 1883;
const char* mqtt_topic = "node-01-for-test";

// DHT Sensor config
#define FLAMESENSOR 14
#define BUZZER 15
#define DHTPIN 16
#define DHTTYPE DHT22
#define MQ135_PIN 26
#define LED_PIN 25  // Built-in LED on Pico W

// Wiring guide for Raspberry Pi Pico 2W:
// - DHT22 data -> GP16
// - Flame sensor digital out -> GP14
// - Buzzer signal -> GP15
// - MQ135 analog out -> GP26 / ADC0
// - MQ135 VCC -> external 5V module supply if required by your board
// - MQ135 GND -> Pico GND
//
// Important:
// Pico 2W ADC pins are 3.3V only. If your MQ135 module analog output can go above 3.3V,
// add a voltage divider or use a 3.3V-safe analog output stage before connecting to GP26.

DHT dht(DHTPIN, DHTTYPE);
bool fireDetected;

WiFiClient espClient;
PubSubClient client(espClient);

float readAirQualityPpm() {
  // Read MQ135 analog output on GP26 / ADC0.
  // This is a simple approximate mapping for demo/dashboard use.
  // For real deployment, calibrate MQ135 in clean air and use Rs/Ro formulas.
  int raw = analogRead(MQ135_PIN);
  return map(raw, 0, 4095, 400, 2000);
}

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // blink LED
  }

  Serial.println("");
  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  digitalWrite(LED_PIN, HIGH); // solid on
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    String clientId = "Pico2W-" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
      client.publish("status", "Pico2W online");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  pinMode(FLAMESENSOR, INPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  analogReadResolution(12);
  
  dht.begin();

  Serial.begin(9600);
  while(!Serial) { ; }
  Serial.println("Booting Pico2W...");

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  int flame = digitalRead(FLAMESENSOR);
  fireDetected = (flame == HIGH);

  if (fireDetected) {
    analogWrite(BUZZER, 124);
  } else {
    analogWrite(BUZZER, 0);
  }

  float tempC = dht.readTemperature();
  float humidity = dht.readHumidity();
  float airQuality = readAirQualityPpm();

  if (!isnan(tempC) && !isnan(humidity)) {
    String payload = "{";
    payload += "\"temperature\":" + String(tempC, 1) + ",";
    payload += "\"humidity\":" + String(humidity) + ",";
    payload += "\"air_quality\":" + String(airQuality, 0) + ",";
    payload += "\"fire_alarm\":" + String(fireDetected ? 1 : 0) + ",";
    payload += "\"location\":\"EMQX\"";
    payload += "}";

    if (client.publish(mqtt_topic, payload.c_str())) {
      Serial.println("Published: " + payload);
      digitalWrite(LED_PIN, HIGH);
    } else {
      Serial.println("Publish failed");
    }
  } else {
    Serial.println("Invalid sensor readings");
  }

  delay(2000);
}

