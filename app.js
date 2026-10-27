/* ---------------------------------------------------------------
   HO GAYA TERA — voice interrupter
   Cycle: ARMED (waiting) → HEARING (you're talking) → SPEAKING
          (one line) → RE-ARM (waits until you go quiet) → ARMED …
   So the next line only fires when you start talking *again*.
---------------------------------------------------------------- */

// --- Tuning ---------------------------------------------------
const VOICE_MS = 350;      // how long you must talk before it cuts in
const QUIET_MS = 900;      // how long you must be quiet before it listens again
const MIN_THRESHOLD = 0.03; // floor for what counts as a voice
const NOISE_MULT = 2.6;    // voice must be this many times louder than the room
const REACT_MS = [350, 700]; // human-ish pause before it answers (random in range)

// --- The script -----------------------------------------------
// `clip` is optional: drop your own recordings in /audio with these
// names and they'll be used instead of the computer voice.
const LINES = [
  { clip: "audio/01.mp3", speak: "हो गया तेरा।", lang: "hi-IN", rate: 0.82 },
  { clip: "audio/02.mp3", speak: "बस कर यार।", lang: "hi-IN", rate: 0.82 },
  { clip: "audio/03.mp3", speak: "Someone… take this human away from me.", lang: "en-IN", rate: 0.88 },
];

// --- Elements -------------------------------------------------
const $ = (id) => document.getElementById(id);
const toggle = $("toggle");
const statusEl = $("status");
const pill = $("pill");
const stateLine = $("stateLine");
const canvas = $("wave");
const ctx = canvas.getContext("2d");
const logEl = $("log");
const rawEl = $("raw");
const voiceNameEl = $("voiceName");
const lineEls = [...document.querySelectorAll("#script .line")];
const meters = {
  voice: [$("mVoice"), $("pVoice")],
  patience: [$("mPatience"), $("pPatience")],
  arm: [$("mArm"), $("pArm")],
};

// --- State ----------------------------------------------------
let stream, audioCtx, analyser, source, samples;
let raf = 0;
let state = "off"; // off | armed | hearing | speaking | rearm
let lastTs = 0;
let voicedMs = 0;
let quietMs = 0;
let noiseFloor = 0.01;
let nextLine = 0;
let level = 0;
let history = [];
let rawTimer = 0;

// --- Small helpers --------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n, w = 2) => String(n).padStart(w, "0");
const now = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setState(next) {
  state = next;
  document.body.dataset.state = next;
  const labels = {
    off: ["MIC OFF", "STATE // IDLE"],
    armed: ["LISTENING", "STATE // ARMED"],
    hearing: ["HEARING YOU", "STATE // DETECTING"],
    speaking: ["TALKING OVER YOU", "STATE // FIRING"],
    rearm: ["WAITING", "STATE // RE-ARMING"],
  };
  pill.textContent = labels[next][0];
  stateLine.textContent = labels[next][1];
}

function setStatus(t) {
  statusEl.textContent = t;
}

function setMeter(name, pct) {
  const [fill, label] = meters[name];
  const p = Math.round(clamp(pct, 0, 100));
  fill.style.width = p + "%";
  label.textContent = p + " %";
}

function log(text) {
  const li = document.createElement("li");
  li.textContent = `${now()} // ${text}`;
  logEl.prepend(li);
  while (logEl.children.length > 7) logEl.lastElementChild.remove();
}

function paintScript(activeIdx = -1) {
  lineEls.forEach((el, i) => {
    el.classList.toggle("active", i === activeIdx);
    el.classList.toggle("next", state !== "off" && activeIdx === -1 && i === nextLine);
    el.classList.toggle("done", state !== "off" && i < nextLine && i !== activeIdx);
  });
  setMeter("patience", 100 - (nextLine / LINES.length) * 100);
}

