/* ══════════════════════════════════════════
   HANGMAN  —  main script
══════════════════════════════════════════ */

const BODY_PARTS   = ["p-head","p-body","p-larm","p-rarm","p-lleg","p-rleg","p-face"];
const QWERTY_ROWS  = ["qwertyuiop","asdfghjkl","zxcvbnm"];

// Category display data (mirrors server CATEGORY_META)
const CAT_META = {
  animals:       {emoji:"🐾", color:"#ff9f43"},
  food:          {emoji:"🍎", color:"#ee5a24"},
  nature:        {emoji:"🌿", color:"#44bd32"},
  science:       {emoji:"🔬", color:"#0097e6"},
  geography:     {emoji:"🌍", color:"#9980fa"},
  music:         {emoji:"🎵", color:"#f9ca24"},
  history:       {emoji:"🏛️",  color:"#e17055"},
  technology:    {emoji:"💻", color:"#00b894"},
  entertainment: {emoji:"🎭", color:"#fd79a8"},
  everyday:      {emoji:"🏠", color:"#74b9ff"},
  mythology:     {emoji:"⚡", color:"#a29bfe"},
  sports:        {emoji:"⚽", color:"#e84393"},
};

const DIFF_MULT = {easy:1, medium:1.5, hard:2};

// ── State ─────────────────────────────────
let currentLevel  = "medium";
let gameOver      = false;
let sessionScore  = 0;
let confettiRAF   = null;
let confettiPieces= [];

// ── Persistent stats (MongoDB via API) ────────
let _statsCache = {highScore:0, totalWins:0, totalGames:0, bestStreak:0, currentStreak:0};

async function initStats() {
  try {
    const r = await fetch("/api/stats");
    const data = await r.json();
    _statsCache = {..._statsCache, ...data};
  } catch { /* MongoDB unavailable — use defaults */ }
  refreshStatsPanel();
}

function getStats() { return {..._statsCache}; }

function saveStats(s) {
  _statsCache = {...s};
  fetch("/api/stats", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(s),
  }).catch(() => { /* ignore offline errors */ });
}

// ── Web Audio ─────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playWhisperSFX() {
  try {
    const ac = getAudio();
    if (ac.state === "suspended") return;
    
    const bufferSize = ac.sampleRate * 0.35;
    const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer;
    
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(650, ac.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1350, ac.currentTime + 0.3);
    filter.Q.value = 9.0;
    
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.045, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.33);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    noise.start();
  } catch(e) {}
}

function playJumpscareSound() {
  try {
    const ac = getAudio();
    if (ac.state === "suspended") ac.resume();
    
    // Deep rumbling sub bass
    const subOsc = ac.createOscillator();
    const subGain = ac.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(45, ac.currentTime);
    subOsc.frequency.linearRampToValueAtTime(30, ac.currentTime + 1.2);
    subGain.gain.setValueAtTime(0.8, ac.currentTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.2);
    subOsc.connect(subGain).connect(ac.destination);
    subOsc.start(); subOsc.stop(ac.currentTime + 1.4);

    // High frequency screaming oscillators
    const osc1 = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const screamerGain = ac.createGain();
    
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(2600, ac.currentTime);
    osc1.frequency.linearRampToValueAtTime(150, ac.currentTime + 0.85);
    
    osc2.type = "square";
    osc2.frequency.setValueAtTime(2400, ac.currentTime);
    osc2.frequency.linearRampToValueAtTime(100, ac.currentTime + 0.85);
    
    // High frequency hiss sweep
    const bufferSize = ac.sampleRate * 1.5;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ac.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1100;
    
    const bpFilter = ac.createBiquadFilter();
    bpFilter.type = "bandpass";
    bpFilter.frequency.setValueAtTime(2200, ac.currentTime);
    bpFilter.frequency.exponentialRampToValueAtTime(350, ac.currentTime + 0.9);
    bpFilter.Q.value = 4.0;
    
    screamerGain.gain.setValueAtTime(0.9, ac.currentTime);
    screamerGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.3);
    
    osc1.connect(screamerGain);
    osc2.connect(screamerGain);
    noise.connect(filter).connect(bpFilter).connect(screamerGain);
    screamerGain.connect(ac.destination);
    
    osc1.start(); osc2.start(); noise.start();
    osc1.stop(ac.currentTime + 1.5); osc2.stop(ac.currentTime + 1.5); noise.stop(ac.currentTime + 1.5);
  } catch(e) {}
}

