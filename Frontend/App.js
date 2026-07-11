import { useEffect, useState, useRef, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_URL         = "http://localhost:3000";
const WS_URL          = "ws://localhost:3000";
const HISTORY_LIMIT   = 40;
const HEALTH_INTERVAL = 15000;

// ─── GENERAL THRESHOLDS (River Use Only) ───────────────────────────────────
const THRESHOLDS = {
  ph:             { min: 6.0,  max: 9.0,  unit: "",       label: "pH" },
  temperature:    { min: 5,    max: 35,   unit: "°C",     label: "Temperature" },
  turbidity:      { min: 0,    max: 10,   unit: " NTU",   label: "Turbidity" },
  dissolvedOxygen:{ min: 5,    max: 14,   unit: " mg/L",  label: "Dissolved O₂" },
  conductivity:   { min: 100,  max: 1000, unit: " µS/cm", label: "Conductivity" },
};

// ─── QUALITY LEVELS ────────────────────────────────────────────────────────
const QUALITY_LEVELS = [
  { min: 85, label: "Excellent", color: "#2563eb", bg: "linear-gradient(135deg,#1e3a5f,#1e40af)" },
  { min: 65, label: "Good",      color: "#3b82f6", bg: "linear-gradient(135deg,#1e3a5f,#2563eb)" },
  { min: 45, label: "Fair",      color: "#eab308", bg: "linear-gradient(135deg,#713f12,#854d0e)" },
  { min: 25, label: "Poor",      color: "#f97316", bg: "linear-gradient(135deg,#7c2d12,#9a3412)" },
  { min: 0,  label: "Critical",  color: "#ef4444", bg: "linear-gradient(135deg,#7f1d1d,#991b1b)" },
];

function getQualityLevel(score) {
  return QUALITY_LEVELS.find(l => score >= l.min) || QUALITY_LEVELS[QUALITY_LEVELS.length - 1];
}

const COLORS = {
  ph:             "#3b82f6",
  temperature:    "#f97316",
  turbidity:      "#a78bfa",
  dissolvedOxygen: "#34d399",
  conductivity:   "#fbbf24",
};

// ─── IMPROVED WATER QUALITY SCORE (Linear: 100% at optimal, 0% at threshold) ───
// Rules:
// - Inside range: Linear from 100% (optimal) to 0% (at edge)
// - Outside range: 0% immediately (failed)
function computeQualityScore(reading) {
  const keys = ["ph", "temperature", "turbidity", "dissolvedOxygen", "conductivity"];
  let totalScore = 0;
  let validParams = 0;

  for (const key of keys) {
    const t = THRESHOLDS[key];
    const val = reading[key];
    if (val === undefined || val === null || isNaN(val)) continue;
    
    validParams++;
    
    // If ANY parameter is outside safe range → 0% for that parameter
    if (val < t.min || val > t.max) {
      totalScore += 0;
      continue;
    }
    
    // Inside range: calculate score from 100% down to 0%
    const range = t.max - t.min;
    const optimal = (t.max + t.min) / 2;
    
    // Distance from optimal (0 at center, 1 at edge)
    const distanceFromOptimal = Math.abs(val - optimal) / (range / 2);
    
    // Linear score: 100% at optimal, 0% at edge
    let paramScore = 100 * (1 - Math.min(1, distanceFromOptimal));
    
    totalScore += paramScore;
  }

  if (validParams === 0) return 0;
  return Math.round(totalScore / validParams);
}

// Parameter status for display (good/fair/critical)
function getParamStatus(key, value) {
  const t = THRESHOLDS[key];
  if (!t || value === undefined || value === null) return "good";
  
  // Critical if outside safe range OR at the edge (0% score)
  if (value < t.min || value > t.max) return "critical";
  
  // Fair if within 15% of the edge (score below 15%)
  const margin = (t.max - t.min) * 0.15;
  if (value < t.min + margin || value > t.max - margin) return "fair";
  
  return "good";
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const PARAM_STATUS_COLOR = {
  good:     "#10b981",
  fair:     "#eab308",
  critical: "#ef4444",
};

// ─── JOYSTICK COMPONENT ────────────────────────────────────────────────────
function Joystick({ onMove, onStop }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const joystickRef = useRef(null);
  const stickRef = useRef(null);

  const handleStart = (e) => {
    setActive(true);
    e.preventDefault();
  };

  const handleMove = (e) => {
    if (!active || !joystickRef.current) return;
    
    let clientX, clientY;
    if (e.touches) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    
    const maxDist = rect.width / 2 - 30;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > maxDist) {
      dx = dx * (maxDist / distance);
      dy = dy * (maxDist / distance);
    }
    
    setPosition({ x: dx, y: dy });
    
    // Calculate joystick values (-100 to 100)
    const forward = Math.max(-100, Math.min(100, -(dy / maxDist) * 100));
    const turn = Math.max(-100, Math.min(100, (dx / maxDist) * 100));
    
    if (onMove) onMove({ forward, turn });
  };

  const handleStop = () => {
    setActive(false);
    setPosition({ x: 0, y: 0 });
    if (onStop) onStop();
  };

  useEffect(() => {
    if (active) {
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleStop);
      window.addEventListener("touchmove", handleMove);
      window.addEventListener("touchend", handleStop);
    }
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleStop);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleStop);
    };
  }, [active]);

  return (
    <div style={joystickStyles.container}>
      <div 
        ref={joystickRef}
        style={joystickStyles.base}
        onMouseDown={handleStart}
        onTouchStart={handleStart}
      >
        <div 
          ref={stickRef}
          style={{
            ...joystickStyles.stick,
            transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`
          }}
        />
      </div>
      <div style={joystickStyles.labels}>
        <span>▲ Forward</span>
        <div>
          <span>◄ Left</span>
          <span style={{ margin: "0 20px" }}>■ Stop</span>
          <span>Right ►</span>
        </div>
        <span>▼ Backward</span>
      </div>
    </div>
  );
}

const joystickStyles = {
  container: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16 },
  base: {
    width: 200,
    height: 200,
    backgroundColor: "#e2e8f0",
    borderRadius: "50%",
    boxShadow: "inset 0 0 10px rgba(0,0,0,0.1), 0 5px 15px rgba(0,0,0,0.2)",
    position: "relative",
    cursor: "pointer",
    touchAction: "none",
  },
  stick: {
    width: 60,
    height: 60,
    backgroundColor: "#2563eb",
    borderRadius: "50%",
    position: "absolute",
    top: "50%",
    left: "50%",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    transition: "transform 0.05s linear",
    cursor: "pointer",
  },
  labels: {
    textAlign: "center",
    fontSize: 12,
    color: "#475569",
  },
};

// ─── QUALITY SCORE RING ────────────────────────────────────────────────────
function QualityRing({ score }) {
  const level      = getQualityLevel(score);
  const radius     = 54;
  const circ       = 2 * Math.PI * radius;
  const dashOffset = circ * (1 - score / 100);

  return (
    <div style={g.ringWrap}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#cbd5e1" strokeWidth="12" />
        <circle cx="70" cy="70" r={radius} fill="none"
          stroke={level.color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1s ease", filter: `drop-shadow(0 0 8px ${level.color})` }} />
        <text x="70" y="62" textAnchor="middle" fill={level.color}
          fontSize="28" fontWeight="700" fontFamily="monospace">
          {score}%
        </text>
        <text x="70" y="82" textAnchor="middle" fill="#64748b"
          fontSize="11" fontFamily="monospace">
          {level.label}
        </text>
      </svg>
    </div>
  );
}

// ─── GAUGE ─────────────────────────────────────────────────────────────────
function Gauge({ value, min, max, unit, label, colorKey }) {
  const pct   = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const color = PARAM_STATUS_COLOR[getParamStatus(colorKey, value)];
  const angle = -135 + pct * 270;
  return (
    <div style={g.gaugeWrap}>
      <svg viewBox="0 0 120 80" style={{ width: "100%", overflow: "visible" }}>
        <path d="M 15 75 A 50 50 0 1 1 105 75" fill="none" stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round" />
        <path d="M 15 75 A 50 50 0 1 1 105 75" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${pct * 219.9} 219.9`} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        <g transform={`translate(60,65) rotate(${angle})`}>
          <line x1="0" y1="2" x2="0" y2="-28" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx="0" cy="0" r="3" fill={color} />
        </g>
      </svg>
      <div style={{ ...g.gaugeVal, color }}>
        {typeof value === "number" ? value.toFixed(2) : "--"}{unit}
      </div>
      <div style={g.gaugeLabel}>{label}</div>
    </div>
  );
}

