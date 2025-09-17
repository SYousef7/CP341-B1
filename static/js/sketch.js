// ---- GLOBALS ----
let fires = [];
let particles = [];
let smokes = [];
let smoke = false;
let extinguished = 0;

let player;
let port;
let isConnected = false;
let fireLife = 0;
let firetick = 0;
let firetickspeed = 200; //tweak as necessary. smaller number = harder
                         //MUST BE EVEN
let scorched = false; 
let canex;

const LIFE_TICKS = {
  small:  6400*(firetickspeed/50),   // ~ lifespan for small fires
  medium: 3200*(firetickspeed/50),  // ~ lifespan for medium fires
  large:  1600*(firetickspeed/50),    // ~ lifespan for large fires
};

// micro:bit inputs (declare & init!)
let p0 = 0;  // digital 0/1 from P0
let p1 = 0;  // digital 0/1 from P1
let s  = 0;  // sound

let backgroundImage;

// ====== Custom Keyword Weather (Teachable Machine Audio) ======
let tmSpeech, tmReady = false;
let predLabel = '…', predConf = 0;
const TM_AUDIO_MODEL_URL = 'https://teachablemachine.withgoogle.com/models/VmfcP80Jk/';

// smoothing / debouncing helpers
let lastStable = '', stableSince = 0;
const HOLD_MS = 400;           // label must persist this long
const CONF_THRESHOLD = 0.85;   // min confidence to accept

const WEATHER = Object.freeze({
  NONE: 'none',
  DRIZZLE: 'drizzle',
  RAIN: 'rain',
  FLOOD: 'flood',
  DROUGHT: 'drought'
});

let weather = { state: WEATHER.NONE, fireSpreadMultiplier: 1.0, fuelMoisture: 1.0, waterLevel: 0 };

async function initCustomSpeech() {
  console.log("🎤 Initializing audio recognition...");
  
  try {
    // Request microphone permission first
    await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("✅ Microphone permission granted");
    
    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const options = {
      probabilityThreshold: 0.0,
      overlapFactor: 0.5
    };
    
    tmSpeech = ml5.soundClassifier(TM_AUDIO_MODEL_URL, options, modelLoaded);
    
  } catch (error) {
    console.error("❌ Error initializing audio:", error);
    console.log("🔧 Try clicking anywhere to enable audio, then press 'M' to start listening");
  }
}

function modelLoaded() {
  console.log("Model loaded successfully!");
  tmReady = true;
  tmSpeech.classify(onAudioPrediction);
}

function onAudioPrediction(err, results){
  if (err || !results?.[0]) return;
  
  predLabel = results[0].label.toLowerCase();
  predConf  = results[0].confidence || 0;
  
  // DEBUG: This line will show you everything the AI is hearing
  console.log(`Heard: "${predLabel}" with confidence: ${predConf.toFixed(2)}`);

  // Ignore low confidence
  if (predConf < CONF_THRESHOLD) return;

  // Ignore neutral/background
  if (predLabel.includes('neutral') || predLabel.includes('background')) return;

  // Debounce: require same label to persist for HOLD_MS
  const now = millis();
  if (predLabel !== lastStable){
    lastStable = predLabel;
    stableSince = now;
  } else if (now - stableSince >= HOLD_MS){
    console.log(`COMMAND TRIGGERED: ${predLabel}`); // DEBUG: Shows when commands actually trigger
    handleKeyword(predLabel);
    // reset so we don't spam the same action continuously
    lastStable = '';
    stableSince = now;
  }
}

function handleKeyword(label){
  // Map your TM labels → weather states
  if (label === 'drizzle')       setWeather(WEATHER.DRIZZLE);
  else if (label === 'rain')     setWeather(WEATHER.RAIN);
  else if (label === 'flood')    setWeather(WEATHER.FLOOD);
  else if (label === 'drought')  setWeather(WEATHER.DROUGHT);
  else if (label === 'stop' || label === 'neutral' || label === 'background')
    setWeather(WEATHER.NONE);
}