function playSound(type) {
  try {
    const ac = getAudio();
    if (type === "correct") {
      // Eerie high pitch chime
      tone(ac, 784, "sine", 0.16, 0.45);
      setTimeout(() => tone(ac, 987, "sine", 0.12, 0.35), 90);
    } else if (type === "wrong") {
      // Detuned dual oscillator screech
      const o1 = ac.createOscillator();
      const o2 = ac.createOscillator();
      const g = ac.createGain();
      o1.type = "sawtooth";
      o1.frequency.setValueAtTime(190, ac.currentTime);
      o1.frequency.linearRampToValueAtTime(90, ac.currentTime + 0.4);
      
      o2.type = "square";
      o2.frequency.setValueAtTime(200, ac.currentTime);
      o2.frequency.linearRampToValueAtTime(70, ac.currentTime + 0.4);
      
      g.gain.setValueAtTime(0.25, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
      
      o1.connect(g); o2.connect(g); g.connect(ac.destination);
      o1.start(); o2.start();
      o1.stop(ac.currentTime + 0.45); o2.stop(ac.currentTime + 0.45);
    } else if (type === "win") {
      // Haunting minor success chords
      [440, 523, 659, 880].forEach((f, i) => setTimeout(() => tone(ac, f, "triangle", 0.15, 0.6), i * 110));
    } else if (type === "lose") {
      // Handled by jumpscare screamer sound, keeping this for fallback
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g).connect(ac.destination);
      o.type = "sawtooth"; o.frequency.value = 180;
      o.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 1.0);
      g.gain.setValueAtTime(0.3, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.0);
      o.start(); o.stop(ac.currentTime + 1.0);
    }
  } catch(_) {}
}
function tone(ac, freq, type, vol, dur) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.connect(g).connect(ac.destination);
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  o.start(); o.stop(ac.currentTime + dur);
}

// ══════════════════════════════════════════
// GAMEPLAY SOUND — dropped-in audio files
// ══════════════════════════════════════════
const GAME_AMBIENT_TRACK = "/static/audio/ambient-chilling.mp3";
const CRY_SOUNDS = ["/static/audio/cry-1.mp3", "/static/audio/cry-4.mp3"];

let gameAmbientTimer  = null;
let gameAmbientActive = false;

// The clip is only ~1 second long, so looping it is a rapid stutter, not
// ambience. Instead: play it once as a brief "sting", go quiet, wait a
// random stretch, play again — an intermittent haunting, not a drone.
function startGameAmbient() {
  if (gameAmbientActive) return; // already running
  gameAmbientActive = true;
  scheduleAmbientPulse(1800);
  startGameWhispers();
}

function scheduleAmbientPulse(delay) {
  gameAmbientTimer = setTimeout(() => {
    playAmbientPulse();
    scheduleAmbientPulse(13000 + Math.random() * 12000); // next one in ~13-25s
  }, delay);
}

function playAmbientPulse() {
  const audio = new Audio(GAME_AMBIENT_TRACK);
  try {
    const ac = getAudio();
    if (ac.state === "suspended") ac.resume();
    const source = ac.createMediaElementSource(audio);
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 850; // muffled, distant — not right in your ear
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ac.currentTime + 0.15); // quick fade in
    source.connect(filter).connect(gain).connect(ac.destination);
  } catch (e) {
    audio.volume = 0.16; // Web Audio routing failed — fall back to a quiet one-shot
  }
  audio.play().catch(() => {}); // ignore if the browser blocks autoplay
}

function stopGameAmbient() {
  gameAmbientActive = false;
  clearTimeout(gameAmbientTimer);
  gameAmbientTimer = null;
  stopGameWhispers();
}

// Only cries out on some wrong guesses (not every single one) and quieter —
// a constant loud scream on every miss is exhausting, not scary.
function playCrySFX() {
  if (Math.random() > 0.4) return;
  const src = CRY_SOUNDS[Math.floor(Math.random() * CRY_SOUNDS.length)];
  const audio = new Audio(src);
  audio.volume = 0.35;
  audio.play().catch(() => {});
}