// --- Voices: pick the most natural one installed ---------------
function bestVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  let best = null;
  let bestScore = -1;
  for (const v of voices) {
    const vl = v.lang.replace("_", "-");
    let s = 0;
    if (vl === lang) s += 10;
    else if (vl.startsWith(base)) s += 6;
    else continue;
    if (/natural|neural|online/i.test(v.name)) s += 8; // Edge's human-sounding voices
    if (/premium|enhanced/i.test(v.name)) s += 6;     // macOS downloaded voices
    if (/google/i.test(v.name)) s += 4;
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

function showVoices() {
  const hi = bestVoice("hi-IN");
  const en = bestVoice("en-IN") || bestVoice("en-GB");
  const short = (v) => (v ? v.name.replace(/^Microsoft |\(.*\)| - .*/g, "").trim() : "DEFAULT");
  voiceNameEl.textContent = `VOICE // HI ${short(hi)} · EN ${short(en)}`.toUpperCase();
}

// --- Recorded clips (optional) ---------------------------------
const clips = LINES.map((line) => {
  const a = new Audio();
  a.preload = "auto";
  a.dataset.ok = "pending";
  a.addEventListener("canplaythrough", () => (a.dataset.ok = "yes"), { once: true });
  a.addEventListener("error", () => (a.dataset.ok = "no"), { once: true });
  a.src = line.clip;
  return a;
});

function playClip(a) {
  return new Promise((resolve) => {
    a.currentTime = 0;
    a.onended = resolve;
    a.onerror = resolve;
    a.play().catch(resolve);
  });
}

function speakTTS(line) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(line.speak);
    u.lang = line.lang;
    const v = bestVoice(line.lang) || (line.lang.startsWith("en") && bestVoice("en-GB"));
    if (v) u.voice = v;
    u.rate = line.rate;
    u.pitch = 1;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// --- Fire one line --------------------------------------------
async function fire() {
  const i = nextLine;
  setState("speaking");
  log(`VOICE DETECTED // LINE ${pad(i + 1)}`);
  paintScript(i);
  setStatus(lineEls[i].querySelector(".said").textContent);

  // a beat before answering, like a person would
  await sleep(REACT_MS[0] + Math.random() * (REACT_MS[1] - REACT_MS[0]));
  if (state !== "speaking") return;

  if (clips[i].dataset.ok === "yes") await playClip(clips[i]);
  else await speakTTS(LINES[i]);
  if (state !== "speaking") return; // stopped mid-line

  nextLine = (i + 1) % LINES.length;
  log(nextLine === 0 ? "SCRIPT COMPLETE // LOOPING" : `LINE ${pad(i + 1)} DONE // WAITING`);
  quietMs = 0;
  voicedMs = 0;
  lastTs = 0;
  setState("rearm");
  setStatus("Waiting for you to stop talking…");
  if (nextLine === 0) {
    // all three struck through, patience at zero, until it re-arms
    lineEls.forEach((el) => {
      el.classList.remove("active", "next");
      el.classList.add("done");
    });
    setMeter("patience", 0);
  } else {
    paintScript();
  }
}

// --- Mic level ------------------------------------------------
function micLevel() {
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const s of samples) {
    const v = (s - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function threshold() {
  return Math.max(MIN_THRESHOLD, noiseFloor * NOISE_MULT);
}

// --- Main loop ------------------------------------------------
function tick(ts) {
  if (state === "off") return;
  const dt = lastTs ? Math.min(ts - lastTs, 80) : 16;
  lastTs = ts;

  level = micLevel();
  const th = threshold();
  const loud = level > th;

  // learn the room's background noise while nobody's talking
  if (!loud && state !== "speaking") noiseFloor += (level - noiseFloor) * 0.02;

  if (state === "armed" || state === "hearing") {
    if (loud) {
      voicedMs += dt;
      if (state === "armed") setState("hearing");
      setStatus("Hearing you…");
    } else {
      voicedMs = Math.max(0, voicedMs - dt * 1.5);
      if (voicedMs === 0 && state === "hearing") {
        setState("armed");
        setStatus(nextLine === 0 ? "Listening. Go on, say something." : "Listening. Say something again.");
      }
    }
    if (voicedMs >= VOICE_MS) {
      voicedMs = 0;
      fire();
    }
  } else if (state === "rearm") {
    quietMs = loud ? 0 : quietMs + dt;
    if (quietMs >= QUIET_MS) {
      setState("armed");
      setStatus(nextLine === 0 ? "Listening. Go on, say something." : "Listening. Say something again.");
      if (nextLine === 0) paintScript();
    }
  }

  setMeter("voice", (level / 0.2) * 100);
  setMeter("arm", state === "rearm" ? (quietMs / QUIET_MS) * 100 : state === "speaking" ? 0 : 100);

  history.push(state === "speaking" ? -1 : level);
  drawWave(ts);

  rawTimer += dt;
  if (rawTimer > 120) {
    rawTimer = 0;
    drawRaw();
  }

  raf = requestAnimationFrame(tick);
}

// --- Dot-matrix waveform --------------------------------------
const CELL = 6;
let cols = 0;
let rows = 0;

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.floor(w / CELL);
  rows = Math.floor(h / CELL);
  drawWave(performance.now());
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawWave(ts) {
  if (!cols) return;
  if (history.length > cols) history = history.slice(-cols);
  const ink = css("--ink");
  const faint = css("--faint");
  const hot = css("--hot");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const mid = (rows - 1) / 2;
  const offset = cols - history.length;

  for (let c = 0; c < cols; c++) {
    const v = history[c - offset];
    let half = 0;
    let color = ink;
    if (v === -1) {
      // it's talking: blocky synthetic signal
      half = Math.round(mid * (0.35 + 0.45 * Math.abs(Math.sin(ts / 90 + c * 0.55))));
      color = hot;
    } else if (v !== undefined) {
      half = Math.round(clamp(v / 0.18, 0, 1) * mid);
    }
    for (let r = 0; r < rows; r++) {
      const x = c * CELL;
      const y = r * CELL;
      if (Math.abs(r - mid) <= half && half > 0) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, CELL - 1, CELL - 1);
      } else {
        ctx.fillStyle = faint;
        ctx.fillRect(x + CELL / 2 - 1, y + CELL / 2 - 1, 1.5, 1.5);
      }
    }
  }
}

function drawRaw() {
  const recent = history.slice(-16).map((v) => (v === -1 ? 999 : Math.round(v * 9999)));
  while (recent.length < 16) recent.unshift(0);
  const rowsTxt = [];
  for (let r = 0; r < 4; r++) {
    const g = recent.slice(r * 4, r * 4 + 4);
    rowsTxt.push(`${pad(g[0], 4)}.${pad(g[1] % 1000, 3)}.${pad(g[2] % 1000, 3)}.${pad(g[3] % 1000, 3)}`);
  }
  rawEl.textContent = rowsTxt.join("\n");
}

// --- Start / stop ---------------------------------------------
async function start() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  audioCtx = new AudioContext();
  await audioCtx.resume();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  samples = new Uint8Array(analyser.fftSize);
  source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  // unlock audio playback for recorded clips on this click
  clips.forEach((a) => a.load());

  nextLine = 0;
  voicedMs = quietMs = 0;
  noiseFloor = 0.01;
  history = [];
  lastTs = 0;
  setState("armed");
  paintScript();
  toggle.textContent = "[ STOP LISTENING ]";
  toggle.classList.add("stop");
  setStatus("Listening. Go on, say something.");
  log("MIC ON // ARMED");
  raf = requestAnimationFrame(tick);
}