function setWeather(state){
  weather.state = state;
  weather.fireSpreadMultiplier = 1.0;
  weather.fuelMoisture = 1.0;

  switch(state){
    case WEATHER.DRIZZLE:
      weather.fireSpreadMultiplier = 0.9;
      weather.fuelMoisture = 1.1;
      weather.waterLevel = lerp(weather.waterLevel, 0.1, 0.5);
      flashBanner('🌦️ Drizzling');
      break;
    case WEATHER.RAIN:
      weather.fireSpreadMultiplier = 0.75;
      weather.fuelMoisture = 1.3;
      weather.waterLevel = lerp(weather.waterLevel, 0.25, 0.5);
      flashBanner('🌧️ Raining');
      break;
    case WEATHER.FLOOD:
      weather.fireSpreadMultiplier = 0.55;
      weather.fuelMoisture = 1.6;
      weather.waterLevel = lerp(weather.waterLevel, 0.55, 0.5);
      flashBanner('🌊 Flooding');
      break;
    case WEATHER.DROUGHT:
      weather.fireSpreadMultiplier = 1.4;
      weather.fuelMoisture = 0.75;
      weather.waterLevel = lerp(weather.waterLevel, 0.0, 0.5);
      flashBanner('☀️ Drought');
      break;
    default:
      weather.waterLevel = lerp(weather.waterLevel, 0.0, 0.5);
      flashBanner('⛅ Normal');
  }
}

// --- optional UI helpers (banner, overlays) same as before ---
let bannerText = '', bannerUntil = 0;
function flashBanner(t, ms=1100){ bannerText = t; bannerUntil = millis() + ms; }
function drawBanner(){
  if (millis() > bannerUntil) return;
  push(); noStroke(); fill(0,180); rect(10,10,width-20,44,8);
  fill(255); textAlign(CENTER,CENTER); textSize(18); text(bannerText, width/2, 32); pop();
}

function preload() {
  backgroundImage = loadImage('static/images/Background.jpg');
}

// ---- MICROBIT SERIAL CONNECTION ----
async function connect(){
  try{
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    isConnected = true;
    readUART();
  } catch (error){
    console.log(error);
  }
}

async function readUART(){
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true){
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on newlines
      let lines = buffer.split('\n');
      buffer = lines.pop(); // keep last partial line

      for (let line of lines){
        line = line.trim();
        if (line) parseData(line);
      }
    }
  } catch (e) {
    console.log(e);
  } finally {
    reader.releaseLock();
  }
}

// Expected line format: "p0,p1,s"
function parseData(data){
  const parts = data.split(',');
  if (parts.length >= 3){
    p0 = Number(parts[0]) | 0;
    p1 = Number(parts[1]) | 0;
    s  = Math.max(0, Number(parts[2]) || 0);
  }
}

// ---- P5.JS GAME ----
function setup() {
  const canvas = createCanvas(window.innerWidth, window.innerHeight);
  canvas.parent("p5host");

  player = createVector(width / 2, height / 2);

  // Initialize fires with random positions
  for (let i = 0; i < random(2,10); i++){
    fires.push({ 
      pos: createVector(random(50, window.innerWidth - 50), random(50, window.innerHeight - 50)), 
      size: 20, 
      type: "small", 
      smoke: false, 
      fireLife: 0, 
      ttl: LIFE_TICKS.small  
    });
  }
  for (let i = 0; i < random(2,10); i++){
    fires.push({ 
      pos: createVector(random(50, window.innerWidth - 50), random(50, window.innerHeight - 50)), 
      size: 40, 
      type: "medium", 
      smoke: false, 
      fireLife: 0, 
      ttl: LIFE_TICKS.medium 
    });
  }
  for (let i = 0; i < random(2,10); i++){
    fires.push({ 
      pos: createVector(random(50, window.innerWidth - 50), random(50, window.innerHeight - 50)), 
      size: 60, 
      type: "large", 
      smoke: false, 
      fireLife: 0, 
      ttl: LIFE_TICKS.large  
    });
  }

  textAlign(CENTER, CENTER);
  textSize(16);

  initCustomSpeech();
}