// Faint synthesized whispers drifting in at random while you play —
// the "voices of horror" layered under the ambient drone.
function startGameWhispers() {
  if (gameWhisperTimer) return;
  const schedule = () => {
    gameWhisperTimer = setTimeout(() => {
      playWhisperSFX();
      schedule();
    }, 6000 + Math.random() * 7000);
  };
  schedule();
}

function stopGameWhispers() {
  clearTimeout(gameWhisperTimer);
  gameWhisperTimer = null;
}

// ══════════════════════════════════════════
// INTRO / LOADING SCREEN
// ══════════════════════════════════════════
const INTRO_DURATION_MS = 2200;
const INTRO_LINES = [
  "loading nightmare…",
  "counting your sins…",
  "the rope is ready…",
  "something is watching…",
  "do not look behind you…",
  "preparing the gallows…",
  "it already knows your name…",
  "checking your pulse…",
  "the letters are hungry…",
];

const REVEAL_IMAGE = "/static/images/horrible%20%20(4).jpg"; // the reveal shown right after loading

let introImages     = [];
let introImgTimer   = null;
let introLineTimer  = null;
let introTimer      = null;
let introFinished    = false;

async function initIntroImages() {
  let urls = [];
  try {
    const r = await fetch("/api/cat-images?cat=horrible&n=8");
    const data = await r.json();
    urls = data.urls || [];
  } catch { /* offline — intro plays over plain black */ }
  introImages = urls;
  if (!introImages.length) return;
  introImages.forEach(src => { new Image().src = src; }); // warm the cache
  cycleIntroBg(1400);
}

// Crossfades two stacked layers so image swaps never show a blank frame
function cycleIntroBg(interval) {
  if (introImgTimer) clearInterval(introImgTimer);
  if (!introImages.length) return;
  let front = document.getElementById("intro-bg-a");
  let back  = document.getElementById("intro-bg-b");
  const paint = () => {
    back.style.backgroundImage = `url('${introImages[Math.floor(Math.random() * introImages.length)]}')`;
    back.classList.add("show");
    front.classList.remove("show");
    [front, back] = [back, front];
  };
  paint();
  introImgTimer = setInterval(paint, interval);
}

function introLoadingLine() {
  document.getElementById("intro-loading-line").textContent =
    INTRO_LINES[Math.floor(Math.random() * INTRO_LINES.length)];
}

// Intro-only sound — kept fully separate from the in-game ambient system.
// Tries a real file first, falls back to a synthesized drone + whispers.
let introSoundHandle = null;

function playIntroFileAudio() {
  return new Promise((resolve, reject) => {
    const audio = new Audio("/static/audio/intro.mp3");
    audio.volume = 0.55;
    audio.play().then(() => resolve(audio)).catch(reject);
  });
}

function startIntroSynth() {
  const ac  = getAudio();
  const out = ac.createGain();
  out.gain.setValueAtTime(0, ac.currentTime);
  out.gain.linearRampToValueAtTime(0.4, ac.currentTime + 1.5);
  out.connect(ac.destination);

  const osc1 = ac.createOscillator();
  const osc2 = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();

  osc1.type = "sawtooth"; osc1.frequency.value = 48;
  osc2.type = "triangle"; osc2.frequency.value = 49.5;
  filter.type = "lowpass"; filter.frequency.value = 140; filter.Q.value = 4;
  lfo.type = "sine"; lfo.frequency.value = 0.6; lfoGain.gain.value = 22;

  lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
  osc1.connect(filter); osc2.connect(filter); filter.connect(out);
  osc1.start(); osc2.start(); lfo.start();

  const whisperTimer = setInterval(() => {
    if (Math.random() < 0.7) playWhisperSFX();
  }, 900 + Math.random() * 700);

  return {
    stop() {
      clearInterval(whisperTimer);
      try {
        out.gain.setValueAtTime(out.gain.value, ac.currentTime);
        out.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
        setTimeout(() => { osc1.stop(); osc2.stop(); lfo.stop(); }, 450);
      } catch(e) {}
    }
  };
}