function stop() {
  const wasOn = state !== "off";
  setState("off");
  cancelAnimationFrame(raf);
  speechSynthesis.cancel();
  clips.forEach((a) => a.pause());
  if (source) source.disconnect();
  if (audioCtx) audioCtx.close();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = audioCtx = analyser = source = samples = null;
  nextLine = 0;
  history = [];
  paintScript();
  lineEls.forEach((el) => el.classList.remove("done", "next", "active"));
  setMeter("voice", 0);
  setMeter("arm", 0);
  drawWave(0);
  toggle.textContent = "[ START LISTENING ]";
  toggle.classList.remove("stop");
  setStatus("Mic is off. Start listening when you’re ready.");
  if (wasOn) log("MIC OFF");
}

toggle.addEventListener("click", async () => {
  if (state !== "off") return stop();
  try {
    setStatus("Asking for the microphone…");
    await start();
  } catch (err) {
    console.error(err);
    stop();
    setStatus("Microphone was blocked. Allow it and try again.");
    log("MIC BLOCKED");
  }
});

// --- Boot -----------------------------------------------------
setInterval(() => ($("clock").textContent = now()), 1000);
$("clock").textContent = now();
speechSynthesis.onvoiceschanged = showVoices;
showVoices();
window.addEventListener("resize", sizeCanvas);
sizeCanvas();
setState("off");
paintScript();