function draw() {
  background(backgroundImage);
  
  // Fires & extinguish check
  firetick = firetick + 1;
  if(firetick == firetickspeed){
    firetick = 0;
  }

  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i];
    
    if (f.type === "large") f.fireLife = (f.fireLife || 0) + 1;

    if (f.type == "scorched") {
      textSize(f.size);
      text("◼️", f.pos.x, f.pos.y);
    } else {
      // draw fire as emoji at its center
      textSize(f.size);
      text("🔥", f.pos.x, f.pos.y);
    }

    // Age only if it's still burning (not scorched)
    if (f.type !== "scorched") {
      f.ttl -= 1;
      // Burn-out: when time is up, the fire dies and becomes scorched land
      if (f.ttl <= 0) {
        f.type = "scorched";
        f.size = max(16, floor(f.size * 0.9));
      }
    }

    // collision radius tuned up for emoji
    const near = dist(player.x, player.y, f.pos.x, f.pos.y) <= f.size * 0.6;

    canex = canExtinguish(f.type);
    
    if(near && canex == "s"){ 
      fires.push({ 
        pos: createVector(random(f.pos.x-150, f.pos.x+150), random(f.pos.y-150, f.pos.y+150)), 
        size: 20, 
        type: "small",
        ttl: LIFE_TICKS.small
      });
    }
    else if (near && canex) {
      f.size = f.size - 1;
      //reclassify size or delete
      if(f.size < 20){
        fires.splice(i, 1);
        extinguished++;
      }
      else if(f.size < 40){
        f.type = "small";
      }
      else if(f.size < 60){
        f.type = "medium";
      }
    }

    const P0 = (p0 === 1);
    const P1 = (p1 === 1);
    const BLOW = (s > 200);

    // If the player is close enough to this fire, show effects
    if (near && f.type !== "scorched") {
      // heavy water: P0 + P1
      if (P0 && P1) {
        emitWaterOverFire(f, true);
      // light water: just P0
      } else if (P0) {
        emitWaterOverFire(f, false);
      }

      // breeze: blowing
      if (BLOW) {
        emitBreezeTowardFire(player, f);
      }
    }
    
    // random spreading
    if(f.type == "large" && firetick == 0) {
      fires.push({ 
        pos: createVector(random(f.pos.x-75, f.pos.x+75), random(f.pos.y-75, f.pos.y+75)), 
        size: 20, 
        type: "small", 
        ttl: LIFE_TICKS.small  
      });
    }

    //fire growth
    if(f.type != "large" && firetick == (firetickspeed/2)){ //make fire bigger
      f.size = f.size + 1;
    }
    if(f.size > 49){ //reclassify size
      f.type = "large";
    }
    else if(f.size > 34){
      f.type = "medium";
    }

    if (f.type == "large" && f.fireLife <= 5){
      smokes.push({ pos: createVector(f.pos.x, random(f.pos.y-15,f.pos.y-30)), size: 40});
      f.smoke = true;
    }
    else if (f.type == "large" && f.fireLife == 5){
      f.type = "scorched";
    }

    // Weather effect on fire tick (only calculate once per frame)
    if (i === fires.length - 1) {
      const baseTick = 200; // your normal baseline
      window.effectiveFireTick = baseTick / weather.fireSpreadMultiplier;
    }
  }

  clearSmoke();
  updateAndDrawParticles();
  drawBanner();

  // Player
  fill(30, 144, 255);
  ellipse(player.x, player.y, 25);

  // HUD
  const activeFires = fires.filter(f => f.type !== "scorched").length;
  fill(255);
  textSize(16);
  text(`Fires left: ${activeFires}`, width / 2, 20);
  
  // Debug HUD for inputs
  textSize(12);
  text(
    `micro:bit → P0:${p0}  P1:${p1}  S:${s}  ${isConnected ? '🟢 connected' : '🔴 not connected'}`,
    width / 2, height - 14
  );

  if (activeFires === 0) {
    fill(0, 150, 0);
    textSize(22);
    text("🔥 All fires extinguished! You win! 🌲", width / 2, height / 2);
  }
}