function stopIntroSound() {
  if (!introSoundHandle) return;
  introSoundHandle.stop();
  introSoundHandle = null;
}

function enterIntro() {
  document.getElementById("intro-gate").style.display = "none";
  document.getElementById("intro-loading").classList.remove("hidden");

  // Core progression — must always happen, even if the audio call below
  // throws for some reason. A stuck "ENTER" button is worse than silence.
  cycleIntroBg(480); // faster flicker once loading kicks in
  introLoadingLine();
  introLineTimer = setInterval(introLoadingLine, 850);

  const fill = document.getElementById("intro-bar-fill");
  requestAnimationFrame(() => {
    fill.style.transition = `width ${INTRO_DURATION_MS}ms linear`;
    fill.style.width = "100%";
  });

  introTimer = setTimeout(finishIntro, INTRO_DURATION_MS);

  // Sound is best-effort — never let it block getting into the game.
  try {
    const ac = getAudio();
    if (ac.state === "suspended") ac.resume();
    playIntroFileAudio()
      .then(audio => { introSoundHandle = { stop() { audio.pause(); audio.currentTime = 0; } }; })
      .catch(() => {
        try { introSoundHandle = startIntroSynth(); } catch (e) {}
      });
  } catch (e) {}
}

function finishIntro() {
  if (introFinished) return;
  introFinished = true;

  clearTimeout(introTimer);
  clearInterval(introLineTimer);
  clearInterval(introImgTimer);
  document.getElementById("screen-intro").classList.add("intro-out");
  try { stopIntroSound(); } catch (e) {}

  // one last scare before the reveal, covering the screen swap underneath
  const overlay = document.getElementById("screamer-overlay");
  try {
    document.getElementById("screamer-img").src = REVEAL_IMAGE;
    overlay.classList.add("active");
    playJumpscareSound();
    setTimeout(() => overlay.classList.remove("active"), 650);
  } catch (e) {}

  setTimeout(() => showScreen("screen-level"), 180);
}

// ══════════════════════════════════════════
// Screen helpers
// ══════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function refreshStatsPanel() {
  const s = getStats();
  document.getElementById("stat-hs").textContent     = s.highScore     || 0;
  document.getElementById("stat-wins").textContent   = s.totalWins     || 0;
  document.getElementById("stat-streak").textContent = s.bestStreak    || 0;
  document.getElementById("stat-games").textContent  = s.totalGames    || 0;
}

// ══════════════════════════════════════════
// Start Game
// ══════════════════════════════════════════
async function startGame(level) {
  currentLevel  = level;
  gameOver      = false;
  sessionScore  = 0;

  hideResult();
  stopConfetti();
  showScreen("screen-game");
  try { startGameAmbient(); } catch (e) { console.error("startGameAmbient failed:", e); }

  // level pill
  const pill = document.getElementById("level-pill");
  pill.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  pill.className   = "level-pill " + level;

  updateScoreDisplay(0);
  updateStreakDisplay();

  try {
    const state = await apiNewGame(level);
    if (state.error) throw new Error(state.error);
    setBackground();
    render(state);
  } catch (e) {
    console.error("startGame failed to load a new word:", e);
    showLoadError(() => startGame(level));
  }
}

// Visible fallback so a failed request never leaves a silent blank screen.
function showLoadError(retry) {
  document.getElementById("clue-text").textContent = "Something went wrong loading the word.";
  document.getElementById("word-length").textContent = "";
  document.getElementById("word-display").innerHTML =
    `<button id="btn-retry-load" class="res-btn primary">Try Again</button>`;
  document.getElementById("btn-retry-load").addEventListener("click", retry);
}

// ══════════════════════════════════════════
// API
// ══════════════════════════════════════════
async function apiNewGame(level) {
  const r = await fetch("/api/new-game", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({level}),
  });
  return r.json();
}
async function apiGuess(letter) {
  const r = await fetch("/api/guess", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({letter}),
  });
  return r.json();
}

// ══════════════════════════════════════════
// Background image  (local images served by Flask)
// ══════════════════════════════════════════

