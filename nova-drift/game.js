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
    muted: localStorage.getItem("novadrift_mute") === "1",
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    toggle() {
      this.muted = !this.muted;
      localStorage.setItem("novadrift_mute", this.muted ? "1" : "0");
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
      this.env(o, t, dur, 0.01, gain || 0.06);
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
      f.type = "bandpass";
      f.frequency.setValueAtTime(freq || 900, t);
      src.connect(f);
      this.env(f, t, dur, 0.004, gain || 0.07, src);
    },
    shoot() { this.beep(680, 0.05, "square", 0.035, 0.5); this.noise(0.04, 0.03, 1800); },
    explode() { this.noise(0.18, 0.1, 500); this.beep(180, 0.2, "sawtooth", 0.06, 0.4); },
    collect() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      [740, 980].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        this.env(o, t + i * 0.05, 0.1, 0.005, 0.06);
      });
    },
    die() { this.beep(240, 0.5, "sawtooth", 0.1, 0.22); this.noise(0.4, 0.12, 400); },
    click() { this.beep(720, 0.05, "square", 0.03, 1.2); },
    start() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      [330, 440, 660].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        this.env(o, t + i * 0.08, 0.18, 0.01, 0.06);
      });
    },
    hit() { this.beep(520, 0.06, "square", 0.04, 0.6); }
  };

  const keys = Object.create(null);
  const pointers = new Map();
  let moveStick = null;
  let firingTouch = false;
  let hoverBtn = null;
  let pressedBtn = null;

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyM") SFX.toggle();
    if (state === "title" && (e.code === "Space" || e.code === "Enter")) startGame();
    if (state === "over" && (e.code === "Space" || e.code === "Enter")) startGame();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function hitBtn(p, b) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  function uiButtons() {
    const list = [{ id: "mute", x: W - 54, y: 14, w: 40, h: 40 }];
    if (state === "title") list.push({ id: "play", x: 140, y: 378, w: 200, h: 58 });
    if (state === "over") {
      list.push({ id: "retry", x: 140, y: 430, w: 200, h: 54 });
      list.push({ id: "title", x: 140, y: 498, w: 200, h: 46 });
    }
    return list;
  }

  function onPointer(p, phase, id) {
    const btns = uiButtons();
    let hit = null;
    for (const b of btns) if (hitBtn(p, b)) hit = b;
    if (phase === "down") {
      pressedBtn = hit ? hit.id : null;
      if (hit) {
        if (hit.id === "mute") { SFX.toggle(); SFX.click(); }
        if (hit.id === "play" || hit.id === "retry") startGame();
        if (hit.id === "title") { SFX.click(); state = "title"; }
        return;
      }
      if (state === "title" || state === "over") { startGame(); return; }
      if (state === "play") {
        if (p.x < W * 0.55) {
          moveStick = { id, ox: p.x, oy: p.y, x: p.x, y: p.y };
        } else {
          firingTouch = true;
        }
      }
    }
    if (phase === "move" && moveStick && moveStick.id === id) {
      moveStick.x = p.x;
      moveStick.y = p.y;
    }
    if (phase === "up") {
      if (moveStick && moveStick.id === id) moveStick = null;
      if (!moveStick) firingTouch = false;
      pressedBtn = null;
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    SFX.unlock();
    const id = e.pointerId != null ? e.pointerId : 0;
    const p = canvasPos(e);
    pointers.set(id, p);
    onPointer(p, "down", id);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    const id = e.pointerId != null ? e.pointerId : 0;
    const p = canvasPos(e);
    pointers.set(id, p);
    onPointer(p, "move", id);
    e.preventDefault();
  });
  function up(e) {
    const id = e.pointerId != null ? e.pointerId : 0;
    const p = pointers.get(id) || canvasPos(e);
    pointers.delete(id);
    onPointer(p, "up", id);
    e.preventDefault();
  }
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function axis() {
    let x = 0, y = 0;
    if (keys.ArrowLeft || keys.KeyA) x -= 1;
    if (keys.ArrowRight || keys.KeyD) x += 1;
    if (keys.ArrowUp || keys.KeyW) y -= 1;
    if (keys.ArrowDown || keys.KeyS) y += 1;
    if (moveStick) {
      const dx = moveStick.x - moveStick.ox;
      const dy = moveStick.y - moveStick.oy;
      const m = Math.hypot(dx, dy);
      if (m > 8) {
        const n = Math.min(1, m / 46);
        x += (dx / m) * n;
        y += (dy / m) * n;
      }
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  let state = "title";
  let time = 0;
  let shake = 0;
  let flash = 0;
  let score = 0;
  let best = Number(localStorage.getItem("novadrift_best") || 0);
  let newBest = false;
  let cores = 0;
  let deadTimer = 0;
  let fireCd = 0;
  let spawnCd = 0;
  let droneCd = 0;
  let wave = 0;

  const ship = { x: W / 2, y: H * 0.72, vx: 0, vy: 0, r: 14, alive: true, inv: 0, angle: -Math.PI / 2, glow: 0 };
  let rocks = [];
  let drones = [];
  let bullets = [];
  let pickups = [];
  let parts = [];
  let floats = [];
  const stars = [];

  function makeStars() {
    stars.length = 0;
    for (let i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.3 + Math.random() * 1.4,
        s: 0.6 + Math.random() * 1.6
      });
    }
  }
  makeStars();

  function burst(x, y, color, n, spd, life, size, g) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spd * (0.25 + Math.random());
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, max: life, color, size: size * (0.4 + Math.random()),
        g: g == null ? 0 : g
      });
    }
  }

  function floatText(x, y, text, color) {
    floats.push({ x, y, text, color: color || "#b8f4ff", life: 0.75 });
  }

  function poly(r, n, jitter, seed) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + Math.sin(seed * 9 + i * 3) * jitter;
      pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
    }
    return pts;
  }

  function resetWorld() {
    rocks = [];
    drones = [];
    bullets = [];
    pickups = [];
    parts = [];
    floats = [];
    score = 0;
    cores = 0;
    newBest = false;
    fireCd = 0;
    spawnCd = 0.4;
    droneCd = 6;
    wave = 0;
    shake = 0;
    flash = 0;
    deadTimer = 0;
    moveStick = null;
    Object.assign(ship, { x: W / 2, y: H * 0.72, vx: 0, vy: 0, alive: true, inv: 1.6, angle: -Math.PI / 2, glow: 0 });
    makeStars();
    for (let i = 0; i < 4; i++) spawnRock(true);
  }

  function startGame() {
    SFX.unlock();
    SFX.start();
    resetWorld();
    state = "play";
  }

  function die() {
    if (!ship.alive) return;
    ship.alive = false;
    state = "over";
    deadTimer = 0;
    SFX.die();
    shake = 16;
    flash = 0.5;
    burst(ship.x, ship.y, "#7ee0ff", 28, 280, 0.8, 3.5, 20);
    burst(ship.x, ship.y, "#ff7ad9", 16, 220, 0.7, 3, 10);
    burst(ship.x, ship.y, "#fff", 10, 160, 0.45, 2, 0);
    if (score > best) {
      best = score;
      newBest = true;
      localStorage.setItem("novadrift_best", String(best));
    }
  }

  function spawnRock(offscreen) {
    const big = Math.random() < 0.35;
    const r = big ? 28 + Math.random() * 16 : 14 + Math.random() * 10;
    const x = 30 + Math.random() * (W - 60);
    const y = offscreen ? -20 - Math.random() * 80 : -30;
    const spd = (40 + Math.random() * 50 + wave * 8) * (big ? 0.75 : 1.15);
    rocks.push({
      x, y, r,
      vx: (Math.random() - 0.5) * 40,
      vy: spd,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 2.2,
      hp: big ? 3 : 1,
      max: big ? 3 : 1,
      pts: poly(r, 7 + (big ? 2 : 0), 0.22, Math.random() * 20),
      tint: big ? "#8aa0c8" : "#9bb6c9"
    });
  }

  function splitRock(rk) {
    if (rk.r < 18) return;
    for (let i = 0; i < 2; i++) {
      const r = rk.r * 0.55;
      rocks.push({
        x: rk.x + (i ? 8 : -8),
        y: rk.y,
        r,
        vx: rk.vx + (i ? 50 : -50),
        vy: rk.vy * 0.8 + (Math.random() - 0.5) * 40,
        rot: 0,
        vr: (Math.random() - 0.5) * 3,
        hp: 1,
        max: 1,
        pts: poly(r, 6, 0.25, Math.random() * 20),
        tint: "#b7c9d8"
      });
    }
  }

  function spawnDrone() {
    const side = Math.random() < 0.5 ? 30 : W - 30;
    drones.push({
      x: side,
      y: 40 + Math.random() * 160,
      vx: 0, vy: 0,
      r: 14,
      hp: 2,
      t: 0
    });
  }

  function shoot() {
    if (fireCd > 0 || !ship.alive) return;
    fireCd = 0.16;
    const a = ship.angle;
    bullets.push({
      x: ship.x + Math.cos(a) * 16,
      y: ship.y + Math.sin(a) * 16,
      vx: Math.cos(a) * 520,
      vy: Math.sin(a) * 520,
      life: 0.9
    });
    SFX.shoot();
    ship.glow = 1;
    burst(ship.x + Math.cos(a) * 12, ship.y + Math.sin(a) * 12, "#7ee0ff", 3, 40, 0.15, 1.4, 0);
  }

  function popRock(rk, pts) {
    SFX.explode();
    shake = Math.max(shake, rk.r > 20 ? 7 : 4);
    burst(rk.x, rk.y, rk.tint, 16, 180, 0.45, 2.8, 30);
    burst(rk.x, rk.y, "#7ee0ff", 8, 140, 0.3, 2, 0);
    score += pts;
    floatText(rk.x, rk.y, "+" + pts);
    if (Math.random() < 0.22) {
      pickups.push({ x: rk.x, y: rk.y, vy: 30, bob: Math.random() * 5, taken: false });
    }
    splitRock(rk);
    rk.hp = 0;
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 28);
    flash = Math.max(0, flash - dt * 1.5);
    ship.glow = Math.max(0, ship.glow - dt * 6);
    ship.inv = Math.max(0, ship.inv - dt);

    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += (q.g || 0) * dt;
      if (q.life <= 0) parts.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].life -= dt;
      floats[i].y -= 36 * dt;
      if (floats[i].life <= 0) floats.splice(i, 1);
    }

    if (state === "title") {
      ship.x = W / 2 + Math.sin(time * 0.8) * 8;
      ship.y = 560 + Math.sin(time * 1.4) * 6;
      ship.angle = -Math.PI / 2 + Math.sin(time) * 0.08;
      if (Math.random() < 0.3) {
        burst(ship.x, ship.y + 16, "rgba(80,200,255,0.5)", 1, 20, 0.4, 1.5, 40);
      }
      return;
    }

    if (state !== "play" || !ship.alive) {
      deadTimer += dt;
      return;
    }

    wave = Math.floor(score / 400);
    const a = axis();
    const spd = 260;
    ship.vx += (a.x * spd - ship.vx) * Math.min(1, dt * 8);
    ship.vy += (a.y * spd - ship.vy) * Math.min(1, dt * 8);
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    ship.x = Math.max(18, Math.min(W - 18, ship.x));
    ship.y = Math.max(80, Math.min(H - 120, ship.y));
    if (a.x || a.y) ship.angle = Math.atan2(a.y, a.x);
    else ship.angle += ((-Math.PI / 2) - ship.angle) * Math.min(1, dt * 4);

    if (a.x || a.y) {
      burst(ship.x - Math.cos(ship.angle) * 10, ship.y - Math.sin(ship.angle) * 10, "rgba(126,224,255,0.7)", 1, 30, 0.25, 1.6, 0);
    }

    fireCd -= dt;
    if (keys.Space || firingTouch || true) shoot();

    spawnCd -= dt;
    const rate = Math.max(0.28, 0.9 - wave * 0.08);
    if (spawnCd <= 0) {
      spawnRock(true);
      spawnCd = rate;
    }
    droneCd -= dt;
    if (droneCd <= 0 && wave >= 1) {
      spawnDrone();
      droneCd = Math.max(3.2, 7 - wave * 0.5);
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < -10 || b.x < -10 || b.x > W + 10) {
        bullets.splice(i, 1);
        continue;
      }
      let hit = false;
      for (const rk of rocks) {
        if (rk.hp <= 0) continue;
        const dx = rk.x - b.x, dy = rk.y - b.y;
        if (dx * dx + dy * dy < (rk.r + 3) * (rk.r + 3)) {
          rk.hp -= 1;
          hit = true;
          burst(b.x, b.y, "#7ee0ff", 5, 80, 0.2, 1.6, 0);
          SFX.hit();
          if (rk.hp <= 0) popRock(rk, rk.max > 1 ? 80 : 40);
          break;
        }
      }
      if (!hit) {
        for (const d of drones) {
          if (d.hp <= 0) continue;
          const dx = d.x - b.x, dy = d.y - b.y;
          if (dx * dx + dy * dy < (d.r + 3) * (d.r + 3)) {
            d.hp -= 1;
            hit = true;
            burst(b.x, b.y, "#ff7ad9", 6, 90, 0.22, 1.8, 0);
            SFX.hit();
            if (d.hp <= 0) {
              d.hp = 0;
              SFX.explode();
              score += 150;
              cores += 1;
              floatText(d.x, d.y, "+150", "#ff7ad9");
              burst(d.x, d.y, "#ff7ad9", 18, 200, 0.45, 2.6, 0);
              pickups.push({ x: d.x, y: d.y, vy: 20, bob: 0, taken: false });
            }
            break;
          }
        }
      }
      if (hit) bullets.splice(i, 1);
    }

    for (const rk of rocks) {
      if (rk.hp <= 0) continue;
      rk.x += rk.vx * dt;
      rk.y += rk.vy * dt;
      rk.rot += rk.vr * dt;
      if (rk.x < rk.r) { rk.x = rk.r; rk.vx *= -1; }
      if (rk.x > W - rk.r) { rk.x = W - rk.r; rk.vx *= -1; }
      if (ship.alive && ship.inv <= 0) {
        const dx = rk.x - ship.x, dy = rk.y - ship.y;
        if (dx * dx + dy * dy < (rk.r + ship.r - 2) * (rk.r + ship.r - 2)) die();
      }
    }
    rocks = rocks.filter((rk) => rk.hp > 0 && rk.y < H + 50);

    for (const d of drones) {
      if (d.hp <= 0) continue;
      d.t += dt;
      const dx = ship.x - d.x, dy = ship.y - d.y;
      const m = Math.hypot(dx, dy) || 1;
      d.vx += (dx / m * 90 - d.vx) * dt * 2;
      d.vy += (dy / m * 90 - d.vy) * dt * 2;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (ship.alive && ship.inv <= 0) {
        const hx = d.x - ship.x, hy = d.y - ship.y;
        if (hx * hx + hy * hy < (d.r + ship.r) * (d.r + ship.r)) die();
      }
    }
    drones = drones.filter((d) => d.hp > 0 && d.y < H + 40);

    for (const p of pickups) {
      if (p.taken) continue;
      p.y += p.vy * dt;
      const dx = p.x - ship.x, dy = p.y - ship.y;
      if (dx * dx + dy * dy < 28 * 28) {
        p.taken = true;
        cores += 1;
        score += 100;
        SFX.collect();
        floatText(p.x, p.y, "+100", "#ffe58a");
        burst(p.x, p.y, "#ffe58a", 12, 140, 0.4, 2.2, 0);
      }
    }
    pickups = pickups.filter((p) => !p.taken && p.y < H + 20);

    score += dt * 6;
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

  function drawSpace() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#050712");
    g.addColorStop(0.45, "#0b1230");
    g.addColorStop(1, "#12081f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const n1 = ctx.createRadialGradient(110, 160, 10, 110, 160, 200);
    n1.addColorStop(0, "rgba(90, 40, 160, 0.35)");
    n1.addColorStop(1, "rgba(90, 40, 160, 0)");
    ctx.fillStyle = n1;
    ctx.fillRect(0, 0, W, H);
    const n2 = ctx.createRadialGradient(380, 420, 10, 380, 420, 230);
    n2.addColorStop(0, "rgba(20, 90, 160, 0.28)");
    n2.addColorStop(1, "rgba(20, 90, 160, 0)");
    ctx.fillStyle = n2;
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      const y = (s.y + time * (12 + s.z * 28)) % (H + 8) - 4;
      ctx.globalAlpha = 0.35 + s.z * 0.4;
      ctx.fillStyle = "#dbe7ff";
      ctx.fillRect(s.x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawShip(x, y, ang, inv) {
    if (inv > 0 && Math.floor(time * 16) % 2 === 0) ctx.globalAlpha = 0.4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2);
    const glow = ctx.createRadialGradient(0, 10, 0, 0, 12, 24);
    glow.addColorStop(0, "rgba(126,224,255," + (0.5 + ship.glow * 0.4) + ")");
    glow.addColorStop(1, "rgba(126,224,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 16, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7ee0ff";
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(13, 14);
    ctx.lineTo(0, 8);
    ctx.lineTo(-13, 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d6f7ff";
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff7ad9";
    ctx.beginPath();
    ctx.moveTo(-13, 14);
    ctx.lineTo(-18, 8);
    ctx.lineTo(-8, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(13, 14);
    ctx.lineTo(18, 8);
    ctx.lineTo(8, 10);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawRock(rk) {
    ctx.save();
    ctx.translate(rk.x, rk.y);
    ctx.rotate(rk.rot);
    ctx.beginPath();
    ctx.moveTo(rk.pts[0][0], rk.pts[0][1]);
    for (let i = 1; i < rk.pts.length; i++) ctx.lineTo(rk.pts[i][0], rk.pts[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(-rk.r, -rk.r, rk.r, rk.r);
    g.addColorStop(0, "#d5e2ef");
    g.addColorStop(0.5, rk.tint);
    g.addColorStop(1, "#3c4c66");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (rk.hp < rk.max) {
      ctx.strokeStyle = "rgba(126,224,255,0.8)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDrone(d) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(time * 2 + d.t);
    ctx.fillStyle = "#ff7ad9";
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(12, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffe0f4";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBtn(x, y, w, h, label, primary) {
    ctx.fillStyle = "rgba(8,10,24,0.4)";
    rr(x + 3, y + 6, w, h, 14);
    ctx.fill();
    ctx.fillStyle = primary ? "#2c8cff" : "rgba(255,255,255,0.12)";
    rr(x, y, w, h, 14);
    ctx.fill();
    if (primary) {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      rr(x + 8, y + 4, w - 16, 14, 8);
      ctx.fill();
    }
    ctx.fillStyle = "#eef6ff";
    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  function drawMute(x, y) {
    ctx.fillStyle = "rgba(10,12,28,0.5)";
    rr(x, y, 40, 40, 10);
    ctx.fill();
    ctx.fillStyle = "#eef6ff";
    ctx.beginPath();
    ctx.moveTo(x + 11, y + 14);
    ctx.lineTo(x + 17, y + 14);
    ctx.lineTo(x + 24, y + 9);
    ctx.lineTo(x + 24, y + 31);
    ctx.lineTo(x + 17, y + 26);
    ctx.lineTo(x + 11, y + 26);
    ctx.closePath();
    ctx.fill();
    if (SFX.muted) {
      ctx.strokeStyle = "#ff7ad9";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 12);
      ctx.lineTo(x + 30, y + 30);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#eef6ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 24, y + 20, 7, -0.7, 0.7);
      ctx.stroke();
    }
  }

  function drawHUD() {
    ctx.fillStyle = "rgba(8,10,24,0.86)";
    rr(14, 14, 150, 44, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(180,220,255,0.7)";
    ctx.font = "600 11px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SCORE", 26, 22);
    ctx.fillStyle = "#eef6ff";
    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(Math.floor(score)), 26, 36);
    ctx.fillStyle = "rgba(8,10,24,0.86)";
    rr(W - 210, 14, 148, 44, 10);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(180,220,255,0.7)";
    ctx.font = "600 11px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("BEST", W - 70, 22);
    ctx.fillStyle = "#eef6ff";
    ctx.font = "700 22px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(Math.floor(best)), W - 70, 36);
    drawMute(W - 54, 16);
  }

  function drawStick() {
    if (!moveStick) {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#eef6ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(80, H - 100, 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#eef6ff";
      ctx.font = "600 11px Trebuchet MS, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("MOVE", 80, H - 48);
      ctx.beginPath();
      ctx.arc(W - 80, H - 100, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText("AUTO FIRE", W - 80, H - 52);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = "#7ee0ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(moveStick.ox, moveStick.oy, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#7ee0ff";
    ctx.beginPath();
    const dx = moveStick.x - moveStick.ox;
    const dy = moveStick.y - moveStick.oy;
    const m = Math.hypot(dx, dy);
    const k = m > 46 ? 46 / m : 1;
    ctx.arc(moveStick.ox + dx * k, moveStick.oy + dy * k, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawTitle() {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(126,224,255,0.25)";
    ctx.font = "800 58px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("NOVA DRIFT", W / 2, 196);
    ctx.fillStyle = "#eef6ff";
    ctx.fillText("NOVA DRIFT", W / 2, 190);
    ctx.fillStyle = "#ff7ad9";
    ctx.font = "600 16px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Weave the debris field. Claim the cores.", W / 2, 228);
    ctx.fillStyle = "rgba(180,220,255,0.85)";
    ctx.font = "600 15px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(best ? "Best  " + Math.floor(best) : "No signal logged", W / 2, 262);
    drawBtn(140, 378, 200, 58, "PLAY", true);
    ctx.fillStyle = "rgba(180,220,255,0.75)";
    ctx.font = "600 13px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("WASD / Arrows to steer   •   Auto-fire", W / 2, 462);
    ctx.fillText("Touch: drag left side to steer   •   M to mute", W / 2, 484);
    ctx.fillStyle = "rgba(180,220,255,0.45)";
    ctx.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Made by Gamma Gorilla Productions", W / 2, H - 28);
    drawMute(W - 54, 16);
    drawShip(ship.x, ship.y, ship.angle, 0);
  }

  function drawOver() {
    ctx.fillStyle = "rgba(4, 6, 16, 0.62)";
    ctx.fillRect(0, 0, W, H);
    const slide = Math.min(1, deadTimer * 3);
    const yoff = (1 - slide) * 40;
    ctx.save();
    ctx.globalAlpha = slide;
    ctx.translate(0, yoff);
    ctx.fillStyle = "rgba(10, 14, 30, 0.94)";
    rr(60, 180, 360, 390, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(126,224,255,0.25)";
    ctx.lineWidth = 2;
    rr(60, 180, 360, 390, 20);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff7ad9";
    ctx.font = "800 32px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("SIGNAL LOST", W / 2, 236);
    ctx.fillStyle = "#eef6ff";
    ctx.font = "700 48px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(Math.floor(score)), W / 2, 300);
    ctx.font = "600 14px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(180,220,255,0.75)";
    ctx.fillText(newBest ? "NEW BEST SCORE" : "Best  " + Math.floor(best), W / 2, 332);
    ctx.fillText("Cores  " + cores, W / 2, 358);
    drawBtn(140, 430, 200, 54, "TRY AGAIN", true);
    drawBtn(140, 498, 200, 46, "TITLE", false);
    ctx.fillStyle = "rgba(180,220,255,0.4)";
    ctx.font = "600 12px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText("Made by Gamma Gorilla Productions", W / 2, 548);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ox = (Math.random() - 0.5) * shake;
    const oy = (Math.random() - 0.5) * shake;
    ctx.translate(ox, oy);
    drawSpace();

    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const rk of rocks) if (rk.hp > 0) drawRock(rk);
    for (const d of drones) if (d.hp > 0) drawDrone(d);
    for (const p of pickups) {
      if (p.taken) continue;
      const bob = Math.sin(time * 4 + p.bob) * 3;
      ctx.fillStyle = "#ffe58a";
      ctx.shadowColor = "#ffe58a";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y + bob, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (const b of bullets) {
      ctx.strokeStyle = "#7ee0ff";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.stroke();
    }
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, f.life / 0.75);
      ctx.fillStyle = f.color;
      ctx.font = "700 16px Trebuchet MS, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    if (state === "title") {
      drawTitle();
    } else {
      if (ship.alive || deadTimer < 0.35) {
        const fade = ship.alive ? 1 : Math.max(0, 1 - deadTimer * 3);
        ctx.globalAlpha = fade;
        drawShip(ship.x, ship.y, ship.angle, ship.inv);
        ctx.globalAlpha = 1;
      }
      drawHUD();
      if (state === "play") drawStick();
      if (state === "over") drawOver();
    }

    if (flash > 0) {
      ctx.fillStyle = "rgba(220,240,255," + (flash * 0.55) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
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
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__DEBUG = () => ({ state, score: Math.floor(score), best: Math.floor(best), cores, alive: ship.alive, rocks: rocks.length });
})();
