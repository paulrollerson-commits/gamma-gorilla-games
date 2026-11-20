(() => {
  "use strict";

  const W = 480, H = 720;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  function layout() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * s) + "px";
    canvas.style.height = Math.floor(H * s) + "px";
  }
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", layout);
  layout();

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches && e.touches[0] ? e.touches[0] : e;
    return {
      x: (src.clientX - r.left) * (W / r.width),
      y: (src.clientY - r.top) * (H / r.height)
    };
  }

  const SFX = {
    ctx: null,
    muted: localStorage.getItem("skyparcel_mute") === "1",
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    toggle() {
      this.muted = !this.muted;
      localStorage.setItem("skyparcel_mute", this.muted ? "1" : "0");
      this.unlock();
    },
    env(node, t, dur, a, gain, startNode) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      node.connect(g);
      g.connect(this.ctx.destination);
      const s = startNode || node;
      s.start(t);
      s.stop(t + dur + 0.02);
    },
    beep(freq, dur, type, gain, slide) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
      this.env(o, t, dur, 0.012, gain || 0.07);
    },
    noise(dur, gain, freq) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(freq || 700, t);
      src.connect(f);
      this.env(f, t, dur, 0.006, gain || 0.08, src);
    },
    jump() { this.beep(430, 0.11, "square", 0.06, 1.85); },
    land() { this.noise(0.07, 0.05, 380); this.beep(150, 0.07, "sine", 0.04, 0.55); },
    spring() { this.beep(280, 0.2, "triangle", 0.08, 2.4); },
    collect() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      [660, 880, 1180].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        this.env(o, t + i * 0.045, 0.1, 0.005, 0.06);
      });
    },
    die() { this.beep(280, 0.45, "sawtooth", 0.09, 0.28); this.noise(0.28, 0.09, 550); },
    click() { this.beep(720, 0.05, "square", 0.035, 1.25); },
    start() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      [392, 523, 659].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        this.env(o, t + i * 0.07, 0.16, 0.01, 0.06);
      });
    }
  };

  const keys = Object.create(null);
  const hold = { left: false, right: false, jump: false };
  const pointers = new Map();

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyM") SFX.toggle();
    if (state === "title" && (e.code === "Space" || e.code === "Enter")) startGame();
    if (state === "over" && (e.code === "Space" || e.code === "Enter")) startGame();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function bindPointer() {
    const down = (e) => {
      SFX.unlock();
      const id = e.pointerId != null ? e.pointerId : 0;
      const p = canvasPos(e);
      pointers.set(id, p);
      onPointer(p, "down");
      e.preventDefault();
    };
    const move = (e) => {
      const id = e.pointerId != null ? e.pointerId : 0;
      if (!pointers.has(id) && e.buttons === 0) return;
      const p = canvasPos(e);
      pointers.set(id, p);
      e.preventDefault();
    };
    const up = (e) => {
      const id = e.pointerId != null ? e.pointerId : 0;
      const p = pointers.get(id) || canvasPos(e);
      pointers.delete(id);
      onPointer(p, "up");
      syncHolds();
      e.preventDefault();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  let hoverBtn = null;
  let pressedBtn = null;

  function hitBtn(p, b) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  function uiButtons() {
    const list = [];
    list.push({ id: "mute", x: W - 54, y: 14, w: 40, h: 40 });
    if (state === "title") {
      list.push({ id: "play", x: 140, y: 368, w: 200, h: 58 });
    } else if (state === "over") {
      list.push({ id: "retry", x: 140, y: 430, w: 200, h: 54 });
      list.push({ id: "title", x: 140, y: 498, w: 200, h: 46 });
    } else if (state === "play") {
      list.push({ id: "left", x: 18, y: H - 108, w: 86, h: 86 });
      list.push({ id: "jump", x: 197, y: H - 108, w: 86, h: 86 });
      list.push({ id: "right", x: 376, y: H - 108, w: 86, h: 86 });
    }
    return list;
  }

  function onPointer(p, phase) {
    const btns = uiButtons();
    let hit = null;
    for (const b of btns) if (hitBtn(p, b)) hit = b;
    if (phase === "down") {
      pressedBtn = hit ? hit.id : null;
      if (hit) {
        if (hit.id === "mute") { SFX.toggle(); SFX.click(); }
        if (hit.id === "play" || hit.id === "retry") startGame();
        if (hit.id === "title") { SFX.click(); state = "title"; }
        if (hit.id === "left") hold.left = true;
        if (hit.id === "right") hold.right = true;
        if (hit.id === "jump") { hold.jump = true; jumpBuf = 0.14; }
      } else if (state === "play") {
        jumpBuf = 0.14;
      } else if (state === "title") {
        startGame();
      } else if (state === "over") {
        startGame();
      }
    }
    if (phase === "up") {
      if (pressedBtn === "left") hold.left = false;
      if (pressedBtn === "right") hold.right = false;
      if (pressedBtn === "jump") hold.jump = false;
      pressedBtn = null;
    }
  }

  function syncHolds() {
    hold.left = hold.right = hold.jump = false;
    const btns = uiButtons();
    for (const p of pointers.values()) {
      for (const b of btns) {
        if (!hitBtn(p, b)) continue;
        if (b.id === "left") hold.left = true;
        if (b.id === "right") hold.right = true;
        if (b.id === "jump") hold.jump = true;
      }
    }
  }

  bindPointer();

  function wantLeft() { return keys.ArrowLeft || keys.KeyA || hold.left; }
  function wantRight() { return keys.ArrowRight || keys.KeyD || hold.right; }
  function wantJump() { return keys.ArrowUp || keys.KeyW || keys.Space || hold.jump; }

  let state = "title";
  let time = 0;
  let shake = 0;
  let flash = 0;
  let camX = 0;
  let scroll = 0;
  let score = 0;
  let best = Number(localStorage.getItem("skyparcel_best") || 0);
  let letters = 0;
  let newBest = false;
  let jumpBuf = 0;
  let coyote = 0;
  let jumpHeld = false;
  let deadTimer = 0;
  let genX = 0;
  let lastPlatY = 500;
  let seed = 1;

  const player = {
    x: 120, y: 500, vx: 0, vy: 0, w: 28, h: 38,
    facing: 1, onGround: false, prevY: 500,
    squash: 1, stretch: 1, scarf: 0, alive: true
  };

  let platforms = [];
  let items = [];
  let hazards = [];
  let parts = [];
  let floats = [];
  const clouds = [];

  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  function burst(x, y, color, n, spd, life, size, g) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spd * (0.25 + Math.random());
      parts.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life, max: life,
        color, size: size * (0.4 + Math.random()),
        g: g == null ? 400 : g
      });
    }
  }

  function floatText(x, y, text, color) {
    floats.push({ x, y, text, color: color || "#fff4c8", life: 0.8 });
  }

  function makeClouds() {
    clouds.length = 0;
    for (let i = 0; i < 10; i++) {
      clouds.push({
        x: Math.random() * 1400,
        y: 40 + Math.random() * 280,
        s: 0.4 + Math.random() * 0.8,
        w: 60 + Math.random() * 90
      });
    }
  }
  makeClouds();

  function addPlatform(x, y, w, type) {
    const p = { x, y, w, h: 18, type: type || "solid", life: 1, shake: 0, fallen: false, phase: Math.random() * 6, baseY: y, born: time };
    platforms.push(p);
    return p;
  }

  function resetWorld() {
    platforms = [];
    items = [];
    hazards = [];
    parts = [];
    floats = [];
    camX = 0;
    scroll = 120;
    score = 0;
    letters = 0;
    newBest = false;
    jumpBuf = 0;
    coyote = 0;
    deadTimer = 0;
    flash = 0;
    shake = 0;
    seed = (Date.now() % 199999) + 2;
    Object.assign(player, {
      x: 130, y: 500, vx: 0, vy: 0, facing: 1, onGround: true,
      prevY: 500, squash: 1, stretch: 1, alive: true
    });
    addPlatform(-20, 520, 300, "solid");
    items.push({ x: 230, y: 484, gold: false, taken: false, bob: 0.4 });
    lastPlatY = 520;
    genX = 280;
    fillWorld();
    makeClouds();
  }

  function fillWorld() {
    const horizon = camX + W + 520;
    while (genX < horizon) {
      const dist = genX;
      const hard = Math.min(1, dist / 6000);
      const gap = 70 + rand() * (50 + hard * 70);
      genX += gap;
      const pw = Math.max(64, 120 - hard * 40 + rand() * 50);
      let py = lastPlatY + (rand() * 2 - 1) * (70 + hard * 40);
      py = Math.max(260, Math.min(560, py));
      if (Math.abs(py - lastPlatY) > 130) py = lastPlatY + Math.sign(py - lastPlatY) * 130;
      let type = "solid";
      const r = rand();
      if (dist > 700 && r < 0.14) type = "spring";
      else if (dist > 500 && r < 0.28) type = "crumble";
      else if (dist > 900 && r < 0.4) type = "move";
      addPlatform(genX, py, pw, type);
      lastPlatY = py;
      if (rand() < 0.55) {
        const gold = rand() < 0.12;
        items.push({
          x: genX + pw * (0.3 + rand() * 0.4),
          y: py - 36,
          gold,
          taken: false,
          bob: rand() * 6
        });
      }
      if (dist > 800 && rand() < 0.22 + hard * 0.15) {
        hazards.push({
          x: genX + pw * 0.5 + (rand() - 0.5) * 80,
          y: py - 90 - rand() * 80,
          vx: -40 - rand() * 50,
          phase: rand() * 6,
          dead: false
        });
      }
      genX += pw;
    }
  }

  function startGame() {
    SFX.unlock();
    SFX.start();
    resetWorld();
    state = "play";
  }

  function die() {
    if (!player.alive) return;
    player.alive = false;
    state = "over";
    deadTimer = 0;
    SFX.die();
    shake = 14;
    flash = 0.45;
    burst(player.x, player.y - 18, "#7ed6c4", 22, 260, 0.7, 4, 200);
    burst(player.x, player.y - 18, "#f4d35e", 12, 200, 0.6, 3, 80);
    burst(player.x, player.y - 18, "#fff", 8, 140, 0.4, 2, 0);
    if (score > best) {
      best = score;
      newBest = true;
      localStorage.setItem("skyparcel_best", String(best));
    }
  }

  function tryJump() {
    if (!player.alive) return;
    if (coyote > 0 || player.onGround) {
      player.vy = -640;
      player.onGround = false;
      coyote = 0;
      jumpBuf = 0;
      jumpHeld = true;
      player.stretch = 1.28;
      player.squash = 0.82;
      SFX.jump();
      burst(player.x, player.y, "rgba(255,255,255,0.7)", 8, 90, 0.3, 2.2, 200);
    }
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 28);
    flash = Math.max(0, flash - dt * 1.6);
    jumpBuf = Math.max(0, jumpBuf - dt);
    coyote = Math.max(0, coyote - dt);

    if (wantJump()) {
      if (!jumpHeld) jumpBuf = 0.14;
      jumpHeld = true;
    } else {
      jumpHeld = false;
      if (player.vy < -180) player.vy *= 0.48;
    }
    if (jumpBuf > 0) tryJump();

    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += q.g * dt;
      if (q.life <= 0) parts.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].life -= dt;
      floats[i].y -= 40 * dt;
      if (floats[i].life <= 0) floats.splice(i, 1);
    }

    if (state !== "play" || !player.alive) {
      deadTimer += dt;
      return;
    }

    const hard = Math.min(1, camX / 6000);
    scroll = 120 + hard * 130;
    camX += scroll * dt;

    let ax = 0;
    if (wantLeft()) ax -= 1;
    if (wantRight()) ax += 1;
    if (ax) player.facing = ax;
    const target = ax * 230;
    player.vx += (target - player.vx) * Math.min(1, dt * 10);
    player.vy += 1850 * dt;
    if (player.vy > 900) player.vy = 900;

    player.prevY = player.y;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (player.x < camX + 28) {
      if (player.onGround) player.x = camX + 28;
      else if (player.x < camX - 8) die();
    }
    if (player.x > camX + W - 28) player.x = camX + W - 28;

    player.squash += (1 - player.squash) * Math.min(1, dt * 12);
    player.stretch += (1 - player.stretch) * Math.min(1, dt * 12);
    player.scarf += dt * (player.onGround ? 10 : 16);

    let grounded = false;
    let stand = null;
    for (const p of platforms) {
      if (p.fallen) continue;
      if (p.type === "move") p.y = p.baseY + Math.sin(time * 1.4 + p.phase) * 28;
      if (p.type === "crumble" && p.life < 1) {
        p.life -= dt * 1.4;
        p.shake = 3;
        if (p.life <= 0) {
          p.fallen = true;
          burst(p.x + p.w / 2, p.y, "#c4a574", 10, 120, 0.4, 3, 500);
        }
      }
      if (player.vy < -20) continue;
      const left = player.x - player.w * 0.45;
      const right = player.x + player.w * 0.45;
      if (right < p.x || left > p.x + p.w) continue;
      const feetPrev = player.prevY;
      const top = p.y;
      if (feetPrev <= top + 10 && player.y >= top && player.y <= top + 22 + Math.max(0, player.vy) * dt) {
        player.y = top;
        player.vy = 0;
        grounded = true;
        stand = p;
        if (!player.onGround) {
          player.squash = 0.72;
          player.stretch = 1.22;
          shake = Math.max(shake, Math.min(6, 2 + Math.abs(player.prevY - player.y) * 0.02));
          SFX.land();
          burst(player.x, player.y, "rgba(255,244,214,0.85)", 7, 80, 0.28, 2, 200);
          if (p.type === "spring") {
            player.vy = -860;
            player.y = top - 1;
            grounded = false;
            stand = null;
            player.stretch = 1.32;
            SFX.spring();
            burst(player.x, player.y, "#8ee3c2", 12, 140, 0.35, 2.5, 100);
          } else if (p.type === "crumble" && p.life === 1) {
            p.life = 0.99;
          }
        }
      }
    }
    if (grounded) {
      coyote = 0.11;
      player.onGround = true;
    } else {
      if (player.onGround) coyote = 0.11;
      player.onGround = false;
    }

    if (player.y > H + 40) die();

    for (const it of items) {
      if (it.taken) continue;
      const dy = Math.sin(time * 3 + it.bob) * 6;
      const dx = it.x - player.x;
      const ddy = (it.y + dy) - (player.y - 18);
      if (dx * dx + ddy * ddy < 30 * 30) {
        it.taken = true;
        const pts = it.gold ? 200 : 50;
        score += pts;
        letters += 1;
        SFX.collect();
        floatText(it.x, it.y, "+" + pts, it.gold ? "#ffd56a" : "#fff4c8");
        burst(it.x, it.y, it.gold ? "#ffd56a" : "#fff", 14, 160, 0.45, 2.6, 40);
      }
    }

    for (const h of hazards) {
      if (h.dead) continue;
      h.x += h.vx * dt;
      h.y += Math.sin(time * 2.4 + h.phase) * 18 * dt;
      const dx = h.x - player.x;
      const dy = h.y - (player.y - 20);
      if (dx * dx + dy * dy < 26 * 26) die();
    }

    const distScore = Math.floor(camX / 8);
    score = Math.max(score, distScore + letters * 50);
    fillWorld();

    if (platforms.length > 80) {
      platforms = platforms.filter((p) => p.x + p.w > camX - 80);
    }
    if (items.length > 60) items = items.filter((it) => !it.taken && it.x > camX - 40);
    if (hazards.length > 40) hazards = hazards.filter((h) => h.x > camX - 60);
  }

  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#7fc4e0");
    g.addColorStop(0.38, "#d8eef7");
    g.addColorStop(0.62, "#f8d9a6");
    g.addColorStop(1, "#e09a62");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const sunX = 370, sunY = 130;
    const sg = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 120);
    sg.addColorStop(0, "rgba(255,244,180,0.95)");
    sg.addColorStop(0.4, "rgba(255,186,100,0.35)");
    sg.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
    ctx.fill();

    const base = state === "title" ? time * 12 : camX;
    for (const c of clouds) {
      const x = ((c.x - base * (0.15 + c.s * 0.12)) % 1400 + 1400) % 1400 - 160;
      drawCloud(x, c.y, c.w, c.s);
    }

    ctx.fillStyle = "rgba(74, 102, 92, 0.45)";
    drawMounts(base * 0.12, 610, 0.55);
    ctx.fillStyle = "rgba(62, 90, 78, 0.7)";
    drawMounts(base * 0.22, 640, 0.8);
  }

  function drawMounts(off, y, s) {
    ctx.beginPath();
    ctx.moveTo(-40, H);
    for (let i = -1; i < 10; i++) {
      const x = i * 140 - (off % 140);
      ctx.lineTo(x, y - 40 * s - Math.abs(Math.sin(i * 1.7)) * 50 * s);
      ctx.lineTo(x + 70, y + 10 * s);
    }
    ctx.lineTo(W + 40, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawCloud(x, y, w, s) {
    ctx.save();
    ctx.globalAlpha = 0.55 + s * 0.25;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + w * 0.35, y - 8 * s, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + w * 0.7, y, 18 * s, 0, Math.PI * 2);
    ctx.arc(x + w * 0.4, y + 6 * s, 16 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlatform(p) {
    const sx = p.x - camX;
    if (sx + p.w < -20 || sx > W + 20) return;
    const born = Math.min(1, (time - p.born) * 6 || 1);
    const jx = p.shake ? (Math.random() - 0.5) * p.shake * 2 : 0;
    ctx.save();
    ctx.translate(sx + p.w / 2 + jx, p.y);
    ctx.scale(born, born);
    ctx.translate(-p.w / 2, 0);
    const col = p.type === "spring" ? "#5fbf9a" : p.type === "crumble" ? "#c9894a" : p.type === "move" ? "#6d8fd6" : "#c4a06a";
    const dark = p.type === "spring" ? "#3d8a6c" : p.type === "crumble" ? "#8a5528" : p.type === "move" ? "#3d5aa8" : "#8a6a3e";
    ctx.fillStyle = dark;
    rr(2, 4, p.w, p.h, 5);
    ctx.fill();
    ctx.fillStyle = col;
    rr(0, 0, p.w, p.h, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    rr(6, 2, p.w - 12, 5, 3);
    ctx.fill();
    if (p.type === "spring") {
      ctx.strokeStyle = "#e8ffe8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.w * 0.25, 8);
      for (let i = 0; i < 5; i++) ctx.lineTo(p.w * (0.25 + i * 0.1), 8 + (i % 2 ? 6 : 0));
      ctx.stroke();
    }
    if (p.type === "crumble") {
      ctx.strokeStyle = "rgba(80,40,10,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10, 4);
      ctx.lineTo(18, 14);
      ctx.moveTo(p.w - 16, 3);
      ctx.lineTo(p.w - 8, 15);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(8, p.h, 4, 8);
    ctx.fillRect(p.w - 12, p.h, 4, 8);
    ctx.restore();
  }

  function drawCourier(x, y, t, face, squash, stretch, idle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(face, 1);
    ctx.scale(squash, stretch);
    const walk = idle ? Math.sin(t * 3) * 1.2 : (player.onGround ? Math.sin(t * 14) * 5 : 2);
    const flap = Math.sin(t * (player.onGround && !idle ? 10 : 7)) * 6;
    ctx.strokeStyle = "#e76f51";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-4, -24);
    ctx.quadraticCurveTo(-14 - flap, -20, -20 - flap, -12);
    ctx.stroke();
    ctx.fillStyle = "#2a9d8f";
    rr(-13, -28, 26, 22, 8);
    ctx.fill();
    ctx.fillStyle = "#7b4b2a";
    rr(6, -22, 12, 14, 3);
    ctx.fill();
    ctx.fillStyle = "#f1d3b0";
    ctx.beginPath();
    ctx.arc(0, -36, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1d3557";
    rr(-12, -48, 24, 12, 4);
    ctx.fill();
    ctx.fillRect(-12, -42, 24, 5);
    ctx.fillStyle = "#e76f51";
    ctx.fillRect(-4, -48, 16, 5);
    ctx.fillStyle = "#1d3557";
    ctx.beginPath();
    ctx.arc(4, -37, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#245a88";
    rr(-11, -8, 8, 12 + walk, 3);
    ctx.fill();
    rr(3, -8, 8, 12 - walk, 3);
    ctx.fill();
    ctx.fillStyle = "#1d3557";
    rr(-12, 2 + walk, 10, 6, 2);
    ctx.fill();
    rr(2, 2 - walk, 10, 6, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLetter(it) {
    const sx = it.x - camX;
    if (sx < -20 || sx > W + 20) return;
    const bob = Math.sin(time * 3 + it.bob) * 6;
    ctx.save();
    ctx.translate(sx, it.y + bob);
    ctx.rotate(Math.sin(time * 2 + it.bob) * 0.1);
    ctx.fillStyle = it.gold ? "#f4d35e" : "#f7f1e3";
    rr(-11, -8, 22, 16, 2);
    ctx.fill();
    ctx.strokeStyle = it.gold ? "#c9a227" : "#d4c4a8";
    ctx.lineWidth = 1.2;
    rr(-11, -8, 22, 16, 2);
    ctx.stroke();
    ctx.strokeStyle = it.gold ? "#c9a227" : "#e07a5f";
    ctx.beginPath();
    ctx.moveTo(-11, -8);
    ctx.lineTo(0, 2);
    ctx.lineTo(11, -8);
    ctx.stroke();
    if (it.gold) {
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      ctx.arc(0, 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBird(h) {
    const sx = h.x - camX;
    if (sx < -30 || sx > W + 30) return;
    const wing = Math.sin(time * 10 + h.phase) * 10;
    ctx.save();
    ctx.translate(sx, h.y);
    ctx.fillStyle = "#2f2a28";
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.quadraticCurveTo(0, -16 - wing, 10, 0);
    ctx.quadraticCurveTo(0, -4, -4, 0);
    ctx.fill();
    ctx.fillStyle = "#e76f51";
    ctx.beginPath();
    ctx.moveTo(12, -1);
    ctx.lineTo(18, 1);
    ctx.lineTo(12, 3);
    ctx.fill();
    ctx.restore();
  }

  function drawBtn(x, y, w, h, label, primary, id) {
    const over = hoverBtn === id || pressedBtn === id;
    const k = over ? 0.97 : 1;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(k, k);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = "rgba(29, 24, 36, 0.25)";
    rr(3, 6, w, h, 14);
    ctx.fill();
    ctx.fillStyle = primary ? "#2a9d8f" : "rgba(255,255,255,0.16)";
    rr(0, 0, w, h, 14);
    ctx.fill();
    if (primary) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      rr(8, 4, w - 16, 14, 8);
      ctx.fill();
    }
    ctx.fillStyle = primary ? "#f8fff8" : "#f4f0ea";
    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, w / 2, h / 2 + 1);
    ctx.restore();
  }

  function drawMute(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(20,16,24,0.82)";
    rr(0, 0, 40, 40, 10);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(11, 14);
    ctx.lineTo(17, 14);
    ctx.lineTo(24, 9);
    ctx.lineTo(24, 31);
    ctx.lineTo(17, 26);
    ctx.lineTo(11, 26);
    ctx.closePath();
    ctx.fill();
    if (SFX.muted) {
      ctx.strokeStyle = "#e76f51";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(12, 12);
      ctx.lineTo(30, 30);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(24, 20, 7, -0.7, 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPad(b, glyph) {
    const down = (b.id === "left" && hold.left) || (b.id === "right" && hold.right) || (b.id === "jump" && (hold.jump || wantJump()));
    ctx.save();
    ctx.globalAlpha = down ? 0.85 : 0.45;
    ctx.fillStyle = down ? "#2a9d8f" : "rgba(20,16,28,0.55)";
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 22px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.restore();
  }

  function drawHUD() {
    ctx.fillStyle = "rgba(20,16,24,0.82)";
    rr(14, 14, 150, 44, 10);
    ctx.fill();
    ctx.fillStyle = "#fff8e8";
    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(score), 26, 36);
    ctx.font = "600 11px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(255,248,232,0.7)";
    ctx.fillText("SCORE", 26, 22);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(20,16,24,0.82)";
    rr(W - 210, 14, 148, 44, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(255,248,232,0.7)";
    ctx.font = "600 11px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("BEST", W - 70, 22);
    ctx.fillStyle = "#fff8e8";
    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(best), W - 70, 36);
    drawMute(W - 54, 16);
  }

  function drawTitle() {
    ctx.fillStyle = "rgba(20,16,28,0.18)";
    rr(50, 118, 380, 214, 18);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(29,53,87,0.55)";
    ctx.font = "800 58px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("SKY PARCEL", W / 2, 196);
    ctx.fillStyle = "#1d3557";
    ctx.fillText("SKY PARCEL", W / 2, 190);
    ctx.fillStyle = "#9a3b2f";
    ctx.font = "600 16px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Deliver the mail. Don't look down.", W / 2, 228);
    ctx.fillStyle = "rgba(29,53,87,0.85)";
    ctx.font = "600 15px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(best ? "Best  " + best : "A new route opens", W / 2, 258);
    drawBtn(140, 368, 200, 58, "PLAY", true, "play");
    ctx.fillStyle = "rgba(29,53,87,0.8)";
    ctx.font = "600 13px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Arrows / WASD to move   •   Space or tap to jump", W / 2, 454);
    ctx.fillText("On-screen pads on mobile   •   M to mute", W / 2, 476);
    ctx.fillStyle = "rgba(29,53,87,0.55)";
    ctx.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Made by Gamma Gorilla Productions", W / 2, H - 28);
    drawMute(W - 54, 16);
    const dockY = 560;
    ctx.save();
    ctx.translate(-camX, 0);
    // decorative dock in screen space
    ctx.restore();
    ctx.fillStyle = "#8a6a3e";
    rr(140, dockY, 200, 18, 5);
    ctx.fill();
    ctx.fillStyle = "#c4a06a";
    rr(138, dockY - 4, 200, 18, 5);
    ctx.fill();
    drawCourier(W / 2, dockY - 4, time, 1, 1, 1, true);
  }

  function drawOver() {
    ctx.fillStyle = "rgba(18, 12, 20, 0.55)";
    ctx.fillRect(0, 0, W, H);
    const slide = Math.min(1, deadTimer * 3);
    const yoff = (1 - slide) * 40;
    ctx.save();
    ctx.globalAlpha = slide;
    ctx.translate(0, yoff);
    ctx.fillStyle = "rgba(28, 20, 32, 0.92)";
    rr(60, 180, 360, 390, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    rr(60, 180, 360, 390, 20);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#f4d35e";
    ctx.font = "800 32px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("PARCEL LOST", W / 2, 236);
    ctx.fillStyle = "#f4f0ea";
    ctx.font = "700 48px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(score), W / 2, 300);
    ctx.font = "600 14px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(244,240,234,0.7)";
    ctx.fillText(newBest ? "NEW BEST SCORE" : "Best  " + best, W / 2, 332);
    ctx.fillText("Letters  " + letters, W / 2, 358);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = slide;
    ctx.translate(0, yoff);
    drawBtn(140, 430, 200, 54, "TRY AGAIN", true, "retry");
    drawBtn(140, 498, 200, 46, "TITLE", false, "title");
    ctx.fillStyle = "rgba(244,240,234,0.45)";
    ctx.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Made by Gamma Gorilla Productions", W / 2, 548);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ox = (Math.random() - 0.5) * shake;
    const oy = (Math.random() - 0.5) * shake;
    ctx.translate(ox, oy);
    const cam = state === "title" ? 0 : camX;
    const savedCam = camX;
    camX = cam;

    drawSky();

    if (state !== "title") {
      for (const p of platforms) drawPlatform(p);
      for (const it of items) if (!it.taken) drawLetter(it);
      for (const h of hazards) if (!h.dead) drawBird(h);
    }

    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x - camX, q.y, q.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, f.life / 0.8);
      ctx.fillStyle = f.color;
      ctx.font = "700 16px Trebuchet MS, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x - camX, f.y);
    }
    ctx.globalAlpha = 1;

    if (state === "title") {
      drawTitle();
    } else {
      if (player.alive || deadTimer < 0.35) {
        const fade = player.alive ? 1 : Math.max(0, 1 - deadTimer * 3);
        ctx.globalAlpha = fade;
        drawCourier(player.x - camX, player.y, time, player.facing, player.squash, player.stretch, false);
        ctx.globalAlpha = 1;
      }
      drawHUD();
      if (state === "play") {
        const pads = uiButtons().filter((b) => b.id === "left" || b.id === "right" || b.id === "jump");
        const labels = { left: "◀", right: "▶", jump: "▲" };
        for (const b of pads) drawPad(b, labels[b.id]);
      }
      if (state === "over") drawOver();
    }

    if (flash > 0) {
      ctx.fillStyle = "rgba(255,255,255," + (flash * 0.6) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    camX = savedCam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function trackHover() {
    hoverBtn = null;
    if (!pointers.size) return;
    const p = [...pointers.values()][0];
    for (const b of uiButtons()) if (hitBtn(p, b)) hoverBtn = b.id;
  }

  let last = 0;
  function loop(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;
    trackHover();
    if (state === "play") syncHolds();
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__DEBUG = () => ({ state, score, best, letters, camX: Math.round(camX), alive: player.alive });
})();