function applyBg(screen, url) {
  screen.style.backgroundImage    = `url('${url}')`;
  screen.style.backgroundSize     = "cover";
  screen.style.backgroundPosition = "center";
}

// Always the same horror backdrop, regardless of the word's category —
// the game shouldn't look like a themed slideshow (nature/food/etc).
async function setBackground() {
  const screen = document.getElementById("screen-game");
  screen.style.backgroundImage = "linear-gradient(160deg,#0a0407,#1a0505)";
  try {
    const r = await fetch("/api/cat-image?cat=horrible");
    const { url } = await r.json();
    if (url) {
      await loadImgPromise(url);
      applyBg(screen, url);
    }
  } catch { /* keep gradient */ }
}

function loadImgPromise(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(src);
    img.onerror = rej;
    setTimeout(rej, 7000);
    img.src = src;
  });
}

// ── Fill the dashboard image mosaic ──────────
async function fillDashboard() {
  // Mosaic tiles — each gets a random image for its category
  document.querySelectorAll(".mosaic-tile").forEach(async tile => {
    const cat = tile.dataset.cat;
    try {
      const r = await fetch(`/api/cat-image?cat=${cat}`);
      const { url } = await r.json();
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        tile.style.backgroundImage = `url('${url}')`;
        tile.classList.add("loaded");
      };
      img.src = url;
    } catch { /* no image for this category yet */ }
  });

  // Level card image backgrounds — also random
  document.querySelectorAll(".lc-img-bg").forEach(async el => {
    const cats = (el.dataset.cats || "").split(",");
    const cat  = cats[Math.floor(Math.random() * cats.length)].trim();
    try {
      const r = await fetch(`/api/cat-image?cat=${cat}`);
      const { url } = await r.json();
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        el.style.backgroundImage = `url('${url}')`;
        el.classList.add("loaded");
      };
      img.src = url;
    } catch { /* no image yet */ }
  });
}

// ══════════════════════════════════════════
// Render state
// ══════════════════════════════════════════
function render(state) {
  renderGallows(state.wrong);
  renderLives(state.wrong, state.max_wrong);
  renderCategory(state.category);
  renderClue(state.clue, state.display.length);
  renderWord(state.display, state.won, state.lost);
  renderWrong(state.guessed, state.word || "");
  renderKeyboard(state.guessed, state.word || "", state.won || state.lost);

  if (state.won) {
    const pts = computeScore(state);
    sessionScore += pts;
    updateScoreDisplay(sessionScore);
    showScorePop("+" + pts);
    playSound("win");
    onWin(state.word, pts);
  } else if (state.lost) {
    playSound("lose");
    onLose(state.word);
  }
}

// ── Gallows ────────────────────────────────
function renderGallows(wrong) {
  BODY_PARTS.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("show", i < wrong);
  });
}

// ── Lives dots ─────────────────────────────
function renderLives(wrong, max) {
  const row = document.getElementById("lives-dots");
  row.innerHTML = "";
  const remaining = max - wrong;
  for (let i = 0; i < max; i++) {
    const d = document.createElement("div");
    d.className = "life-dot" + (i >= remaining ? " lost" : "");
    row.appendChild(d);
  }
}

// ── Category badge ─────────────────────────
function renderCategory(cat) {
  const meta = CAT_META[cat] || {emoji:"❓", color:"#aaa"};
  const badge = document.getElementById("cat-badge");
  document.getElementById("cat-emoji").textContent = meta.emoji;
  document.getElementById("cat-name").textContent  = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : "";
  badge.style.background = meta.color + "22";
  badge.style.border     = `1px solid ${meta.color}55`;
  badge.style.color      = meta.color;
}

// ── Clue ───────────────────────────────────
function renderClue(clue, len) {
  document.getElementById("clue-text").textContent   = clue || "—";
  document.getElementById("word-length").textContent = `(${len} letter${len !== 1 ? "s" : ""})`;
}

// ── Word ───────────────────────────────────
function renderWord(display, won, lost) {
  const wrap = document.getElementById("word-display");
  wrap.innerHTML = display.map((ch, i) => {
    const isBlank = ch === "_";
    let cls = "lb";
    if (!isBlank) cls += lost ? " miss" : " hit";
    const delay = i * 40;
    return `<div class="${cls}" style="animation-delay:${delay}ms">${isBlank ? "" : ch}</div>`;
  }).join("");
}

