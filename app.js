const SPEAK_MS = 80;
const LINE = "Shut up. Don't bother me right now.";

const toggle = document.getElementById("toggle");
const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");
const meterEl = document.getElementById("meter");
const orb = document.getElementById("orb");

let stream = null;
let audioCtx = null;
let analyser = null;
let source = null;
let raf = 0;
let listening = false;
let speakingMs = 0;
let lastTs = 0;
let busy = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function setTimer() {
  timerEl.textContent = busy ? "talking over you" : "any voice gets shut down";
}

function sayLine() {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(LINE);
    utter.rate = 0.95;
    utter.pitch = 0.7;
    utter.onend = resolve;
    utter.onerror = resolve;
    window.speechSynthesis.speak(utter);
  });
}

function levelFromAnalyser() {
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const s of samples) {
    const v = (s - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function tick(ts) {
  if (!listening) return;
  const dt = lastTs ? Math.min(ts - lastTs, 80) : 16;
  lastTs = ts;

  const level = levelFromAnalyser();
  const shown = Math.min(100, level * 900);
  meterEl.style.width = `${shown}%`;
  orb.style.setProperty("--level", String(0.9 + Math.min(level * 6, 0.45)));
  orb.querySelector(".ring").style.transform = `scale(${0.86 + Math.min(level * 2.2, 0.28)})`;

  const voiced = !busy && level > 0.045;

  if (voiced) {
    speakingMs += dt;
    orb.classList.add("hot", "live");
    orb.classList.remove("talking");
    setStatus("Hearing you…");
  } else if (!busy) {
    speakingMs = 0;
    orb.classList.remove("hot");
    setStatus("Listening. Try talking.");
  }

  setTimer();

  if (!busy && speakingMs >= SPEAK_MS) {
    speakingMs = 0;
    busy = true;
    orb.classList.add("talking", "hot");
    setStatus("Shut up. Don’t bother me right now.");
    sayLine().then(() => {
      busy = false;
      lastTs = 0;
      speakingMs = 0;
      if (listening) setStatus("Listening. Try talking.");
      orb.classList.remove("talking", "hot");
    });
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
  source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  listening = true;
  speakingMs = 0;
  lastTs = 0;
  busy = false;
  toggle.textContent = "Stop listening";
  toggle.classList.add("stop");
  orb.classList.add("live");
  setStatus("Listening. Try talking.");
  setTimer();
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
  stream = null;
  audioCtx = null;
  analyser = null;
  source = null;
  speakingMs = 0;
  meterEl.style.width = "0%";
  orb.classList.remove("live", "hot", "talking");
  toggle.textContent = "Start listening";
  toggle.classList.remove("stop");
  setStatus("Mic is off");
  setTimer();
}

toggle.addEventListener("click", async () => {
  try {
    if (listening) {
      stop();
      return;
    }
    setStatus("Asking for the microphone…");
    await start();
  } catch (err) {
    setStatus("Microphone was blocked. Allow it and try again.");
    console.error(err);
  }
});
