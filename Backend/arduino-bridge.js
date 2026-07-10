const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const mqtt = require("mqtt");

// ─── CONFIG ──────────────────────────────────────────────────────

const MQTT_BROKER = "mqtt://localhost:1883";
const MQTT_TOPIC = "aquasense/sensors";
const SERIAL_PORT = "COM3";  // CHANGE THIS
const BAUD_RATE = 9600;

const THRESHOLDS = {
  ph: { min: 6.0, max: 9.0 },
  temperature: { min: 5, max: 35 },
  turbidity: { min: 0, max: 10 },
  dissolvedOxygen: { min: 5, max: 14 },
  conductivity: { min: 100, max: 1000 },
};

// ─── MQTT ────────────────────────────────────────────────────────

const client = mqtt.connect(MQTT_BROKER);
client.on("connect", () => console.log("[MQTT] Connected"));
client.on("error", (e) => console.error("[MQTT]", e.message));

// ─── SERIAL ──────────────────────────────────────────────────────

const port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

port.on("open", () => console.log("[SERIAL] Connected to", SERIAL_PORT));
port.on("error", (e) => console.error("[SERIAL]", e.message));

// ─── DATA ────────────────────────────────────────────────────────

parser.on("data", (line) => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes(",")) return;

  const parts = trimmed.split(",");
  if (parts.length !== 5) return;

  const [ph, temp, turbidity, dox, conductivity] = parts.map(Number);
  if (parts.some(isNaN)) return;

  // Check status
  let status = "safe";
  const checks = [
    { key: "ph", value: ph },
    { key: "temperature", value: temp },
    { key: "turbidity", value: turbidity },
    { key: "dissolvedOxygen", value: dox },
    { key: "conductivity", value: conductivity },
  ];
  for (const c of checks) {
    const t = THRESHOLDS[c.key];
    if (c.value < t.min || c.value > t.max) {
      status = "danger";
      break;
    }
  }

  const payload = {
    ph,
    temperature: temp,
    turbidity,
    dissolvedOxygen: dox,
    conductivity,
    deviceId: "arduino-01",
    status,
  };

  client.publish(MQTT_TOPIC, JSON.stringify(payload));
  console.log(`[MQTT] ${status.toUpperCase()} | pH:${ph} Temp:${temp}°C`);
});

// ─── SHUTDOWN ────────────────────────────────────────────────────

process.on("SIGINT", () => { client.end(); port.close(); process.exit(); });