// ── Wrong chips ────────────────────────────
function renderWrong(guessed, word) {
  const wrong = guessed.filter(l => !word.includes(l));
  document.getElementById("wrong-chips").innerHTML =
    wrong.map(l => `<span class="wchip">${l}</span>`).join("");
}

// ── QWERTY keyboard ────────────────────────
function renderKeyboard(guessed, word, disabled) {
  const kb = document.getElementById("keyboard");
  kb.innerHTML = "";
  QWERTY_ROWS.forEach(row => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    [...row].forEach(letter => {
      const btn = document.createElement("button");
      btn.className   = "key possessed";
      
      // Runic characters mapping
      const runes = "᚛᚜ᚠᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
      const randomRune = runes[letter.charCodeAt(0) % runes.length];
      btn.innerHTML = `<span class="rune-text">${randomRune}</span>`;
      btn.dataset.letter = letter;

      // Reveal Latin letter and play whisper sound on hover
      btn.addEventListener("mouseenter", () => {
        if (!btn.disabled) {
          btn.innerHTML = letter.toUpperCase();
          playWhisperSFX();
        }
      });
      btn.addEventListener("mouseleave", () => {
        if (!btn.disabled && !guessed.includes(letter)) {
          btn.innerHTML = `<span class="rune-text">${randomRune}</span>`;
        }
      });

      if (guessed.includes(letter)) {
        btn.classList.add(word.includes(letter) ? "k-correct" : "k-wrong");
        btn.disabled = true;
        btn.innerHTML = letter.toUpperCase();
      } else if (disabled) {
        btn.disabled = true;
        btn.innerHTML = letter.toUpperCase();
      } else {
        btn.addEventListener("click", () => makeGuess(letter));
      }

      // Possessed movement: evade mouse if it comes close
      btn.addEventListener("mousemove", (e) => {
        if (btn.disabled) return;
        const rect = btn.getBoundingClientRect();
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const keyCenterX = rect.left + rect.width / 2;
        const keyCenterY = rect.top + rect.height / 2;
        const dx = keyCenterX - mouseX;
        const dy = keyCenterY - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 42) {
          const angle = Math.atan2(dy, dx);
          const pushDist = (42 - dist) * 0.8;
          const moveX = Math.cos(angle) * pushDist;
          const moveY = Math.sin(angle) * pushDist;
          btn.style.transform = `translate(${moveX}px, ${moveY}px) scale(1.06) rotate(${moveX * 0.5}deg)`;
        }
      });
      
      btn.addEventListener("mouseout", () => {
        if (btn.disabled) return;
        btn.style.transform = "none";
      });

      rowEl.appendChild(btn);
    });
    kb.appendChild(rowEl);
  });
}

// ── Wrong-guess screen effects ──────────────
function triggerWrongGuessEffects() {
  const screen = document.getElementById("screen-game");
  screen.classList.remove("screen-shake");
  void screen.offsetWidth; // restart animation
  screen.classList.add("screen-shake");

  const flash = document.createElement("div");
  flash.className = "red-flash";
  document.body.appendChild(flash);
  flash.addEventListener("animationend", () => flash.remove());

  playCrySFX();
}

// ── Guess ──────────────────────────────────
async function makeGuess(letter) {
  if (gameOver) return;
  const state = await apiGuess(letter);
  if (state.error) return;

  const wasCorrect = state.display.some(
    (ch, i) => ch !== "_" && !state.guessed.slice(0,-1).includes(ch)
  ) || (state.word && state.word.includes(letter));

  if (!wasCorrect) {
    triggerWrongGuessEffects();
  }

  playSound(state.word && !state.won && !state.lost
    ? (state.word.includes(letter) ? "correct" : "wrong")
    : (state.won ? "win" : "lose")
  );

  render(state);
}

