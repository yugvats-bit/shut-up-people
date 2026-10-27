// How long a voice has to keep going before we cut in (ms).
const SPEAK_MS = 120;
// Mic level that counts as a voice.
const THRESHOLD = 0.045;
// Number of bars in the waveform.
const BARS = 28;

// What gets said out loud. Hindi lines are spoken from Devanagari so the
// Hindi voice pronounces them properly; the page shows the romanised text.
const LINES = [
  { speak: "हो गया तेरा", lang: "hi-IN", rate: 1.0, pitch: 0.8 },
  { speak: "बस कर यार", lang: "hi-IN", rate: 1.0, pitch: 0.8 },
  { speak: "someone take this human away from me", lang: "en-IN", rate: 1.0, pitch: 0.75 },
];

const toggle = document.getElementById("toggle");
const statusEl = document.getElementById("status");
const pill = document.getElementById("pill");
const wave = document.getElementById("wave");
const lineEls = [...document.querySelectorAll("#script .line")];

let stream = null;
let audioCtx = null;
let analyser = null;
let source = null;
let samples = null;
let raf = 0;
let listening = false;
let busy = false;
let speakingMs = 0;
let lastTs = 0;

// Build the waveform bars once.
const bars = Array.from({ length: BARS }, () => {
  const bar = document.createElement("span");
  wave.appendChild(bar);
  return bar;
});

function setStatus(text) {
  statusEl.textContent = text;
}

function setPill(text, state) {
  pill.textContent = text;
  pill.dataset.state = state;
}

function setActiveLine(i) {
  lineEls.forEach((el, n) => el.classList.toggle("active", n === i));
}

// Pick the best installed voice for a language, falling back to its base language.
function voiceFor(lang) {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.replace("_", "-").startsWith(lang.split("-")[0])) ||
    null
  );
}

function speak(line) {
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(line.speak);
    utter.lang = line.lang;
    const voice = voiceFor(line.lang);
    if (voice) utter.voice = voice;
    utter.rate = line.rate;
    utter.pitch = line.pitch;
    utter.onend = resolve;
    utter.onerror = resolve;
    window.speechSynthesis.speak(utter);
  });
}

async function shutThemUp() {
  busy = true;
  document.body.classList.add("talking");
  setPill("TALKING OVER YOU", "talking");
  window.speechSynthesis.cancel();

  for (let i = 0; i < LINES.length; i++) {
    if (!listening) break;
    setActiveLine(i);
    setStatus(lineEls[i].querySelector(".said").textContent);
    await speak(LINES[i]);
  }

  setActiveLine(-1);
  document.body.classList.remove("talking");
  busy = false;
  speakingMs = 0;
  lastTs = 0;
  if (listening) {
    setPill("LISTENING", "live");
    setStatus("Listening. Go on, try saying something.");
  }
}

function micLevel() {
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const s of samples) {
    const v = (s - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function drawWave(level, ts) {
  const amp = Math.min(level * 14, 1);
  bars.forEach((bar, i) => {
    const wobble = 0.55 + 0.45 * Math.sin(ts / 140 + i * 0.7);
    const h = 0.08 + amp * wobble;
    bar.style.transform = `scaleY(${Math.min(h, 1).toFixed(3)})`;
  });
}

function tick(ts) {
  if (!listening) return;
  const dt = lastTs ? Math.min(ts - lastTs, 80) : 16;
  lastTs = ts;

  const level = micLevel();
  drawWave(level, ts);

  if (!busy) {
    if (level > THRESHOLD) {
      speakingMs += dt;
      document.body.classList.add("hot");
      setStatus("Hearing you…");
    } else {
      speakingMs = 0;
      document.body.classList.remove("hot");
      setStatus("Listening. Go on, try saying something.");
    }

    if (speakingMs >= SPEAK_MS) {
      speakingMs = 0;
      document.body.classList.remove("hot");
      shutThemUp();
    }
  }

  raf = requestAnimationFrame(tick);
}

async function start() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  audioCtx = new AudioContext();
  await audioCtx.resume();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  samples = new Uint8Array(analyser.fftSize);
  source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  listening = true;
  busy = false;
  speakingMs = 0;
  lastTs = 0;
  toggle.textContent = "Stop listening";
  toggle.classList.add("stop");
  document.body.classList.add("live");
  setPill("LISTENING", "live");
  setStatus("Listening. Go on, try saying something.");
  raf = requestAnimationFrame(tick);
}

function stop() {
  listening = false;
  busy = false;
  cancelAnimationFrame(raf);
  window.speechSynthesis.cancel();
  if (source) source.disconnect();
  if (audioCtx) audioCtx.close();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = audioCtx = analyser = source = samples = null;
  speakingMs = 0;

  drawWave(0, 0);
  setActiveLine(-1);
  document.body.classList.remove("live", "hot", "talking");
  toggle.textContent = "Start listening";
  toggle.classList.remove("stop");
  setPill("MIC OFF", "off");
  setStatus("Mic is off. Start listening when you’re ready.");
}

toggle.addEventListener("click", async () => {
  if (listening) {
    stop();
    return;
  }
  try {
    setStatus("Asking for the microphone…");
    await start();
  } catch (err) {
    console.error(err);
    stop();
    setStatus("Microphone was blocked. Allow it and try again.");
  }
});

// Some browsers load voices late; touching the list early warms it up.
window.speechSynthesis.getVoices();
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

drawWave(0, 0);
setPill("MIC OFF", "off");
