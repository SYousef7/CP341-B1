// ---- GLOBALS ----
let fires = [];
let extinguished = 0;

let player;
let port;
let isConnected = false;

// micro:bit inputs (declare & init!)
let p0 = 0;  // digital 0/1 from P0
let p1 = 0;  // digital 0/1 from P1
let s  = 0;  // sound

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
        if (line) parseData(line); // <-- correct function name
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
    // force numbers & clamp to sane ranges
    p0 = Number(parts[0]) | 0;
    p1 = Number(parts[1]) | 0;
    s  = Math.max(0, Number(parts[2]) || 0);
  }
}

// ---- P5.JS GAME ----
function setup() {
  const canvas = createCanvas(600, 400);
  canvas.parent("p5host");

  player = createVector(width / 2, height / 2);

  // Fires: small, medium, large
  fires.push({ pos: createVector(random(50, width - 50), random(50, height - 50)), size: 20, type: "small"  });
  fires.push({ pos: createVector(random(50, width - 50), random(50, height - 50)), size: 35, type: "medium" });
  fires.push({ pos: createVector(random(50, width - 50), random(50, height - 50)), size: 50, type: "large"  });

  textAlign(CENTER, CENTER);
  textSize(16);
}

function draw() {
  background("#d4f1f4");

  // Map grid
  stroke(200);
  for (let x = 0; x < width; x += 40) line(x, 0, x, height);
  for (let y = 0; y < height; y += 40) line(0, y, width, y);
  noStroke();

  // Fires & extinguish check
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i];

    // draw fire as emoji at its center
    textSize(f.size);
    text("🔥", f.pos.x, f.pos.y);

    // collision radius tuned up for emoji
    const near = dist(player.x, player.y, f.pos.x, f.pos.y) < f.size * 0.6;

    if (near && canExtinguish(f.type)) {
      fires.splice(i, 1);
      extinguished++;
    }
  }

  // Player
  fill(30, 144, 255);
  ellipse(player.x, player.y, 25);

  // HUD
  fill(0);
  textSize(16);
  text(`Fires left: ${fires.length}`, width / 2, 20);

  // Debug HUD for inputs
  textSize(12);
  text(
    `micro:bit → P0:${p0}  P1:${p1}  S:${s}  ${isConnected ? '🟢 connected' : '🔴 not connected'}`,
    width / 2, height - 14
  );

  if (fires.length === 0) {
    fill(0, 150, 0);
    textSize(22);
    text("🔥 All fires extinguished! You win! 🌲", width / 2, height / 2);
  }
}

// Define what actions can put out each fire size.
// Adjust to match what your micro:bit actually sends:
function canExtinguish(type) {
  // Treat P0/P1 as digital 0/1. S is an analog/accel value.
  const P0 = (p0 === 1);
  const P1 = (p1 === 1);
  const SHOCK = (s > 200); // tweak as needed

  if (type === "small")  return P0 || SHOCK;            // spray or shake
  if (type === "medium") return P1 || (P0 && P1);       // bigger tool or combo
  if (type === "large")  return (P0 && P1);             // require both pressed
  return false;
}

// ---- Fallback keyboard movement ----
function keyPressed() {
  const step = 15;
  if (keyCode === LEFT_ARROW)  player.x = max(0, player.x - step);
  if (keyCode === RIGHT_ARROW) player.x = min(width, player.x + step);
  if (keyCode === UP_ARROW)    player.y = max(0, player.y - step);
  if (keyCode === DOWN_ARROW)  player.y = min(height, player.y + step);

  // Optional keyboard simulators for testing without micro:bit:
  if (key === 'Z') p0 = 1;   // hold to simulate P0
  if (key === 'X') p1 = 1;   // hold to simulate P1
  if (key === 'S') s  = 250; // simulate shake/analog
}
function keyReleased(){
  if (key === 'Z') p0 = 0;
  if (key === 'X') p1 = 0;
  if (key === 'S') s  = 0;
}