// ══════════════════════════════════════════
// Scoring
// ══════════════════════════════════════════
function computeScore(state) {
  const correct   = state.display.filter(ch => ch !== "_").length;
  const remaining = state.max_wrong - state.wrong;
  const base      = correct * 10 + remaining * 15;
  const stats     = getStats();
  const streakBonus = stats.currentStreak * 10;
  return Math.round(base * DIFF_MULT[state.level]) + streakBonus;
}

function updateScoreDisplay(score) {
  document.getElementById("tb-score").textContent = score;
}

function updateStreakDisplay() {
  const s = getStats();
  document.getElementById("tb-streak").textContent = (s.currentStreak || 0) + "🔥";
}

// ── Floating score popup ───────────────────
function showScorePop(text) {
  const el = document.getElementById("score-pop");
  el.textContent = text;
  el.classList.remove("hidden");
  // position near score display
  const ref = document.getElementById("tb-score").getBoundingClientRect();
  el.style.left = ref.left + "px";
  el.style.top  = (ref.top - 10) + "px";
  // restart animation
  el.style.animation = "none";
  el.offsetHeight;
  el.style.animation = "";
  setTimeout(() => el.classList.add("hidden"), 1000);
}

// ══════════════════════════════════════════
// Win / Lose handlers
// ══════════════════════════════════════════
function onWin(word, pts) {
  gameOver = true;

  const stats = getStats();
  stats.totalGames++;
  stats.totalWins++;
  stats.currentStreak++;
  stats.bestStreak    = Math.max(stats.bestStreak, stats.currentStreak);
  stats.highScore     = Math.max(stats.highScore, sessionScore);
  saveStats(stats);

  updateStreakDisplay();
  launchConfetti();

  document.getElementById("res-icon").textContent  = "🎉";
  document.getElementById("res-title").textContent = "You got it!";
  document.getElementById("res-title").style.color = "var(--easy)";
  document.getElementById("res-word").innerHTML    = `The word was: <strong>${word}</strong>`;
  document.getElementById("res-score").textContent = `+${pts} points  ·  Total: ${sessionScore}`;
  document.getElementById("res-streak").textContent = stats.currentStreak > 1
    ? `🔥 ${stats.currentStreak} win streak!` : "";
  showResult();
}

function onLose(word) {
  gameOver = true;

  const stats = getStats();
  stats.totalGames++;
  stats.currentStreak = 0;
  saveStats(stats);

  updateStreakDisplay();

  document.getElementById("res-icon").textContent  = "💀";
  document.getElementById("res-title").textContent = "Game Over!";
  document.getElementById("res-title").style.color = "var(--hard)";
  document.getElementById("res-word").innerHTML    = `The word was: <strong>${word}</strong>`;
  document.getElementById("res-score").textContent = sessionScore > 0 ? `Score: ${sessionScore}` : "";
  document.getElementById("res-streak").textContent = "Streak reset 😔";
  showResult();
}

function showResult() {
  document.getElementById("result-overlay").classList.remove("hidden");
}
function hideResult() {
  document.getElementById("result-overlay").classList.add("hidden");
}

// ══════════════════════════════════════════
// Confetti
// ══════════════════════════════════════════
const cv  = document.getElementById("confetti-cv");
const ctx = cv.getContext("2d");

function launchConfetti() {
  cv.width  = window.innerWidth;
  cv.height = window.innerHeight;
  confettiPieces = Array.from({length:150}, () => ({
    x: Math.random() * cv.width,
    y: Math.random() * -cv.height * 0.5,
    w: 6 + Math.random() * 9,
    h: 10 + Math.random() * 12,
    color: `hsl(${Math.random()*360},90%,65%)`,
    rot: Math.random() * Math.PI * 2,
    rv:  (Math.random() - .5) * .13,
    vy:  2.5 + Math.random() * 3,
    vx:  (Math.random() - .5) * 2,
  }));
  animateConfetti();
}
function animateConfetti() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  confettiPieces = confettiPieces.filter(p => p.y < cv.height + 20);
  confettiPieces.forEach(p => {
    p.y += p.vy; p.x += p.vx; p.rot += p.rv;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
    ctx.restore();
  });
  if (confettiPieces.length) confettiRAF = requestAnimationFrame(animateConfetti);
  else ctx.clearRect(0, 0, cv.width, cv.height);
}
function stopConfetti() {
  if (confettiRAF) { cancelAnimationFrame(confettiRAF); confettiRAF = null; }
  ctx.clearRect(0, 0, cv.width, cv.height);
  confettiPieces = [];
}

