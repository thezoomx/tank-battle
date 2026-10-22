/* =========================================================
 * 坦克大战 · Tank Battle
 * 原生 Canvas 2D 实现，零依赖
 * ========================================================= */
(() => {
  'use strict';

  // ===================== 常量 =====================
  const TILE = 40;
  const COLS = 15;
  const ROWS = 15;
  const W = TILE * COLS;
  const H = TILE * ROWS;
  const TANK = 36;
  const PAD = (TILE - TANK) / 2;

  const PLAYER_SPEED = 150;
  const PLAYER_FIRE_CD = 0.28;
  const MAX_PLAYER_BULLETS = 2;
  const HIGH_KEY = 'tank-battle-highscore';

  const DIR_ANGLE = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
  const DIR_VEC = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  const ALL_DIRS = ['up', 'right', 'down', 'left'];

  // 敌方坦克类型
  const ENEMY_TYPES = {
    grunt: { speed: 72,  hp: 1, score: 100, body: '#96a0ad', turret: '#c2ccda', track: '#4c5766', barrel: '#dbe4f0' },
    fast:  { speed: 128, hp: 1, score: 200, body: '#d9b46a', turret: '#f2d79b', track: '#7a5f2f', barrel: '#ffe7b0' },
    heavy: { speed: 52,  hp: 3, score: 300, body: '#c05a5a', turret: '#e08a8a', track: '#6e3030', barrel: '#ffc2c2' },
  };

  // 地图图例：. 空地  # 砖墙  = 钢墙  ~ 水域  T 树丛  E 基地
  const MAPS = [
    [
      '...............',
      '.==..#####..==.',
      '.==..#...#..==.',
      '.....#...#.....',
      '.##..#...#..##.',
      '.##.........##.',
      '....###.###....',
      '.~..###.###..~.',
      '....###.###....',
      '.##.........##.',
      '.##..#...#..##.',
      '.....#...#.....',
      '.==..#...#..==.',
      '.==..#####..==.',
      '......#E#......',
    ],
    [
      '...............',
      '..###.....###..',
      '..#.#.....#.#..',
      '..#.#..=..#.#..',
      '..###..=..###..',
      '.......=.......',
      '..####...####..',
      '..~~~.....~~~..',
      '..###..=..###..',
      '..#.#..=..#.#..',
      '..#.#.....=....',
      '..###.....###..',
      '...............',
      '.....#####.....',
      '......#E#......',
    ],
    [
      '...............',
      '..##..###..##..',
      '..##..###..##..',
      '.......~.......',
      '..###.....###..',
      '..###..#..###..',
      '.......#.......',
      '==.....~.....==',
      '.......#.......',
      '..###..#..###..',
      '..###.....###..',
      '.......~.......',
      '..##..###..##..',
      '..##..###..##..',
      '......#E#......',
    ],
  ];

  // 敌方出生点（列, 行）
  const SPAWN_POINTS = [[0, 0], [7, 0], [14, 0]];

  // ===================== DOM =====================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const highEl = document.getElementById('high');
  const muteBtn = document.getElementById('muteBtn');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const startBtn = document.getElementById('startBtn');

  // ===================== 状态 =====================
  function loadHigh() {
    try { return parseInt(localStorage.getItem(HIGH_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function saveHigh(v) {
    try { localStorage.setItem(HIGH_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  const G = {
    state: 'menu',       // menu | playing | paused | levelclear | gameover
    time: 0,
    score: 0,
    high: loadHigh(),
    level: 1,
    lives: 3,
    tiles: [],
    base: null,
    player: null,
    enemies: [],
    bullets: [],
    particles: [],
    spawns: [],
    toSpawn: 0,
    maxOnField: 3,
    spawnInterval: 2.5,
    spawnTimer: 0,
    respawnTimer: 0,
    nextLevelTimer: 0,
    endTimer: -1,
    shake: 0,
    muted: false,
    fireHeld: false,
    heldDirs: [],
  };

  let overlayAction = () => {};

  // ===================== 音效 =====================
  let actx = null;

  function ensureAudio() {
    if (!G.muted) {
      try {
        if (!actx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) actx = new AC();
        }
        if (actx && actx.state === 'suspended') actx.resume();
      } catch (e) { actx = null; }
    }
  }

  function beep(freq, dur, type, vol, endFreq) {
    if (!actx) return;
    const t0 = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!actx) return;
    const len = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buffer = actx.createBuffer(1, len, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 2);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = actx.createBufferSource();
    src.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff || 900;
    const gain = actx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(actx.destination);
    src.start();
  }

  let noiseCooldown = 0;
  function sfx(name) {
    if (G.muted) return;
    ensureAudio();
    if (!actx) return;
    switch (name) {
      case 'shoot':      beep(760, 0.06, 'square', 0.025, 240); break;
      case 'enemyShoot': beep(320, 0.06, 'sawtooth', 0.008, 120); break;
      case 'hit':        beep(150, 0.05, 'square', 0.02, 90); break;
      case 'spawn':      beep(880, 0.08, 'sine', 0.02, 1300); break;
      case 'start':      beep(520, 0.09, 'square', 0.025); setTimeout(() => beep(780, 0.12, 'square', 0.025), 90); break;
      case 'level':      beep(660, 0.1, 'square', 0.025); setTimeout(() => beep(880, 0.1, 'square', 0.025), 110); setTimeout(() => beep(1100, 0.16, 'square', 0.025), 220); break;
      case 'gameover':   beep(300, 0.2, 'sawtooth', 0.03, 90); setTimeout(() => beep(180, 0.35, 'sawtooth', 0.03, 60), 200); break;
      case 'explode':
        if (noiseCooldown > 0) return;
        noiseCooldown = 0.04;
        noiseBurst(0.22, 0.055, 1100);
        beep(90, 0.15, 'triangle', 0.03, 40);
        break;
      case 'explodeBig':
        noiseBurst(0.45, 0.09, 700);
        beep(70, 0.3, 'triangle', 0.05, 32);
        break;
      case 'base':
        noiseBurst(0.7, 0.12, 500);
        beep(60, 0.5, 'sawtooth', 0.05, 28);
        break;
      default: break;
    }
  }

  // ===================== 工具函数 =====================
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ===================== 坦克 =====================
  function makeTank(o) {
    return {
      x: o.x, y: o.y, size: TANK,
      dir: o.dir || 'up',
      speed: o.speed,
      hp: o.hp, maxHp: o.hp,
      isPlayer: !!o.isPlayer,
      type: o.type || 'player',
      body: o.body, turret: o.turret, track: o.track, barrel: o.barrel,
      points: o.points || 0,
      alive: true,
      cooldown: 0,
      invuln: o.invuln || 0,
      flash: 0,
      think: 0,
      stuck: 0,
      mode: o.mode || 'player',
    };
  }

  function allTanks() {
    const arr = G.enemies.filter((e) => e.alive);
    if (G.player && G.player.alive) arr.push(G.player);
    return arr;
  }

  function tankBlocked(x, y, size) {
    if (x < 0 || y < 0 || x + size > W || y + size > H) return true;
    const c0 = Math.floor(x / TILE);
    const c1 = Math.floor((x + size - 0.01) / TILE);
    const r0 = Math.floor(y / TILE);
    const r1 = Math.floor((y + size - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = G.tiles[r][c];
        if (t === '#' || t === '=' || t === '~' || t === 'E') return true;
      }
    }
    return false;
  }

  function tankHitsTank(t, nx, ny, tanks) {
    const inset = 3;
    for (const o of tanks) {
      if (o === t || !o.alive) continue;
      if (nx + inset < o.x + o.size && nx + t.size - inset > o.x &&
          ny + inset < o.y + o.size && ny + t.size - inset > o.y) {
        return true;
      }
    }
    return false;
  }

  function moveTank(t, dir, dt, tanks) {
    t.dir = dir;
    const [dx, dy] = DIR_VEC[dir];
    const dist = t.speed * dt;
    const nx = t.x + dx * dist;
    const ny = t.y + dy * dist;
    if (tankBlocked(nx, ny, t.size)) return false;
    if (tankHitsTank(t, nx, ny, tanks)) return false;
    t.x = nx;
    t.y = ny;
    return true;
  }

  function canMoveDir(t, dir, dist) {
    const [dx, dy] = DIR_VEC[dir];
    const nx = t.x + dx * (dist || 3);
    const ny = t.y + dy * (dist || 3);
    if (tankBlocked(nx, ny, t.size)) return false;
    return !tankHitsTank(t, nx, ny, allTanks());
  }

  function pointInTank(px, py, t, pad) {
    const p = pad || 0;
    return px > t.x - p && px < t.x + t.size + p &&
           py > t.y - p && py < t.y + t.size + p;
  }

  // ===================== 玩家 =====================
  function spawnPlayer() {
    const baseCol = G.base ? G.base.col : 7;
    const col = Math.max(1, baseCol - 3);
    const x = col * TILE + PAD;
    const y = 14 * TILE + PAD;

    const occupied = allTanks().some((o) => rectsOverlap(x, y, TANK, TANK, o.x, o.y, o.size, o.size));
    if (occupied) {
      G.respawnTimer = 0.45;
      return;
    }

    G.player = makeTank({
      x, y,
      speed: PLAYER_SPEED,
      hp: 1,
      isPlayer: true,
      body: '#7ad46a',
      turret: '#a8f095',
      track: '#35702f',
      barrel: '#d9ffcf',
      invuln: 2.5,
    });
    sfx('spawn');
  }

  // 转向时轻微吸附到车道，减少卡墙角
  function snapPlayer(p, dir, dt) {
    const speed = 240;
    if (dir === 'left' || dir === 'right') {
      const laneY = Math.round((p.y - PAD) / TILE) * TILE + PAD;
      const d = laneY - p.y;
      if (Math.abs(d) > 0.4) {
        const ny = p.y + Math.sign(d) * Math.min(Math.abs(d), speed * dt);
        if (!tankBlocked(p.x, ny, p.size)) p.y = ny;
      }
    } else {
      const laneX = Math.round((p.x - PAD) / TILE) * TILE + PAD;
      const d = laneX - p.x;
      if (Math.abs(d) > 0.4) {
        const nx = p.x + Math.sign(d) * Math.min(Math.abs(d), speed * dt);
        if (!tankBlocked(nx, p.y, p.size)) p.x = nx;
      }
    }
  }

  function updatePlayer(dt) {
    if (!G.player) {
      G.respawnTimer -= dt;
      if (G.respawnTimer <= 0 && G.lives > 0 && G.endTimer < 0) spawnPlayer();
      return;
    }

    const p = G.player;
    p.flash = Math.max(0, p.flash - dt);
    if (p.invuln > 0) p.invuln -= dt;
    p.cooldown -= dt;

    const dir = G.heldDirs[G.heldDirs.length - 1] || null;
    if (dir) {
      if (dir !== p.dir) p.dir = dir;
      snapPlayer(p, dir, dt);
      moveTank(p, dir, dt, allTanks());
    }

    if (G.fireHeld && p.cooldown <= 0) {
      const mine = G.bullets.filter((b) => b.owner === 'player' && !b.dead).length;
      if (mine < MAX_PLAYER_BULLETS) fire(p);
    }
  }

  // ===================== 敌人 =====================
  function pickEnemyType(level) {
    const heavy = Math.min(0.32, 0.04 + level * 0.025);
    const fast = 0.3;
    const r = Math.random();
    if (r < heavy) return 'heavy';
    if (r < heavy + fast) return 'fast';
    return 'grunt';
  }

  function createEnemy(spawn) {
    const type = spawn.type;
    const cfg = ENEMY_TYPES[type];
    const speedMul = 1 + Math.min(G.level - 1, 8) * 0.03;
    const e = makeTank({
      x: spawn.col * TILE + PAD,
      y: spawn.row * TILE + PAD,
      speed: cfg.speed * speedMul,
      hp: cfg.hp,
      type,
      body: cfg.body,
      turret: cfg.turret,
      track: cfg.track,
      barrel: cfg.barrel,
      points: cfg.score,
      mode: Math.random() < 0.45 ? 'base' : 'player',
    });
    e.dir = 'down';
    e.think = 0.4 + Math.random() * 0.5;
    e.cooldown = 0.8 + Math.random() * 0.8;
    G.enemies.push(e);
  }

  function enemyTarget(e) {
    if (e.mode === 'player' && G.player && G.player.alive) return G.player;
    return G.base || G.player;
  }

  function enemyFacingTarget(e, target) {
    if (!target) return false;
    const ex = e.x + e.size / 2, ey = e.y + e.size / 2;
    const tx = target.x + target.size / 2, ty = target.y + target.size / 2;
    const ax = Math.abs(ex - tx), ay = Math.abs(ey - ty);
    if (e.dir === 'up') return ax < 22 && ty < ey;
    if (e.dir === 'down') return ax < 22 && ty > ey;
    if (e.dir === 'left') return ay < 22 && tx < ex;
    return ay < 22 && tx > ex;
  }

  function pickEnemyDir(e, target, force) {
    if (!force && Math.random() < 0.3 && canMoveDir(e, e.dir, 4)) return;
    if (!target) return;

    const ex = e.x + e.size / 2, ey = e.y + e.size / 2;
    const tx = target.x + target.size / 2, ty = target.y + target.size / 2;
    const dx = tx - ex, dy = ty - ey;

    const towards = [];
    if (Math.abs(dx) > 16) towards.push(dx > 0 ? 'right' : 'left');
    if (Math.abs(dy) > 16) towards.push(dy > 0 ? 'down' : 'up');

    const randomOrder = shuffle(ALL_DIRS.slice());
    const pool = [];
    const preferTowards = Math.random() < 0.72 && towards.length > 0;
    const first = preferTowards ? shuffle(towards.slice()) : randomOrder;
    for (const d of first) if (!pool.includes(d)) pool.push(d);
    for (const d of randomOrder) if (!pool.includes(d)) pool.push(d);

    for (const d of pool) {
      if (canMoveDir(e, d, 4)) { e.dir = d; return; }
    }
    e.dir = ALL_DIRS[(Math.random() * 4) | 0];
  }

  function updateEnemies(dt) {
    const tanks = allTanks();
    for (const e of G.enemies) {
      if (!e.alive) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.cooldown -= dt;
      e.think -= dt;

      const target = enemyTarget(e);
      if (e.think <= 0) {
        e.think = 0.55 + Math.random() * 1.0;
        pickEnemyDir(e, target, false);
      }

      const moved = moveTank(e, e.dir, dt, tanks);
      if (!moved) {
        e.stuck += dt;
        if (e.stuck > 0.18) {
          e.stuck = 0;
          pickEnemyDir(e, target, true);
        }
      } else {
        e.stuck = 0;
      }

      if (e.cooldown <= 0) {
        if (enemyFacingTarget(e, target) || Math.random() < 0.3) fire(e);
        else e.cooldown = 0.22;
      }
    }
  }

  // ===================== 子弹 =====================
  function fire(t) {
    const cx = t.x + t.size / 2;
    const cy = t.y + t.size / 2;
    const off = t.size / 2 + 4;
    const [dx, dy] = DIR_VEC[t.dir];
    const bx = cx + dx * off;
    const by = cy + dy * off;
    const speed = t.isPlayer ? 460 : (t.type === 'fast' ? 330 : 310);

    G.bullets.push({ x: bx, y: by, dir: t.dir, speed, owner: t.isPlayer ? 'player' : 'enemy', dead: false });
    t.cooldown = t.isPlayer ? PLAYER_FIRE_CD : (0.9 + Math.random() * 1.0);

    const baseAngle = Math.atan2(dy, dx);
    for (let i = 0; i < 4; i++) {
      const a = baseAngle + (Math.random() - 0.5) * 0.8;
      const sp = 50 + Math.random() * 90;
      addParticle(bx, by, Math.cos(a) * sp, Math.sin(a) * sp, 0.15 + Math.random() * 0.1, 2.5, '#ffe9a8', 0);
    }

    sfx(t.isPlayer ? 'shoot' : 'enemyShoot');
  }

  function updateBullets(dt) {
    for (const b of G.bullets) {
      if (b.dead) continue;
      let remaining = b.speed * dt;
      while (remaining > 0 && !b.dead) {
        const step = Math.min(6, remaining);
        remaining -= step;
        if (b.dir === 'up') b.y -= step;
        else if (b.dir === 'down') b.y += step;
        else if (b.dir === 'left') b.x -= step;
        else b.x += step;
        checkBullet(b);
      }
    }

    // 敌我子弹对撞
    for (let i = 0; i < G.bullets.length; i++) {
      const a = G.bullets[i];
      if (a.dead || a.owner !== 'player') continue;
      for (let j = 0; j < G.bullets.length; j++) {
        const c = G.bullets[j];
        if (c.dead || c.owner !== 'enemy') continue;
        if (Math.hypot(a.x - c.x, a.y - c.y) < 9) {
          a.dead = true;
          c.dead = true;
          sparks((a.x + c.x) / 2, (a.y + c.y) / 2, '#ffe6a3', 5);
          sfx('hit');
          break;
        }
      }
    }

    G.bullets = G.bullets.filter((b) => !b.dead);
  }

  function checkBullet(b) {
    if (b.x < 0 || b.y < 0 || b.x > W || b.y > H) {
      b.dead = true;
      return;
    }
    const c = Math.floor(b.x / TILE);
    const r = Math.floor(b.y / TILE);
    const tile = G.tiles[r][c];

    if (tile === '#') {
      G.tiles[r][c] = '.';
      b.dead = true;
      brickDebris(c, r);
      sfx('hit');
      return;
    }
    if (tile === '=') {
      b.dead = true;
      sparks(b.x, b.y, '#cfe0f5', 5);
      sfx('hit');
      return;
    }
    if (tile === 'E') {
      b.dead = true;
      if (b.owner === 'enemy') destroyBase();
      else sparks(b.x, b.y, '#ffd97a', 5);
      return;
    }

    if (b.owner === 'player') {
      for (const e of G.enemies) {
        if (!e.alive) continue;
        if (pointInTank(b.x, b.y, e, 2)) {
          damageTank(e, b);
          return;
        }
      }
    } else {
      const p = G.player;
      if (p && p.alive && pointInTank(b.x, b.y, p, 2)) {
        if (p.invuln > 0) {
          b.dead = true;
          sparks(b.x, b.y, '#8ef2ff', 4);
        } else {
          damageTank(p, b);
        }
      }
    }
  }

  function damageTank(t, b) {
    b.dead = true;
    t.hp -= 1;
    t.flash = 0.16;
    sparks(b.x, b.y, t.isPlayer ? '#aaffaa' : '#ffd27a', 5);
    if (t.hp <= 0) killTank(t);
    else sfx('hit');
  }

  function killTank(t) {
    t.alive = false;
    explode(t.x + t.size / 2, t.y + t.size / 2, t.isPlayer);

    if (t.isPlayer) {
      G.player = null;
      G.lives -= 1;
      updateHUD();
      if (G.lives <= 0) G.endTimer = 1.2;
      else G.respawnTimer = 1.5;
    } else {
      const i = G.enemies.indexOf(t);
      if (i >= 0) G.enemies.splice(i, 1);
      G.score += t.points;
      if (G.score > G.high) {
        G.high = G.score;
        saveHigh(G.high);
      }
      updateHUD();
    }
  }

  // ===================== 基地 / 关卡流程 =====================
  function destroyBase() {
    if (!G.base || !G.base.alive) return;
    G.base.alive = false;
    G.tiles[G.base.row][G.base.col] = '.';
    const cx = G.base.x + TILE / 2;
    const cy = G.base.y + TILE / 2;
    explode(cx, cy, true);
    explode(cx, cy + 6, true);
    G.shake = 20;
    sfx('base');
    G.endTimer = 1.5;
  }

  function checkLevelClear() {
    if (G.state !== 'playing' || G.endTimer > 0) return;
    if (G.toSpawn === 0 && G.enemies.length === 0 && G.spawns.length === 0) {
      G.state = 'levelclear';
      G.nextLevelTimer = 2.0;
      G.fireHeld = false;
      G.bullets = [];
      sfx('level');
      showOverlay({
        title: `第 ${G.level} 关完成`,
        text: `准备迎接第 ${G.level + 1} 关…`,
        showButton: false,
      });
    }
  }

  function startLevel() {
    const rows = MAPS[(G.level - 1) % MAPS.length];
    G.tiles = rows.map((row) => (row || '').padEnd(COLS, '.').slice(0, COLS).split(''));

    G.base = { col: 7, row: 14, x: 7 * TILE, y: 14 * TILE, size: TILE, alive: true };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (G.tiles[r][c] === 'E') {
          G.base = { col: c, row: r, x: c * TILE, y: r * TILE, size: TILE, alive: true };
        }
      }
    }

    G.enemies = [];
    G.bullets = [];
    G.particles = [];
    G.spawns = [];
    G.player = null;

    G.toSpawn = 8 + G.level * 2;
    G.maxOnField = Math.min(5, 3 + Math.floor((G.level - 1) / 2));
    G.spawnInterval = Math.max(1.0, 2.6 - G.level * 0.12);
    G.spawnTimer = 1.0;
    G.respawnTimer = 0;
    G.nextLevelTimer = 0;
    G.endTimer = -1;
    G.shake = 0;
    G.state = 'playing';

    hideOverlay();
    spawnPlayer();
    updateHUD();
    sfx('start');
  }

  function startGame() {
    G.score = 0;
    G.lives = 3;
    G.level = 1;
    G.fireHeld = false;
    G.heldDirs.length = 0;
    startLevel();
  }

  function gameOver() {
    if (G.state === 'gameover') return;
    G.state = 'gameover';
    G.fireHeld = false;
    G.heldDirs.length = 0;
    if (G.score > G.high) {
      G.high = G.score;
      saveHigh(G.high);
    }
    updateHUD();
    sfx('gameover');
    showOverlay({
      title: '游戏结束',
      text: `本局得分 ${G.score}　·　最高分 ${G.high}`,
      button: '再来一局',
      action: startGame,
    });
  }

  function togglePause() {
    if (G.state === 'playing') {
      G.state = 'paused';
      G.fireHeld = false;
      G.heldDirs.length = 0;
      showOverlay({
        title: '已暂停',
        text: '按 P 继续游戏',
        button: '继续',
        action: resumeGame,
      });
    } else if (G.state === 'paused') {
      resumeGame();
    }
  }

  function resumeGame() {
    if (G.state !== 'paused') return;
    G.state = 'playing';
    G.fireHeld = false;
    hideOverlay();
  }

  // ===================== 敌人生成 =====================
  function spawnCellFree(col, row, ignore) {
    if (G.spawns.some((s) => s !== ignore && s.col === col && s.row === row)) return false;
    const x = col * TILE + PAD;
    const y = row * TILE + PAD;
    if (tankBlocked(x, y, TANK)) return false;
    return !allTanks().some((o) => rectsOverlap(x, y, TANK, TANK, o.x, o.y, o.size, o.size));
  }

  function updateSpawning(dt) {
    for (let i = G.spawns.length - 1; i >= 0; i--) {
      const s = G.spawns[i];
      s.timer -= dt;
      if (s.timer <= 0) {
        if (spawnCellFree(s.col, s.row, s)) {
          G.spawns.splice(i, 1);
          createEnemy(s);
        } else {
          s.timer = 0.4;
        }
      }
    }

    if (G.toSpawn > 0 && G.enemies.length + G.spawns.length < G.maxOnField) {
      G.spawnTimer -= dt;
      if (G.spawnTimer <= 0) {
        const points = shuffle(SPAWN_POINTS.slice());
        const pt = points.find(([c, r]) => spawnCellFree(c, r));
        if (pt) {
          G.spawns.push({ col: pt[0], row: pt[1], timer: 0.85, type: pickEnemyType(G.level) });
          G.toSpawn -= 1;
          G.spawnTimer = G.spawnInterval;
          sfx('spawn');
        } else {
          G.spawnTimer = 0.5;
        }
      }
    }
  }

  // ===================== 粒子 =====================
  function addParticle(x, y, vx, vy, life, size, color, gravity) {
    G.particles.push({
      x, y, vx, vy,
      life, maxLife: life,
      size, color,
      gravity: gravity || 0,
    });
  }

  function sparks(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 140;
      addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.22 + Math.random() * 0.25,
        1.5 + Math.random() * 2, color, 120);
    }
  }

  function brickDebris(c, r) {
    const x = c * TILE + TILE / 2;
    const y = r * TILE + TILE / 2;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 100;
      addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.3,
        2 + Math.random() * 2, Math.random() < 0.5 ? '#a85a3b' : '#6b3423', 220);
    }
  }

  function explode(x, y, big) {
    const n = big ? 36 : 20;
    const colors = ['#ffe6a3', '#ffb347', '#ff7a3d', '#ffffff', '#8f9aa8'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * (big ? 260 : 170);
      addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.35 + Math.random() * 0.5, 2 + Math.random() * 3,
        colors[(Math.random() * colors.length) | 0], 140);
    }
    G.shake = Math.min(18, G.shake + (big ? 11 : 6));
    sfx(big ? 'explodeBig' : 'explode');
  }

  function updateParticles(dt) {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        G.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 2.2 * dt);
      p.vy *= Math.max(0, 1 - 2.2 * dt);
    }
  }

  // ===================== 主循环 =====================
  function update(dt) {
    G.time += dt;
    G.shake = Math.max(0, G.shake - dt * 45);
    noiseCooldown = Math.max(0, noiseCooldown - dt);

    if (G.state === 'levelclear') {
      updateParticles(dt);
      G.nextLevelTimer -= dt;
      if (G.nextLevelTimer <= 0) {
        G.level += 1;
        startLevel();
      }
      return;
    }

    if (G.state !== 'playing') return;

    updateParticles(dt);

    if (G.endTimer > 0) {
      G.endTimer -= dt;
      if (G.endTimer <= 0) {
        gameOver();
        return;
      }
    }

    updatePlayer(dt);
    updateEnemies(dt);
    updateSpawning(dt);
    updateBullets(dt);
    checkLevelClear();
  }

  // ===================== 绘制 =====================
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sx = G.shake > 0 ? (Math.random() - 0.5) * G.shake : 0;
    const sy = G.shake > 0 ? (Math.random() - 0.5) * G.shake : 0;

    ctx.save();
    ctx.translate(sx, sy);

    drawGround();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = G.tiles[r][c];
        if (t === '#') drawBrick(c, r);
        else if (t === '=') drawSteel(c, r);
        else if (t === '~') drawWater(c, r);
      }
    }

    if (G.base && G.base.alive) drawBase(G.base.x, G.base.y);
    else if (G.base) drawRubble(G.base.x, G.base.y);

    drawSpawnMarkers();
    drawBullets();
    drawTanks();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (G.tiles[r][c] === 'T') drawTree(c, r);
      }
    }

    drawParticles();
    ctx.restore();
  }

  function drawGround() {
    ctx.fillStyle = '#0d1218';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r + c) % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.012)';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
    ctx.strokeStyle = 'rgba(120,150,190,0.045)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * TILE + 0.5, 0);
      ctx.lineTo(i * TILE + 0.5, H);
      ctx.stroke();
    }
    for (let i = 1; i < ROWS; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * TILE + 0.5);
      ctx.lineTo(W, i * TILE + 0.5);
      ctx.stroke();
    }
  }

  function drawBrick(c, r) {
    const x = c * TILE, y = r * TILE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, TILE, TILE);
    ctx.clip();
    ctx.fillStyle = '#582b1c';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#a85a3b';
    for (let row = 0; row < 4; row++) {
      const offset = (row % 2) * 10;
      for (let bx = -20; bx <= TILE; bx += 20) {
        ctx.fillRect(x + bx + offset + 1, y + row * 10 + 1, 18, 8);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let row = 0; row < 4; row++) {
      const offset = (row % 2) * 10;
      for (let bx = -20; bx <= TILE; bx += 20) {
        ctx.fillRect(x + bx + offset + 1, y + row * 10 + 1, 18, 1);
      }
    }
    ctx.restore();
  }

  function drawSteel(c, r) {
    const x = c * TILE, y = r * TILE;
    ctx.fillStyle = '#46525f';
    ctx.fillRect(x, y, TILE, TILE);
    const g = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
    g.addColorStop(0, '#a7b7c9');
    g.addColorStop(0.5, '#7e8fa3');
    g.addColorStop(1, '#59697c');
    ctx.fillStyle = g;
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 3, y + 3, TILE - 6, 2);
    ctx.fillRect(x + 3, y + 3, 2, TILE - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + 3, y + TILE - 5, TILE - 6, 2);
    ctx.fillRect(x + TILE - 5, y + 3, 2, TILE - 6);

    ctx.fillStyle = 'rgba(30,40,50,0.55)';
    for (const [dx, dy] of [[9, 9], [31, 9], [9, 31], [31, 31]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWater(c, r) {
    const x = c * TILE, y = r * TILE;
    ctx.fillStyle = '#0e2d4d';
    ctx.fillRect(x, y, TILE, TILE);
    const g = ctx.createLinearGradient(x, y, x, y + TILE);
    g.addColorStop(0, 'rgba(40,110,180,0.35)');
    g.addColorStop(1, 'rgba(10,40,80,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, TILE, TILE);

    ctx.strokeStyle = 'rgba(110,190,255,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const wy = y + 10 + i * 12 + Math.sin(G.time * 2.2 + c * 0.7 + i * 1.3) * 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, wy);
      ctx.quadraticCurveTo(x + 14, wy - 3, x + 24, wy);
      ctx.quadraticCurveTo(x + 32, wy + 3, x + 37, wy);
      ctx.stroke();
    }
  }

  function drawTree(c, r) {
    const x = c * TILE, y = r * TILE;
    ctx.fillStyle = '#0f2a17';
    ctx.fillRect(x, y, TILE, TILE);

    const blobs = [[12, 13, 11], [27, 12, 10], [14, 28, 12], [29, 28, 10], [21, 21, 10]];
    for (const [bx, by, br] of blobs) {
      ctx.fillStyle = '#1b5a2f';
      ctx.beginPath();
      ctx.arc(x + bx, y + by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [bx, by, br] of blobs) {
      ctx.fillStyle = '#2b7c43';
      ctx.beginPath();
      ctx.arc(x + bx - 2, y + by - 2, br * 0.58, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBase(x, y) {
    ctx.fillStyle = '#1a2028';
    ctx.fillRect(x, y, TILE, TILE);
    const g = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
    g.addColorStop(0, '#3c4757');
    g.addColorStop(1, '#202731');
    ctx.fillStyle = g;
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);

    const cx = x + TILE / 2;
    const cy = y + TILE / 2 + 1;

    // 盾牌
    ctx.fillStyle = '#e8c45c';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 15);
    ctx.lineTo(cx + 12, cy - 5);
    ctx.lineTo(cx + 9, cy + 9);
    ctx.lineTo(cx, cy + 15);
    ctx.lineTo(cx - 9, cy + 9);
    ctx.lineTo(cx - 12, cy - 5);
    ctx.closePath();
    ctx.fill();

    // 内部深色
    ctx.fillStyle = '#262d38';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx + 7, cy - 3);
    ctx.lineTo(cx + 5, cy + 7);
    ctx.lineTo(cx, cy + 11);
    ctx.lineTo(cx - 5, cy + 7);
    ctx.lineTo(cx - 7, cy - 3);
    ctx.closePath();
    ctx.fill();

    // 星
    ctx.fillStyle = '#f7dd8a';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? 6 : 2.6;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawRubble(x, y) {
    ctx.fillStyle = '#14171c';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#2c3038';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#454b55';
    const chunks = [[9, 10, 7, 6], [24, 13, 9, 7], [13, 27, 8, 6], [28, 28, 6, 5]];
    for (const [dx, dy, w, h] of chunks) {
      ctx.fillRect(x + dx, y + dy, w, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 2, y + TILE - 6, TILE - 4, 4);
  }

  function drawSpawnMarkers() {
    for (const s of G.spawns) {
      const cx = s.col * TILE + TILE / 2;
      const cy = s.row * TILE + TILE / 2;
      const pulse = 0.55 + 0.45 * Math.sin(G.time * 14);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(G.time * 3);
      ctx.strokeStyle = `rgba(255,210,110,${pulse})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(-13, -13, 26, 26);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = `rgba(255,240,190,${pulse * 0.8})`;
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();
    }
  }

  function drawBullets() {
    for (const b of G.bullets) {
      if (b.dead) continue;
      const col = b.owner === 'player' ? '#9ff3ff' : '#ffb27a';
      const [dx, dy] = DIR_VEC[b.dir];

      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - dx * 10, b.y - dy * 10);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.fillStyle = b.owner === 'player' ? '#e8fdff' : '#ffdfc2';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTanks() {
    if (G.player && G.player.alive) drawTank(G.player);
    for (const e of G.enemies) {
      if (e.alive) drawTank(e);
    }
  }

  function drawTank(t) {
    const half = t.size / 2;
    const cx = t.x + half;
    const cy = t.y + half;

    ctx.save();
    ctx.translate(cx, cy);

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(1, 3, half * 0.95, half * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(DIR_ANGLE[t.dir]);

    // 履带
    ctx.fillStyle = t.track;
    roundRect(-half, -half + 2, 9, t.size - 4, 3);
    ctx.fill();
    roundRect(half - 9, -half + 2, 9, t.size - 4, 3);
    ctx.fill();

    // 履带纹
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = -half + 5; i < half - 4; i += 7) {
      ctx.fillRect(-half + 1, i, 7, 2);
      ctx.fillRect(half - 8, i, 7, 2);
    }

    // 车身
    const g = ctx.createLinearGradient(-half, -half, half, half);
    g.addColorStop(0, t.turret);
    g.addColorStop(1, t.body);
    ctx.fillStyle = g;
    roundRect(-11, -13, 22, 26, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    roundRect(-11, -13, 22, 26, 4);
    ctx.stroke();

    // 炮塔
    ctx.fillStyle = t.turret;
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 炮管
    ctx.fillStyle = t.barrel;
    roundRect(-2.5, -20, 5, 13, 2);
    ctx.fill();

    // 受击闪白
    if (t.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, t.flash * 5)})`;
      roundRect(-half, -half, t.size, t.size, 6);
      ctx.fill();
    }

    ctx.restore();

    // 无敌护盾
    if (t.isPlayer && t.invuln > 0) {
      const a = 0.3 + 0.22 * Math.sin(G.time * 12);
      ctx.strokeStyle = `rgba(130,230,255,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, half + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (const p of G.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size * (0.6 + a * 0.6);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  // ===================== HUD / 遮罩 =====================
  function updateHUD() {
    scoreEl.textContent = String(G.score);
    livesEl.textContent = G.lives > 0 ? '❤'.repeat(G.lives) : '—';
    levelEl.textContent = String(G.level);
    highEl.textContent = String(G.high);
  }

  function showOverlay(opts) {
    overlayTitle.textContent = opts.title || '';
    overlayText.textContent = opts.text || '';

    if (opts.showButton === false || !opts.button) {
      startBtn.classList.add('hidden');
      overlayAction = () => {};
    } else {
      startBtn.textContent = opts.button;
      startBtn.classList.remove('hidden');
      overlayAction = opts.action || (() => {});
    }

    overlay.classList.remove('hidden');
    // 重播入场动画
    const card = overlay.querySelector('.overlay-card');
    if (card) {
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
    }
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // ===================== 输入 =====================
  const KEY_DIRS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };

  function pressDir(d) {
    if (!G.heldDirs.includes(d)) G.heldDirs.push(d);
  }
  function releaseDir(d) {
    const i = G.heldDirs.indexOf(d);
    if (i >= 0) G.heldDirs.splice(i, 1);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    ensureAudio();

    const d = KEY_DIRS[e.code];
    if (d) {
      pressDir(d);
      return;
    }

    if (e.code === 'Space') {
      if (G.state === 'menu' || G.state === 'gameover') startGame();
      else G.fireHeld = true;
      return;
    }
    if (e.code === 'Enter' && (G.state === 'menu' || G.state === 'gameover')) {
      startGame();
      return;
    }
    if (e.repeat) return;

    if (e.code === 'KeyP') togglePause();
    else if (e.code === 'KeyR') startGame();
    else if (e.code === 'KeyM') toggleMute();
  });

  window.addEventListener('keyup', (e) => {
    const d = KEY_DIRS[e.code];
    if (d) releaseDir(d);
    if (e.code === 'Space') G.fireHeld = false;
  });

  function toggleMute() {
    G.muted = !G.muted;
    muteBtn.textContent = G.muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', G.muted);
    if (!G.muted) sfx('spawn');
  }

  muteBtn.addEventListener('click', () => {
    ensureAudio();
    toggleMute();
  });

  startBtn.addEventListener('click', () => {
    ensureAudio();
    overlayAction();
  });

  // 触屏按键
  document.querySelectorAll('[data-key]').forEach((btn) => {
    const key = btn.dataset.key;

    const down = (e) => {
      e.preventDefault();
      ensureAudio();
      btn.classList.add('active');
      if (key === 'fire') G.fireHeld = true;
      else pressDir(key);
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (key === 'fire') G.fireHeld = false;
      else releaseDir(key);
    };

    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // 切到后台自动暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') togglePause();
  });

  // ===================== 初始化 =====================
  function loadPreview() {
    const rows = MAPS[0];
    G.tiles = rows.map((row) => row.padEnd(COLS, '.').slice(0, COLS).split(''));
    G.base = { col: 7, row: 14, x: 7 * TILE, y: 14 * TILE, size: TILE, alive: true };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (G.tiles[r][c] === 'E') {
          G.base = { col: c, row: r, x: c * TILE, y: r * TILE, size: TILE, alive: true };
        }
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  loadPreview();
  updateHUD();
  showOverlay({
    title: '坦克大战',
    text: '守住基地，消灭所有敌方坦克！',
    button: '开始游戏',
    action: startGame,
  });
  requestAnimationFrame(frame);
})();