// ─── STAT CARD ─────────────────────────────────────────────────────────────
function StatCard({ label, value, unit, delta, paramKey }) {
  const status = getParamStatus(paramKey, value);
  const color  = PARAM_STATUS_COLOR[status] || PARAM_STATUS_COLOR.good;
  return (
    <div style={{ ...g.statCard, borderLeft: `3px solid ${color}` }}>
      <div style={g.statLabel}>{label}</div>
      <div style={{ ...g.statVal, color }}>
        {value !== undefined && value !== null ? Number(value).toFixed(2) : "--"}
        <span style={g.statUnit}>{unit}</span>
      </div>
      {delta !== undefined && (
        <div style={{ ...g.statDelta, color: delta >= 0 ? "#10b981" : "#ef4444" }}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(3)}
        </div>
      )}
      <div style={{ ...g.paramStatusBadge, background: color + "20", color }}>
        {status === "good" ? "✓ Good" : status === "fair" ? "~ Fair" : "✗ Critical"}
      </div>
    </div>
  );
}

// ─── STATS PANEL ───────────────────────────────────────────────────────────
function StatsPanel({ history }) {
  if (!history.length) return null;
  const keys = ["ph","temperature","turbidity","dissolvedOxygen","conductivity"];
  return (
    <div style={g.statsPanel}>
      {keys.map(key => {
        const meta = THRESHOLDS[key];
        if (!meta) return null;
        const vals = history.map(d => +d[key]).filter(v => !isNaN(v));
        if (!vals.length) return null;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return (
          <div key={key} style={{ ...g.statsPanelCard, borderTop: `3px solid ${COLORS[key]}` }}>
            <div style={{ ...g.statsPanelLabel, color: COLORS[key] }}>{meta.label}</div>
            <div style={g.statsPanelRow}>
              {[["Min", min], ["Avg", avg], ["Max", max]].map(([lbl, val]) => (
                <div key={lbl} style={g.statsPanelItem}>
                  <div style={g.statsPanelItemLabel}>{lbl}</div>
                  <div style={{ ...g.statsPanelItemVal, color: PARAM_STATUS_COLOR[getParamStatus(key, val)] }}>
                    {val.toFixed(2)}{meta.unit}
                  </div>
                </div>
              ))}
            </div>
            <div style={g.statsPanelBar}>
              <div style={{
                ...g.statsPanelBarFill,
                width: `${Math.max(0, Math.min(100, ((avg - meta.min) / (meta.max - meta.min)) * 100))}%`,
                background: COLORS[key],
              }} />
            </div>
            <div style={g.statsPanelRange}>
              <span>{meta.min}{meta.unit}</span>
              <span style={{ color: "#94a3b8", fontSize: 10 }}>safe range</span>
              <span>{meta.max}{meta.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlertBadge({ count }) {
  if (!count) return null;
  return <span style={g.alertBadge}>{count} alert{count > 1 ? "s" : ""}</span>;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={g.tooltip}>
      <div style={g.tooltipTime}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color, fontSize: 12, margin: "2px 0" }}>
          {THRESHOLDS[p.dataKey]?.label || p.dataKey}: {Number(p.value).toFixed(3)}
          {THRESHOLDS[p.dataKey]?.unit || ""}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [prev, setPrev] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [serverInfo, setServerInfo] = useState(null);
  const [activeParam, setActiveParam] = useState("ph");
  const [tab, setTab] = useState("dashboard");
  const [joystickCommand, setJoystickCommand] = useState({ forward: 0, turn: 0 });

  const wsRef = useRef(null);
  const prevRef = useRef(null);
  useEffect(() => { prevRef.current = latest; }, [latest]);

  const sendBoatCommand = useCallback(async (command) => {
    try {
      await fetch(`${API_URL}/boat/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
    } catch (err) {
      console.error("Failed to send boat command:", err);
    }
  }, []);

  const handleJoystickMove = (values) => {
    setJoystickCommand(values);
    sendBoatCommand(values);
  };

  const handleJoystickStop = () => {
    setJoystickCommand({ forward: 0, turn: 0 });
    sendBoatCommand({ forward: 0, turn: 0 });
  };

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/data?limit=${HISTORY_LIMIT}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const sorted = [...data].reverse();
      setHistory(sorted);
      if (sorted.length > 0) {
        setPrev(sorted[sorted.length - 2] || null);
        setLatest(sorted[sorted.length - 1]);
      }
    } catch { }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setWsStatus("open");
      ws.onclose = () => { setWsStatus("closed"); setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event !== "new_reading") return;
          setPrev(prevRef.current);
          setLatest(msg.data);
          setHistory(h => [...h, msg.data].slice(-HISTORY_LIMIT));
        } catch { }
      };
    }
    connect();
    return () => wsRef.current?.close();
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        setServerInfo(await res.json());
      } catch { setServerInfo(null); }
    };
    check();
    const id = setInterval(check, HEALTH_INTERVAL);
    return () => clearInterval(id);
  }, []);

  const qualityScore = latest ? computeQualityScore(latest) : 0;
  const qualityLevel = getQualityLevel(qualityScore);

  const chartData = history.map(d => ({
    time: formatTime(d.createdAt),
    ph: +d.ph,
    temperature: +d.temperature,
    turbidity: +d.turbidity,
    dissolvedOxygen: +d.dissolvedOxygen,
    conductivity: +d.conductivity,
  }));

  const alerts = history.filter(d => computeQualityScore(d) < 45);
  const delta = key => (latest && prev) ? latest[key] - prev[key] : undefined;
  const isConnected = wsStatus === "open";

  const pieData = [
    { name: "Excellent/Good", value: history.filter(d => computeQualityScore(d) >= 65).length, color: "#2563eb" },
    { name: "Fair", value: history.filter(d => { const s = computeQualityScore(d); return s >= 35 && s < 65; }).length, color: "#eab308" },
    { name: "Poor/Critical", value: history.filter(d => computeQualityScore(d) < 35).length, color: "#ef4444" },
  ].filter(d => d.value > 0);

  return (
    <div style={g.app}>
      <header style={g.header}>
        <div style={g.logo}>
          <span style={g.logoIcon}>◈</span>
          <div>
            <div style={g.logoTitle}>AquaSense</div>
            <div style={g.logoSub}>Water Quality Intelligence</div>
          </div>
        </div>

        <nav style={g.nav}>
          {["control", "dashboard", "history", "alerts"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ ...g.navBtn, ...(tab === t ? g.navBtnActive : {}) }}>
              {t === "dashboard" ? "Dashboard" : t === "control" ? "Control" : t === "history" ? "History" : "Alerts"}
              {t === "alerts" && alerts.length > 0 &&
                <span style={g.navBadge}>{alerts.length}</span>}
            </button>
          ))}
        </nav>

        <div style={g.headerRight}>
          <div style={{
            ...g.connDot,
            background: isConnected ? "#10b981" : "#ef4444",
            boxShadow: isConnected ? "0 0 8px #10b981" : "none"
          }} />
          <div>
            <div style={g.connLabel}>
              {wsStatus === "open" ? "Online" : wsStatus === "connecting" ? "Connecting…" : "Offline"}
            </div>
            {serverInfo && (
              <div style={g.connTime}>
                DB {serverInfo.mongo === "connected" ? "✓" : "✗"}
                {" · "}
                MQTT {serverInfo.mqtt === "connected" ? "✓" : "✗"}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* CONTROL TAB */}
      {tab === "control" && (
        <main style={g.main}>
          <div style={{ ...g.section, textAlign: "center" }}>
            <div style={g.sectionTitle}>Boat Control — Joystick</div>
            <div style={{ padding: "20px 0" }}>
              <Joystick onMove={handleJoystickMove} onStop={handleJoystickStop} />
              <div style={{ marginTop: 20, padding: 15, background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 14, color: "#475569", marginBottom: 10 }}>Current Command</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 30 }}>
                  <div>
                    <span style={{ color: "#64748b" }}>Forward/Back:</span>
                    <span style={{ fontWeight: 700, color: "#2563eb", marginLeft: 8 }}>
                      {joystickCommand.forward > 0 ? `Forward ${Math.round(joystickCommand.forward)}%` : 
                       joystickCommand.forward < 0 ? `Backward ${Math.round(Math.abs(joystickCommand.forward))}%` : "Stop"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Turn:</span>
                    <span style={{ fontWeight: 700, color: "#2563eb", marginLeft: 8 }}>
                      {joystickCommand.turn > 0 ? `Right ${Math.round(joystickCommand.turn)}%` : 
                       joystickCommand.turn < 0 ? `Left ${Math.round(Math.abs(joystickCommand.turn))}%` : "Straight"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* DASHBOARD TAB */}
      {tab === "dashboard" && (
        <main style={g.main}>
          <div style={g.topRow}>
            <section style={{ ...g.section, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 180 }}>
              <div style={{ ...g.sectionTitle, marginBottom: 8 }}>Water Quality Score</div>
              <QualityRing score={qualityScore} />
            </section>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ ...g.banner, background: qualityLevel.bg }}>
                <div style={{
                  width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                  background: qualityLevel.color,
                  boxShadow: `0 0 12px ${qualityLevel.color}`
                }} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff" }}>
                    Quality: {qualityLevel.label} — {qualityScore}%
                  </div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
                    {latest
                      ? `Last reading: ${formatTime(latest.createdAt)} · Source: ${latest.source || "?"}`
                      : "Waiting for data…"}
                  </div>
                </div>
                <AlertBadge count={alerts.length} />
              </div>
            </div>
          </div>

          <div style={g.statsRow}>
            {["ph", "temperature", "turbidity", "dissolvedOxygen", "conductivity"].map(key => {
              const meta = THRESHOLDS[key];
              return (
                <StatCard key={key} label={meta.label} value={latest?.[key]}
                  unit={meta.unit} delta={delta(key)}
                  paramKey={key} />
              );
            })}
          </div>

          <section style={g.section}>
            <div style={g.sectionTitle}>Live Sensors</div>
            <div style={g.gaugesRow}>
              {["ph", "temperature", "turbidity", "dissolvedOxygen", "conductivity"].map(key => {
                const meta = THRESHOLDS[key];
                return (
                  <Gauge key={key} value={latest ? +latest[key] : undefined}
                    min={meta.min - (meta.max - meta.min) * 0.2}
                    max={meta.max + (meta.max - meta.min) * 0.2}
                    unit={meta.unit} label={meta.label}
                    colorKey={key} />
                );
              })}
            </div>
          </section>

          <section style={g.section}>
            <div style={g.sectionHeader}>
              <div style={g.sectionTitle}>Time Series</div>
              <div style={g.paramTabs}>
                {["ph", "temperature", "turbidity", "dissolvedOxygen", "conductivity"].map(key => (
                  <button key={key} onClick={() => setActiveParam(key)}
                    style={{
                      ...g.paramTab,
                      background: activeParam === key ? COLORS[key] + "25" : "transparent",
                      color: activeParam === key ? COLORS[key] : "#64748b",
                      borderColor: activeParam === key ? COLORS[key] : "transparent",
                    }}>
                    {THRESHOLDS[key].label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[activeParam]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={COLORS[activeParam]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip content={(props) => <ChartTooltip {...props} />} />
                <Area type="monotone" dataKey={activeParam}
                  stroke={COLORS[activeParam]} fill="url(#areaGrad)"
                  strokeWidth={2} dot={false} activeDot={{ r: 5, fill: COLORS[activeParam] }} />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          <div style={g.bottomRow}>
            <section style={{ ...g.section, flex: 2 }}>
              <div style={g.sectionTitle}>Parameter Statistics (last {history.length} readings)</div>
              <StatsPanel history={history} />
            </section>
            <section style={{ ...g.section, flex: 1, minWidth: 200 }}>
              <div style={g.sectionTitle}>Quality Distribution</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                    paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color}
                        style={{ filter: `drop-shadow(0 0 4px ${entry.color})` }} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} readings`, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={g.pieLegend}>
                {pieData.map(d => (
                  <div key={d.name} style={g.pieLegendItem}>
                    <div style={{ ...g.legendDot, background: d.color }} />
                    <span style={{ color: "#64748b", fontSize: 12 }}>{d.name}</span>
                    <span style={{ color: d.color, fontWeight: 700, marginLeft: "auto" }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <main style={g.main}>
          <section style={g.section}>
            <div style={g.sectionTitle}>
              Measurement History ({history.length} entries)
            </div>
            <div style={g.tableWrap}>
              <table style={g.table}>
                <thead>
                  <tr>
                    <th style={g.th}>Time</th>
                    <th style={g.th}>pH</th><th style={g.th}>Temp.</th>
                    <th style={g.th}>Turbidity</th><th style={g.th}>Dissolved O₂</th>
                    <th style={g.th}>Conductivity</th>
                    <th style={g.th}>Score</th>
                    <th style={g.th}>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((d, i) => {
                    const score = computeQualityScore(d);
                    const level = getQualityLevel(score);
                    return (
                      <tr key={d._id || i} style={{ background: i % 2 === 0 ? "#f8fafc" : "#ffffff" }}>
                        <td style={g.td}>{formatTime(d.createdAt)}</td>
                        {["ph", "temperature", "turbidity", "dissolvedOxygen", "conductivity"].map(k => (
                          <td key={k} style={{ ...g.td, color: PARAM_STATUS_COLOR[getParamStatus(k, d[k])] }}>
                            {Number(d[k]).toFixed(2)}{THRESHOLDS[k].unit}
                          </td>
                        ))}
                        <td style={{ ...g.td, color: level.color, fontWeight: 700 }}>
                          {score}%
                        </td>
                        <td style={g.td}>
                          <span style={{
                            ...g.badge,
                            background: level.color + "20",
                            color: level.color,
                            border: `1px solid ${level.color}40`
                          }}>
                            {level.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {/* ALERTS TAB */}
      {tab === "alerts" && (
        <main style={g.main}>
          <section style={g.section}>
            <div style={g.sectionTitle}>
              Alert Log
              <span style={{ ...g.alertBadge2, marginLeft: 12 }}>{alerts.length}</span>
            </div>
            {alerts.length === 0 ? (
              <div style={g.emptyState}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
                <div style={{ color: "#10b981", fontWeight: 700 }}>No Alerts</div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                  All readings are above 45% quality score
                </div>
              </div>
            ) : (
              [...alerts].reverse().map((d, i) => {
                const score = computeQualityScore(d);
                const level = getQualityLevel(score);
                const offenders = ["ph", "temperature", "turbidity", "dissolvedOxygen", "conductivity"]
                  .filter(k => getParamStatus(k, d[k]) !== "good");
                return (
                  <div key={d._id || i} style={{ ...g.alertCard, borderLeft: `4px solid ${level.color}` }}>
                    <div style={g.alertHeader}>
                      <span style={{ ...g.badge, background: level.color + "20", color: level.color }}>
                        {level.label} — {score}%
                      </span>
                      <span style={{ color: "#64748b", fontSize: 13 }}>
                        {formatDate(d.createdAt)} — {formatTime(d.createdAt)}
                      </span>
                    </div>
                    <div style={g.alertParams}>
                      {offenders.map(k => (
                        <div key={k} style={g.alertParam}>
                          <span style={{ color: "#64748b" }}>{THRESHOLDS[k].label}:</span>
                          <span style={{ color: PARAM_STATUS_COLOR[getParamStatus(k, d[k])], fontWeight: 700, marginLeft: 6 }}>
                            {Number(d[k]).toFixed(2)}{THRESHOLDS[k].unit}
                          </span>
                          <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>
                            (range: {THRESHOLDS[k].min}–{THRESHOLDS[k].max})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </main>
      )}

      <footer style={g.footer}>
        <span>AquaSense IoT Platform</span>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <span>WebSocket {isConnected ? "🟢" : "🔴"}</span>
        {serverInfo && <>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span>Uptime: {Math.floor(serverInfo.uptime / 60)}m</span>
        </>}
        <span style={{ color: "#cbd5e1" }}>·</span>
        <span>Forward: {Math.round(joystickCommand.forward)}% | Turn: {Math.round(joystickCommand.turn)}%</span>
      </footer>
    </div>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────────────
const g = {
  app: { fontFamily: "'DM Mono','Fira Code','Courier New',monospace", background: "#bde0f7", minHeight: "100vh", color: "#1e293b", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", height: 64, borderBottom: "1px solid #e2e8f0", background: "#ffffff", position: "sticky", top: 0, zIndex: 100, gap: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
  headerRight: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  logo: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  logoIcon: { fontSize: 24, color: "#2563eb", lineHeight: 1 },
  logoTitle: { fontSize: 16, fontWeight: 700, color: "#1e293b", letterSpacing: "0.05em" },
  logoSub: { fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" },
  nav: { display: "flex", gap: 4 },
  navBtn: { background: "transparent", border: "none", color: "#64748b", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "inherit", position: "relative", transition: "all 0.2s" },
  navBtnActive: { background: "#eff6ff", color: "#2563eb" },
  navBadge: { position: "absolute", top: 2, right: 2, background: "#ef4444", color: "white", borderRadius: 8, fontSize: 9, padding: "1px 5px", fontWeight: 700 },
  connDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  connLabel: { fontSize: 12, color: "#64748b" },
  connTime: { fontSize: 10, color: "#94a3b8" },
  main: { flex: 1, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20 },
  topRow: { display: "flex", gap: 16, flexWrap: "wrap" },
  ringWrap: { display: "flex", justifyContent: "center" },
  banner: { borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 },
  alertBadge: { marginLeft: "auto", background: "#fee2e2", color: "#dc2626", padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700, border: "1px solid #fecaca" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12 },
  statCard: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" },
  statLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" },
  statVal: { fontSize: 22, fontWeight: 700, margin: "4px 0 0" },
  statUnit: { fontSize: 12, fontWeight: 400, marginLeft: 2 },
  statDelta: { fontSize: 11, marginTop: 3 },
  paramStatusBadge: { display: "inline-block", marginTop: 6, padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600 },
  section: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" },
  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 },
  paramTabs: { display: "flex", gap: 6, flexWrap: "wrap" },
  paramTab: { padding: "4px 12px", borderRadius: 99, border: "1px solid transparent", cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all 0.2s" },
  gaugesRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 },
  gaugeWrap: { textAlign: "center", padding: "8px 0" },
  gaugeVal: { fontSize: 20, fontWeight: 700, marginTop: -4 },
  gaugeLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 },
  bottomRow: { display: "flex", gap: 16, flexWrap: "wrap" },
  statsPanel: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 },
  statsPanelCard: { background: "#f8fafc", borderRadius: 10, padding: "12px 14px" },
  statsPanelLabel: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 },
  statsPanelRow: { display: "flex", justifyContent: "space-between", marginBottom: 10 },
  statsPanelItem: { textAlign: "center", flex: 1 },
  statsPanelItemLabel: { fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 },
  statsPanelItemVal: { fontSize: 13, fontWeight: 700 },
  statsPanelBar: { height: 4, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", marginBottom: 4 },
  statsPanelBarFill: { height: "100%", borderRadius: 99, transition: "width 0.5s ease" },
  statsPanelRange: { display: "flex", justifyContent: "space-between", fontSize: 9, color: "#94a3b8" },
  pieLegend: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  pieLegendItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },
  legendDot: { width: 8, height: 8, borderRadius: "50%" },
  tooltip: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" },
  tooltipTime: { color: "#64748b", fontSize: 11, marginBottom: 4 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "9px 12px", color: "#334155", borderBottom: "1px solid #f1f5f9" },
  badge: { padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, display: "inline-block" },
  alertCard: { background: "#ffffff", borderRadius: 10, padding: "14px 18px", marginBottom: 10, border: "1px solid #e2e8f0" },
  alertHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  alertParams: { display: "flex", flexDirection: "column", gap: 4 },
  alertParam: { fontSize: 13 },
  alertBadge2: { background: "#fee2e2", color: "#dc2626", padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 700 },
  emptyState: { textAlign: "center", padding: "48px 0", color: "#64748b" },
  footer: { padding: "14px 28px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 12, fontSize: 12, color: "#64748b", background: "#ffffff", flexWrap: "wrap" },
};