function emitWaterOverFire(fire, heavy=false) {
  // how many droplets per frame
  const count = heavy ? 3 : 1;

  for (let i = 0; i < count; i++) {
    // spawn slightly above the fire with a little horizontal spread
    const px = fire.pos.x + random(-fire.size*0.4, fire.size*0.4);
    const py = fire.pos.y - fire.size*0.6 + random(-4, 4);

    // water falls down with a tiny horizontal drift
    const vx = random(-0.4, 0.4);
    const vy = random(1.5, 3);

    particles.push({
      pos: createVector(px, py),
      vel: createVector(vx, vy),
      ttl: 40, // frames to live
      size: heavy ? max(16, fire.size*0.35) : max(14, fire.size*0.25),
      emoji: heavy ? "💦" : "💧"
    });
  }
}

function emitBreezeTowardFire(playerPos, fire) {
  // a few breeze "puffs" per frame
  for (let i = 0; i < 2; i++) {
    // start at/near the player
    const start = createVector(
      playerPos.x + random(-6, 6),
      playerPos.y + random(-6, 6)
    );
    // drift toward the fire
    const dir = p5.Vector.sub(fire.pos, start).normalize().mult(random(1.5, 2.2));

    particles.push({
      pos: start,
      vel: dir,
      ttl: 30,
      size: 18,
      emoji: "🌬️"
    });
  }
}

function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    // simple motion (+ a touch of gravity for water)
    if (p.emoji === "💧" || p.emoji === "💦") p.vel.y += 0.06;

    p.pos.add(p.vel);
    p.ttl -= 1;

    // draw
    noStroke();
    textSize(p.size);
    text(p.emoji, p.pos.x, p.pos.y);

    // cull when dead or off-screen
    if (p.ttl <= 0 || p.pos.x < -50 || p.pos.x > width+50 || p.pos.y < -50 || p.pos.y > height+50) {
      particles.splice(i, 1);
    }
  }
  for (let i = smokes.length - 1; i >= 0; i--) {
    const puff = smokes[i];
    textSize(puff.size);
    text("💨", puff.pos.x, puff.pos.y);
  }
}

// Define what actions can put out each fire size.
// Adjust to match what your micro:bit actually sends:
function canExtinguish(type) {
  // Treat P0/P1 as digital 0/1. S is an analog/accel value.
  const P0 = (p0 === 1);
  const P1 = (p1 === 1);
  const BLOW = (s > 200); // tweak as needed
  const x = random(0,100);

  if ((type === "large"  && x <= 50 && BLOW) || (type === "medium" && x <= 25 && BLOW)) return "s";
  if (type === "small")  return P0 || BLOW;            // spray or shake
  if (type === "medium") return P1 || (P0 && P1);       // bigger tool or combo
  if (type === "large")  return (P0 && P1);             // require both pressed
  return false;
}

function clearSmoke(){
  const BLOW = (s > 200); // reuse your global mic/analog value 's'
  for (let i = smokes.length - 1; i >= 0; i--) {
    const puff = smokes[i];
    const near = dist(player.x, player.y, puff.pos.x, puff.pos.y) <= puff.size * 0.6;
    if (near && BLOW) {
      smokes.splice(i, 1); // remove that puff
    }
  }
}

// ---- Fallback keyboard movement ----
function keyPressed() {
  const step = 15;
  if (keyCode === LEFT_ARROW)  player.x = max(0, player.x - step);
  if (keyCode === RIGHT_ARROW) player.x = min(width, player.x + step);
  if (keyCode === UP_ARROW)    player.y = max(0, player.y - step);
  if (keyCode === DOWN_ARROW)  player.y = min(height, player.y + step);

  // Optional keyboard simulators for testing without micro:bit:
  if (key === 'z' || key === 'Z') p0 = 1;   // hold to simulate P0
  if (key === 'x' || key === 'X') p1 = 1;   // hold to simulate P1
  if (key === 's' || key === 'S') s  = 250; // simulate shake/analog
}

function keyReleased(){
  if (key === 'z' || key === 'Z') p0 = 0;
  if (key === 'x' || key === 'X') p1 = 0;
  if (key === 's' || key === 'S') s  = 0;
}