// ══════════════════════════════════════════
// Event listeners
// ══════════════════════════════════════════

// Intro screen
document.getElementById("btn-enter").addEventListener("click", enterIntro);

// Level cards
document.querySelectorAll(".level-card").forEach(card => {
  card.addEventListener("click", () => startGame(card.dataset.level));
});

// Back to levels
document.getElementById("btn-back").addEventListener("click", () => goToLevelSelect());

// New game (same level)
document.getElementById("btn-new").addEventListener("click", () => startGame(currentLevel));

// Result buttons
document.getElementById("btn-play-again").addEventListener("click",    () => startGame(currentLevel));
document.getElementById("btn-change-level").addEventListener("click",  () => goToLevelSelect());

// Navigation always happens, even if any of the cleanup calls below throws.
function goToLevelSelect() {
  showScreen("screen-level");
  try { stopConfetti(); }      catch (e) { console.error(e); }
  try { stopGameAmbient(); }   catch (e) { console.error(e); }
  try { refreshStatsPanel(); } catch (e) { console.error(e); }
  try { fillDashboard(); }     catch (e) { console.error(e); }
}

// Physical keyboard
document.addEventListener("keydown", e => {
  if (e.key.length === 1 && /[a-zA-Z]/.test(e.key) && !gameOver) {
    makeGuess(e.key.toLowerCase());
  }
});

window.addEventListener("resize", () => {
  cv.width  = window.innerWidth;
  cv.height = window.innerHeight;
});

// ── Init ───────────────────────────────────
initStats();          // loads stats from MongoDB, then refreshes panel
fillDashboard();
initStarfield();
loadCardImages();
initIntroImages();

/* Load horrible images into each level card background */
async function loadCardImages() {
  try {
    const r = await fetch("/api/cat-images?cat=horrible&n=3");
    const { urls } = await r.json();
    if (!urls.length) return;
    document.querySelectorAll(".level-card").forEach((card, i) => {
      const url = urls[i] || urls[0];
      const img = new Image();
      img.onload = () => {
        card.style.backgroundImage    = `url('${url}')`;
        card.style.backgroundSize     = "cover";
        card.style.backgroundPosition = "center";
      };
      img.src = url;
    });
  } catch { /* no horrible images yet — plain dark cards */ }
}

/* ══════════════════════════════════════════
   LEVEL SELECT STARFIELD
══════════════════════════════════════════ */
function initStarfield() {
  const canvas = document.getElementById("ls-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const stars = Array.from({length: 160}, () => ({
    x:     Math.random(),
    y:     Math.random(),
    r:     Math.random() * 1.4 + 0.2,
    alpha: Math.random() * 0.6 + 0.15,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.8,
  }));

  // occasional shooting stars
  const shoots = [];

  function resize() {
    canvas.width  = canvas.offsetWidth  || window.innerWidth;
    canvas.height = canvas.offsetHeight || window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  function spawnShoot() {
    shoots.push({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height * 0.5,
      vx: 4 + Math.random() * 5,
      vy: 2 + Math.random() * 3,
      len: 80 + Math.random() * 80,
      alpha: 1,
    });
  }
  setInterval(spawnShoot, 3500);

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = Date.now() / 1000;

    // twinkling stars
    stars.forEach(s => {
      const a = s.alpha * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();
    });

    // shooting stars
    for (let i = shoots.length - 1; i >= 0; i--) {
      const sh = shoots[i];
      const grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 12, sh.y - sh.vy * 12);
      grad.addColorStop(0, `rgba(255,255,255,${sh.alpha})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * 12, sh.y - sh.vy * 12);
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 2;
      ctx.stroke();
      sh.x     += sh.vx;
      sh.y     += sh.vy;
      sh.alpha -= 0.025;
      if (sh.alpha <= 0 || sh.x > canvas.width || sh.y > canvas.height) shoots.splice(i, 1);
    }

    requestAnimationFrame(draw);
  }
  draw();
}
