"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayBody = document.getElementById("overlay-body");
const scoreElement = document.getElementById("score");
const attackLabel = document.getElementById("power-level");
const bossTimerLabel = document.getElementById("boss-timer");

const ASSET_SOURCES = {
  background: "images/background_large_fish.png",
  player: "images/gold_fish.png",
  support_player: "images/red_fish.png",
  enemy1: "images/enemy_fish1.png",
  enemy2: "images/enemy_fish2.png",
  enemy3: "images/enemy_fish3.png",
  laser: "images/laser_shot.png",
  explosion: "images/explosion_effect.png",
  powerUpBlue: "images/drop_fish_blue.png",
  powerUpGold: "images/drop_fish_gold.png",
  effectStar: "images/effect_star.png",
};

const MAX_ATTACK_LEVEL = 16;
const ATTACK_MULTIPLIERS = Array.from(
  { length: MAX_ATTACK_LEVEL + 1 },
  (_, i) => i,
);

const MAX_SUPPORT_SHIPS = MAX_ATTACK_LEVEL - 1;
const SUPPORT_SHIP_COUNTS_BY_LEVEL = Array.from(
  { length: MAX_ATTACK_LEVEL + 1 },
  (_, level) =>
    Math.max(0, Math.min(level - 1, MAX_SUPPORT_SHIPS)),
);
const SUPPORT_COLUMN_ORDER = [1, 0, 2];
const SUPPORT_COLUMN_OFFSETS = [-70, 0, 70];
const SUPPORT_BASE_REST_DISTANCE = 72;
const SUPPORT_SEGMENT_SPACING = 58;
const BOSS_TIME_LIMIT = 60;
const BOSS_INITIAL_SPAWN_TIME = 20;
const BOSS_HOME_MARGIN = 120;
const BOSS_CHARGE_MIN_X = 160;
const BOSS_CHARGE_SPEED = 420;
const BOSS_RETREAT_SPEED = 320;
const BOSS_CHARGE_DURATION = 1.15;
const BOSS_IDLE_INTERVAL_MIN = 3.2;
const BOSS_IDLE_INTERVAL_MAX = 5.2;
const POWER_GLOW_PULSE_SPEED = 1.6;
const POWER_GLOW_BASE_RADIUS = 26;
const POWER_GLOW_RADIUS_PER_LEVEL = 7;
const POWER_GLOW_MAX_INTENSITY = 0.42;
const POWER_GLOW_ASPECT_RATIO = 0.65;
const POWER_GLOW_ORANGE_RGB = "255, 180, 68";

function getSupportCountForLevel(powerLevel) {
  const index = Math.min(
    SUPPORT_SHIP_COUNTS_BY_LEVEL.length - 1,
    Math.max(0, powerLevel),
  );
  return SUPPORT_SHIP_COUNTS_BY_LEVEL[index];
}

function computeSupportFormationSlots(count) {
  const slots = [];
  const targetCount = Math.min(count, MAX_SUPPORT_SHIPS);
  for (let i = 0; i < targetCount; i += 1) {
    slots.push(getSupportSlotForIndex(i));
  }
  return slots;
}

function getSupportSlotForIndex(index) {
  const cycleLength = SUPPORT_COLUMN_ORDER.length;
  const column = SUPPORT_COLUMN_ORDER[index % cycleLength];
  const row = Math.floor(index / cycleLength);
  return { column, row };
}

function formatSupportSlotKey(column, row) {
  return `${column}:${row}`;
}

const ENEMY_DEFS = {
  grunt: {
    sprite: "enemy1",
    width: 102,
    height: 84,
    speed: 230,
    hp: 1,
    points: 120,
    dropRate: 0.75,
    fireInterval: null,
  },
  midBoss: {
    sprite: "enemy2",
    width: 128,
    height: 104,
    speed: 170,
    hp: 3,
    points: 620,
    dropRate: 0.95,
    fireInterval: 2.4,
  },
  boss: {
    sprite: "enemy3",
//    width: 220,
//    height: 164,
    width: 440,
    height: 328,
    speed: 110,
    hp: 100,
    points: 3200,
    dropRate: 1,
    fireInterval: null,
  },
};

const KEY_BINDINGS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

const assets = {};
const inputState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

const pointerState = {
  active: false,
  id: null,
  type: null,
  x: canvas.width / 2,
  y: canvas.height / 2,
};

const enemyShots = [];
const enemies = [];
const powerUps = [];
const explosions = [];

let totalSupportShipsObtained = 0;

const MASK_SPRITE_KEYS = new Set([
  "enemy1",
  "enemy2",
  "enemy3",
  "player",
  "support_player",
]);

function createSpriteMask(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width === 0 || height === 0) {
    return null;
  }
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const context = offscreen.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, width, height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return offscreen;
}

let gameState = "loading";
let score = 0;
let lastTime = 0;
let backgroundOffset = 0;
let enemySpawnTimer = 0;
let midBossTimer = 0;
let bossTimer = 0;
let bossClock = 0;
let bossPresent = false;
let bossDefeated = false;
let roamingPowerUpTimer = 0;
let elapsedTime = 0;
let pendingGameClear = false;
let pendingGameClearTimer = 0;

class Player {
  constructor() {
    this.width = 84;
    this.height = 72;
    this.speed = 260;
    this.invincibleTimer = 0;
    this.lastMoveX = 0;
    this.lastMoveY = 0;
    this.orientationAngle = 0;
    this.attackCooldownTimer = 0;
    this.knockbackVelocityX = 0;
    this.supportShips = [];
    this.powerGlowPhase = 0;
    this.powerGlowActive = false;
    this.reset();
  }

  reset() {
    this.x = 120;
    this.y = canvas.height / 2 - this.height / 2;
    this.powerLevel = 1;
    this.invincibleTimer = 0;
    this.lastMoveX = 0;
    this.lastMoveY = 0;
    this.orientationAngle = 0;
    this.attackCooldownTimer = 0;
    this.knockbackVelocityX = 0;
    this.supportShips = [];
    this.powerGlowPhase = 0;
    this.powerGlowActive = false;
    this.syncSupportShips();
  }

  getBounds() {
    return {
      x: this.x + this.width * 0.18,
      y: this.y + this.height * 0.18,
      width: this.width * 0.64,
      height: this.height * 0.64,
    };
  }

  getCenter() {
    return {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2,
    };
  }

  getAttackDamage() {
    return ATTACK_MULTIPLIERS[this.powerLevel] || 0;
  }

  upgrade(type, amount = 1) {
    if (type === "power") {
      if (this.powerLevel >= MAX_ATTACK_LEVEL) {
        return false;
      }
      const previous = this.powerLevel;
      this.powerLevel = Math.min(
        MAX_ATTACK_LEVEL,
        this.powerLevel + Math.max(1, amount),
      );
      if (this.powerLevel !== previous) {
        this.syncSupportShips({ preserveExistingFormation: true });
        this.triggerPowerGlow();
        return true;
      }
      return false;
    }
    return false;
  }

  triggerPowerGlow() {
    if (this.powerLevel <= 1) {
      this.powerGlowActive = false;
      this.powerGlowPhase = 0;
      return;
    }
    this.powerGlowActive = true;
    this.powerGlowPhase = 0;
  }

  decreasePower() {
    const previous = this.powerLevel;
    this.powerLevel = Math.max(1, this.powerLevel - 1);
    this.syncSupportShips({ allowReplenish: false });
    if (this.powerLevel <= 1) {
      this.powerGlowActive = false;
      this.powerGlowPhase = 0;
    }
    return this.powerLevel !== previous;
  }

  removeSupportShipAt(index) {
    if (index < 0 || index >= this.supportShips.length) {
      return false;
    }
    this.supportShips.splice(index, 1);
    const previous = this.powerLevel;
    this.powerLevel = Math.max(1, this.powerLevel - 1);
    this.syncSupportShips({
      allowReplenish: false,
      preserveExistingFormation: true,
    });
    this.configureSupportFormation({ immediateAlign: false });
    if (this.powerLevel <= 1) {
      this.powerGlowActive = false;
      this.powerGlowPhase = 0;
    }
    return this.powerLevel !== previous;
  }

  applyKnockback(velocityX) {
    if (!Number.isFinite(velocityX)) {
      return;
    }
    if (this.knockbackVelocityX < 0 && velocityX < 0) {
      this.knockbackVelocityX = Math.min(this.knockbackVelocityX, velocityX);
    } else {
      this.knockbackVelocityX = velocityX;
    }
  }

  update(delta) {
    const previousX = this.x;
    const previousY = this.y;

    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - delta);
    }
    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - delta);
    }
    if (this.powerGlowActive) {
      this.powerGlowPhase =
        (this.powerGlowPhase + delta * POWER_GLOW_PULSE_SPEED) %
        (Math.PI * 2);
    } else {
      this.powerGlowPhase = 0;
    }

    if (pointerState.active) {
      const targetX = clamp(
        pointerState.x - this.width / 2,
        0,
        canvas.width - this.width,
      );
      const targetY = clamp(
        pointerState.y - this.height / 2,
        0,
        canvas.height - this.height,
      );
      const smoothing = Math.min(1, delta * 8);
      this.x += (targetX - this.x) * smoothing;
      this.y += (targetY - this.y) * smoothing;
    } else {
      const horizontal =
        (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
      const vertical =
        (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);

      let vx = 0;
      let vy = 0;
      if (horizontal !== 0 || vertical !== 0) {
        const length = Math.hypot(horizontal, vertical) || 1;
        vx = (horizontal / length) * this.speed;
        vy = (vertical / length) * this.speed;
      }

      this.x += vx * delta;
      this.y += vy * delta;
    }

    if (this.knockbackVelocityX !== 0) {
      this.x += this.knockbackVelocityX * delta;
      const decay = Math.exp(-6 * delta);
      this.knockbackVelocityX *= decay;
      if (Math.abs(this.knockbackVelocityX) < 8) {
        this.knockbackVelocityX = 0;
      }
    }

    this.x = clamp(this.x, 0, canvas.width - this.width);
    this.y = clamp(this.y, 0, canvas.height - this.height);

    const movementX = this.x - previousX;
    const movementY = this.y - previousY;
    this.updateOrientationAngle(movementX, movementY, delta);
    this.supportShips.forEach((ship) => {
      ship.update(delta);
    });
  }

  updateOrientationAngle(movementX, movementY, delta) {
    const velocityThreshold = 0.35;
    if (
      Math.abs(movementX) > velocityThreshold ||
      Math.abs(movementY) > velocityThreshold
    ) {
      this.lastMoveX = movementX;
      this.lastMoveY = movementY;
    } else {
      this.lastMoveX *= 0.8;
      this.lastMoveY *= 0.8;
      if (Math.abs(this.lastMoveX) < 0.05) {
        this.lastMoveX = 0;
      }
      if (Math.abs(this.lastMoveY) < 0.05) {
        this.lastMoveY = 0;
      }
    }

    const magnitude = Math.hypot(this.lastMoveX, this.lastMoveY);
    if (magnitude > 0.05) {
      const targetAngle = Math.atan2(this.lastMoveY, this.lastMoveX);
      const diff =
        ((targetAngle - this.orientationAngle + Math.PI) % (Math.PI * 2)) -
        Math.PI;
      const smoothing = Math.min(1, delta * 10);
      this.orientationAngle += diff * smoothing;
    }
  }

  draw() {
    const sprite = assets.player;
    const mask = assets.playerMask;
    const supportSprite = assets.support_player || sprite;
    const supportMask = assets.support_playerMask || mask;
    this.supportShips.forEach((ship) =>
      ship.draw(supportSprite, supportMask, this.invincibleTimer),
    );
    this.drawPowerGlow();
    if (
      this.invincibleTimer > 0 &&
      Math.floor(this.invincibleTimer * 12) % 2 === 0
    ) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      this.drawRotatedSprite(sprite);
      ctx.restore();
    } else {
      this.drawRotatedSprite(sprite);
    }
  }

  syncSupportShips(options = {}) {
    const {
      allowReplenish = true,
      preserveExistingFormation = false,
    } = options;
    const desired = getSupportCountForLevel(this.powerLevel);
    const previousCount = this.supportShips.length;

    if (this.supportShips.length > desired) {
      this.supportShips.splice(desired);
    }
    const trimmed = this.supportShips.length < previousCount;

    const addedIndices = [];
    if (allowReplenish) {
      while (this.supportShips.length < desired) {
        const ship = new SupportShip();
        this.supportShips.push(ship);
        addedIndices.push(this.supportShips.length - 1);
        totalSupportShipsObtained += 1;
      }
    }

    if (preserveExistingFormation) {
      addedIndices.forEach((index) => {
        this.configureSupportShipAt(index);
      });
      if (trimmed) {
        this.configureSupportFormation({ immediateAlign: false });
      }
      return;
    }

    if (trimmed || addedIndices.length > 0) {
      this.configureSupportFormation();
    }
  }

  configureSupportFormation(options = {}) {
    const { immediateAlign = true } = options;
    const count = this.supportShips.length;
    if (count === 0) {
      return;
    }
    const slots = computeSupportFormationSlots(count);
    const slotIndexMap = new Map();
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const ship = this.supportShips[i];
      ship.setFormation(slot.column, slot.row);
      slotIndexMap.set(formatSupportSlotKey(slot.column, slot.row), i);
    }
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const ship = this.supportShips[i];
      if (slot.row === 0) {
        if (immediateAlign) {
          ship.alignToLeader(this);
        } else {
          ship.setLeaderReference(this);
        }
      } else {
        const leaderIndex = slotIndexMap.get(
          formatSupportSlotKey(slot.column, slot.row - 1),
        );
        const leader =
          leaderIndex !== undefined
            ? this.supportShips[leaderIndex]
            : this;
        if (immediateAlign) {
          ship.alignToLeader(leader);
        } else {
          ship.setLeaderReference(leader);
        }
      }
    }
  }

  configureSupportShipAt(index) {
    const ship = this.supportShips[index];
    if (!ship) {
      return;
    }
    const slot = getSupportSlotForIndex(index);
    ship.setFormation(slot.column, slot.row);
    if (slot.row === 0) {
      ship.alignToLeader(this);
      return;
    }
    const leader = this.findSupportLeaderForSlot(
      slot.column,
      slot.row - 1,
      index,
    );
    ship.alignToLeader(leader ?? this);
  }

  findSupportLeaderForSlot(column, row, ignoreIndex) {
    for (let i = 0; i < this.supportShips.length; i += 1) {
      if (i === ignoreIndex) {
        continue;
      }
      const candidate = this.supportShips[i];
      if (
        candidate.columnIndex === column &&
        candidate.rowIndex === row
      ) {
        return candidate;
      }
    }
    return null;
  }

  drawRotatedSprite(image) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(this.orientationAngle);
    ctx.drawImage(
      image,
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
    );
    ctx.restore();
  }

  drawPowerGlow() {
    if (!this.powerGlowActive || this.powerLevel <= 1) {
      return;
    }
    const pulse = 0.6 + 0.4 * Math.sin(this.powerGlowPhase);
    const intensity = Math.max(0, Math.min(1, pulse)) * POWER_GLOW_MAX_INTENSITY;
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    const levelFactor = Math.max(0, this.powerLevel - 1);
    const radius =
      POWER_GLOW_BASE_RADIUS + POWER_GLOW_RADIUS_PER_LEVEL * levelFactor;
    const innerRadius = radius * 0.35;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.globalCompositeOperation = "lighter";
    ctx.scale(1, POWER_GLOW_ASPECT_RATIO);
    const gradient = ctx.createRadialGradient(0, 0, innerRadius, 0, 0, radius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
    gradient.addColorStop(
      0.45,
      `rgba(${POWER_GLOW_ORANGE_RGB}, ${intensity * 0.8})`,
    );
    gradient.addColorStop(
      0.8,
      `rgba(${POWER_GLOW_ORANGE_RGB}, ${intensity * 0.25})`,
    );
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class SupportShip {
  constructor() {
    this.width = 56;
    this.height = 48;
    this.x = canvas.width / 2 - this.width / 2;
    this.y = canvas.height / 2 - this.height / 2;
    this.vx = 0;
    this.vy = 0;
    this.restDistance = SUPPORT_BASE_REST_DISTANCE;
    this.stiffness = 18;
    this.damping = 3;
    this.orientationAngle = 0;
    this.maxHits = 10;
    this.remainingHits = this.maxHits;
    this.columnIndex = 1;
    this.rowIndex = 0;
    this.lateralOffset = 0;
    this.leader = null;
    this.damageFlashTimer = 0;
  }

  setFormation(columnIndex, rowIndex) {
    this.columnIndex = columnIndex;
    this.rowIndex = rowIndex;
    this.restDistance =
      rowIndex === 0 ? SUPPORT_BASE_REST_DISTANCE : SUPPORT_SEGMENT_SPACING;
    this.lateralOffset =
      rowIndex === 0 && SUPPORT_COLUMN_OFFSETS[columnIndex] !== undefined
        ? SUPPORT_COLUMN_OFFSETS[columnIndex]
        : 0;
  }

  alignToLeader(leader) {
    if (leader) {
      this.leader = leader;
    }
    if (!this.leader) {
      return;
    }
    const target = this.getTargetPosition();
    this.x = clamp(
      target.x - this.width / 2,
      0,
      canvas.width - this.width,
    );
    this.y = clamp(
      target.y - this.height / 2,
      0,
      canvas.height - this.height,
    );
    this.vx = 0;
    this.vy = 0;
    this.orientationAngle = this.getLeaderAngle();
  }

  setLeaderReference(leader) {
    this.leader = leader || null;
  }

  getLeaderAngle() {
    if (
      this.leader &&
      typeof this.leader.orientationAngle === "number"
    ) {
      return this.leader.orientationAngle;
    }
    return 0;
  }

  getTargetPosition() {
    if (!this.leader) {
      const { x, y } = this.getCenter();
      return { x, y };
    }
    const leaderCenter = this.leader.getCenter();
    const baseAngle = this.getLeaderAngle();
    const backwardAngle = baseAngle + Math.PI;
    const lateralAngle = baseAngle + Math.PI / 2;
    const offsetX =
      Math.cos(backwardAngle) * this.restDistance +
      Math.cos(lateralAngle) * this.lateralOffset;
    const offsetY =
      Math.sin(backwardAngle) * this.restDistance +
      Math.sin(lateralAngle) * this.lateralOffset;
    return {
      x: leaderCenter.x + offsetX,
      y: leaderCenter.y + offsetY,
    };
  }

  update(delta) {
    if (!this.leader) {
      return;
    }
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - delta);
    }
    const target = this.getTargetPosition();
    const { x: centerX, y: centerY } = this.getCenter();
    const dx = target.x - centerX;
    const dy = target.y - centerY;
    this.vx += dx * this.stiffness * delta;
    this.vy += dy * this.stiffness * delta;
    const dampingFactor = Math.exp(-this.damping * delta);
    this.vx *= dampingFactor;
    this.vy *= dampingFactor;

    this.x += this.vx * delta;
    this.y += this.vy * delta;

    this.x = clamp(this.x, 0, canvas.width - this.width);
    this.y = clamp(this.y, 0, canvas.height - this.height);

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 6) {
      this.orientationAngle = Math.atan2(this.vy, this.vx);
    } else {
      const leaderAngle = this.getLeaderAngle();
      const diff =
        ((leaderAngle - this.orientationAngle + Math.PI) % (Math.PI * 2)) -
        Math.PI;
      this.orientationAngle += diff * Math.min(1, delta * 4);
    }
  }

  draw(sprite, mask, invincibleTimer) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(this.orientationAngle);
    if (
      invincibleTimer > 0 &&
      Math.floor(invincibleTimer * 12) % 2 === 0
    ) {
      ctx.globalAlpha = 0.45;
    }
    ctx.drawImage(
      sprite,
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
    );
    if (this.damageFlashTimer > 0) {
      if (mask) {
        ctx.globalCompositeOperation = "difference";
        ctx.drawImage(
          mask,
          -this.width / 2,
          -this.height / 2,
          this.width,
          this.height,
        );
      } else {
        ctx.globalCompositeOperation = "source-atop";
        ctx.filter = "invert(100%)";
        ctx.drawImage(
          sprite,
          -this.width / 2,
          -this.height / 2,
          this.width,
          this.height,
        );
      }
    }
    ctx.restore();
  }

  getBounds() {
    return {
      x: this.x + this.width * 0.2,
      y: this.y + this.height * 0.2,
      width: this.width * 0.6,
      height: this.height * 0.6,
    };
  }

  getCenter() {
    return {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2,
    };
  }

  absorbHit() {
    this.remainingHits = Math.max(0, this.remainingHits - 1);
    this.damageFlashTimer = Math.max(this.damageFlashTimer, 0.18);
    return this.remainingHits <= 0;
  }
}

class EnemyShot {
  constructor(x, y, vx, vy) {
    this.width = 56;
    this.height = 16;
    this.x = x;
    this.y = y - this.height / 2;
    this.vx = vx;
    this.vy = vy;
  }

  update(delta) {
    this.x += this.vx * delta;
    this.y += this.vy * delta;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
    ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.filter = "hue-rotate(180deg)";
    ctx.drawImage(assets.laser, -this.width / 2, -this.height / 2, this.width, this.height);
    ctx.filter = "none";
    ctx.restore();
  }

  getBounds() {
    return {
      x: this.x + 6,
      y: this.y + 4,
      width: this.width - 12,
      height: this.height - 8,
    };
  }

  get isOffscreen() {
    return (
      this.x + this.width < -120 ||
      this.x - this.width > canvas.width + 120 ||
      this.y > canvas.height + 120 ||
      this.y + this.height < -120
    );
  }
}

class Enemy {
  constructor(type) {
    this.type = type;
    const def = ENEMY_DEFS[type];
    this.width = def.width;
    this.height = def.height;
    this.hp = def.hp;
    this.points = def.points;
    this.dropRate = def.dropRate;
    this.baseSpeed = def.speed;
    this.x = canvas.width + Math.random() * 240;
    this.y = clamp(
      Math.random() * (canvas.height - this.height - 80) + 40,
      20,
      canvas.height - this.height - 20,
    );
    this.time = 0;
    this.seed = Math.random() * Math.PI * 2;
    this.fireInterval = def.fireInterval;
    this.fireTimer =
      def.fireInterval !== null
        ? def.fireInterval * (0.7 + Math.random() * 0.6)
        : null;
    this.hasEntered = false;
    this.damageFlashTimer = 0;
    if (this.type === "boss") {
      const idleX = canvas.width - this.width - BOSS_HOME_MARGIN;
      this.homeX = Math.max(idleX, canvas.width * 0.35);
      this.chargeTargetX = Math.max(this.homeX - 420, BOSS_CHARGE_MIN_X);
      this.chargeSpeed = BOSS_CHARGE_SPEED;
      this.retreatSpeed = BOSS_RETREAT_SPEED;
      this.bossState = "approach";
      this.bossCooldown =
        BOSS_IDLE_INTERVAL_MIN +
        Math.random() * (BOSS_IDLE_INTERVAL_MAX - BOSS_IDLE_INTERVAL_MIN);
      this.bossChargeTimer = 0;
    }
  }

  update(delta) {
    this.time += delta;
    const drift = Math.sin(this.time * 3 + this.seed);
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - delta);
    }

    if (this.type === "grunt") {
      this.x -= this.baseSpeed * delta;
      this.y += drift * 28 * delta;
    } else if (this.type === "midBoss") {
      this.x -= this.baseSpeed * delta;
      this.y += Math.sin(this.time * 2 + this.seed) * 140 * delta;
    } else if (this.type === "boss") {
      if (!this.hasEntered) {
        this.x -= this.baseSpeed * delta * 0.7;
        if (this.x <= this.homeX) {
          this.x = this.homeX;
          this.hasEntered = true;
          this.bossState = "idle";
          this.bossCooldown =
            BOSS_IDLE_INTERVAL_MIN +
            Math.random() *
              (BOSS_IDLE_INTERVAL_MAX - BOSS_IDLE_INTERVAL_MIN);
        }
      } else {
        this.y += Math.sin(this.time * 1.6 + this.seed) * 160 * delta;
        if (this.bossState === "idle") {
          this.x += (this.homeX - this.x) * Math.min(1, delta * 8);
          this.bossCooldown -= delta;
          if (this.bossCooldown <= 0) {
            this.bossState = "charging";
            this.bossChargeTimer = BOSS_CHARGE_DURATION;
          }
        } else if (this.bossState === "charging") {
          this.x -= this.chargeSpeed * delta;
          this.bossChargeTimer -= delta;
          if (this.x <= this.chargeTargetX || this.bossChargeTimer <= 0) {
            this.bossState = "retreat";
          }
        } else if (this.bossState === "retreat") {
          this.x += this.retreatSpeed * delta;
          if (this.x >= this.homeX) {
            this.x = this.homeX;
            this.bossState = "idle";
            this.bossCooldown =
              BOSS_IDLE_INTERVAL_MIN +
              Math.random() *
                (BOSS_IDLE_INTERVAL_MAX - BOSS_IDLE_INTERVAL_MIN);
          }
        }
      }
    }

    this.y = clamp(this.y, 12, canvas.height - this.height - 12);

    if (this.fireTimer !== null) {
      this.fireTimer -= delta;
      if (this.fireTimer <= 0) {
        this.shoot();
        const def = ENEMY_DEFS[this.type];
        this.fireTimer = def.fireInterval * (0.75 + Math.random() * 0.7);
      }
    }
  }

  shoot() {
    if (this.type === "midBoss") {
      const bulletSpeed = 260;
      enemyShots.push(
        new EnemyShot(
          this.x,
          this.y + this.height / 2,
          -bulletSpeed,
          0,
        ),
      );
    }
  }

  takeDamage(amount) {
    this.hp -= amount;
    this.damageFlashTimer = Math.max(this.damageFlashTimer, 0.18);
  }

  get isDead() {
    return this.hp <= 0;
  }

  get isOffscreen() {
    return this.x + this.width < -260;
  }

  draw() {
    const def = ENEMY_DEFS[this.type];
    const spriteKey = def.sprite;
    const sprite = assets[spriteKey];
    if (!sprite) {
      return;
    }
    ctx.drawImage(sprite, this.x, this.y, this.width, this.height);
    if (this.damageFlashTimer <= 0) {
      return;
    }
    const maskKey = `${spriteKey}Mask`;
    const mask = assets[maskKey];
    if (mask) {
      ctx.save();
      ctx.globalCompositeOperation = "difference";
      ctx.drawImage(mask, this.x, this.y, this.width, this.height);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.filter = "invert(100%)";
      ctx.drawImage(sprite, this.x, this.y, this.width, this.height);
      ctx.restore();
    }
  }

  getBounds() {
    return {
      x: this.x + this.width * 0.12,
      y: this.y + this.height * 0.18,
      width: this.width * 0.76,
      height: this.height * 0.64,
    };
  }
}

class PowerUp {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.width = 48;
    this.height = 48;
    this.time = 0;
    this.spriteKey = options.spriteKey || "powerUpBlue";
    this.powerAmount =
      options.powerAmount !== undefined
        ? Math.max(1, Math.floor(options.powerAmount))
        : 1;
  }

  update(delta) {
    this.time += delta;
    this.x -= 180 * delta;
    this.y += Math.sin(this.time * 3) * 60 * delta;
    this.y = clamp(this.y, 12, canvas.height - this.height - 12);
  }

  draw() {
    const sprite = assets[this.spriteKey] || assets.powerUpBlue;
    if (sprite) {
      ctx.drawImage(sprite, this.x, this.y, this.width, this.height);
    }
    ctx.save();
    // Uncomment below to show "help" text on power-up
    //ctx.font = "bold 16px 'Segoe UI'";
    //ctx.textAlign = "center";
    //ctx.fillStyle = "#ffffff";
    //ctx.fillText("help", this.x + this.width / 2, this.y + this.height / 2 + 6);
    ctx.restore();
  }

  getBounds() {
    return {
      x: this.x + 8,
      y: this.y + 8,
      width: this.width - 16,
      height: this.height - 16,
    };
  }

  get isOffscreen() {
    return this.x + this.width < -120;
  }
}

class Explosion {
  constructor(x, y, size, options = {}) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.elapsed = 0;
    this.duration =
      typeof options.duration === "number" ? options.duration : 0.55;
    this.spriteKey =
      typeof options.spriteKey === "string" && options.spriteKey.length > 0
        ? options.spriteKey
        : "explosion";
  }

  update(delta) {
    this.elapsed += delta;
  }

  draw() {
    const progress = clamp(this.elapsed / this.duration, 0, 1);
    const scale = 0.7 + progress * 1.6;
    const alpha = 1 - progress;
    const sprite = assets[this.spriteKey] || assets.explosion;
    if (!sprite) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      sprite,
      this.x - (this.size * scale) / 2,
      this.y - (this.size * scale) / 2,
      this.size * scale,
      this.size * scale,
    );
    ctx.restore();
  }

  get done() {
    return this.elapsed >= this.duration;
  }
}

const player = new Player();

function loadAssets() {
  const entries = Object.entries(ASSET_SOURCES);
  return Promise.all(
    entries.map(
      ([key, src]) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.src = src;
          img.onload = () => {
            assets[key] = img;
            if (MASK_SPRITE_KEYS.has(key)) {
              const mask = createSpriteMask(img);
              if (mask) {
                assets[`${key}Mask`] = mask;
              }
            }
            resolve();
          };
          img.onerror = reject;
        }),
    ),
  );
}

function updateGame(delta) {
  elapsedTime += delta;
  backgroundOffset = (backgroundOffset + 90 * delta) % canvas.width;

  player.update(delta);

  updateEnemyShots(delta);
  updateEnemies(delta);
  updatePowerUps(delta);
  updateExplosions(delta);

  handleCollisions();
  handleSpawns(delta);
  updateBossClock(delta);
  updateBossTimerLabel();
  updatePendingGameClear(delta);
}

function updateEnemyShots(delta) {
  for (let i = enemyShots.length - 1; i >= 0; i -= 1) {
    const shot = enemyShots[i];
    shot.update(delta);
    if (shot.isOffscreen) {
      enemyShots.splice(i, 1);
    }
  }
}

function updateEnemies(delta) {
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    enemy.update(delta);

    if (enemy.isDead) {
      onEnemyDefeated(enemy);
      enemies.splice(i, 1);
      continue;
    }

    if (enemy.isOffscreen) {
      if (enemy.type === "boss") {
        bossPresent = false;
        bossClock = 0;
        updateBossTimerLabel();
      }
      enemies.splice(i, 1);
    }
  }
}

function updatePowerUps(delta) {
  for (let i = powerUps.length - 1; i >= 0; i -= 1) {
    const item = powerUps[i];
    item.update(delta);
    if (item.isOffscreen) {
      powerUps.splice(i, 1);
    }
  }
}

function updateExplosions(delta) {
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const boom = explosions[i];
    boom.update(delta);
    if (boom.done) {
      explosions.splice(i, 1);
    }
  }
}

function handleSpawns(delta) {
  if (pendingGameClear) {
    return;
  }
  const spawnInterval = Math.max(0.9, 2.1 - elapsedTime * 0.008);
  enemySpawnTimer -= delta;
  if (enemySpawnTimer <= 0) {
    spawnEnemy("grunt");
    enemySpawnTimer = spawnInterval;
  }

  midBossTimer -= delta;
  if (midBossTimer <= 0 && !enemies.some((e) => e.type === "midBoss")) {
    spawnEnemy("midBoss");
    midBossTimer = 10 + Math.random() * 6;
  }

  bossTimer -= delta;
  if (bossTimer <= 0 && !bossPresent && !bossDefeated) {
    spawnEnemy("boss");
    bossTimer = 0;
  }

  roamingPowerUpTimer -= delta;
  if (roamingPowerUpTimer <= 0) {
    spawnPowerUp(
      canvas.width + 80,
      Math.random() * (canvas.height - 120) + 60,
    );
    roamingPowerUpTimer = 8 + Math.random() * 6;
  }
}

function spawnEnemy(type) {
  const enemy = new Enemy(type);
  enemies.push(enemy);
  if (type === "boss") {
    bossPresent = true;
    bossClock = 0;
    updateBossTimerLabel();
  }
}

function spawnPowerUp(x, y, options) {
  powerUps.push(new PowerUp(x, y, options));
}

function resolveEnemyDropConfig(enemy) {
  if (enemy.type === "midBoss") {
    return {
      spriteKey: "powerUpGold",
      powerAmount: 5,
    };
  }
  return {
    spriteKey: "powerUpBlue",
    powerAmount: 1,
  };
}

function onEnemyDefeated(enemy) {
  score += enemy.points;
  updateHud();
  explosions.push(
    new Explosion(
      enemy.x + enemy.width / 2,
      enemy.y + enemy.height / 2,
      Math.max(enemy.width, enemy.height),
    ),
  );

  if (Math.random() < enemy.dropRate) {
    const dropX = clamp(
      enemy.x + enemy.width / 2 - 24,
      12,
      canvas.width - 48 - 12,
    );
    const dropY = clamp(
      enemy.y + enemy.height + 16,
      12,
      canvas.height - 48 - 12,
    );
    spawnPowerUp(dropX, dropY, resolveEnemyDropConfig(enemy));
  }

  if (enemy.type === "boss") {
    bossPresent = false;
    bossDefeated = true;
    bossClock = 0;
    updateBossTimerLabel();
    pendingGameClear = true;
    pendingGameClearTimer = 1.8;
  }
}

function updateBossClock(delta) {
  if (!bossPresent || bossDefeated) {
    return;
  }
  bossClock += delta;
  if (bossClock >= BOSS_TIME_LIMIT) {
    bossClock = BOSS_TIME_LIMIT;
    triggerBossTimeout();
  }
}

function updateBossTimerLabel() {
  if (!bossTimerLabel) {
    return;
  }
  if (!bossPresent || bossDefeated || gameState !== "running") {
    bossTimerLabel.textContent = `TIME: ${BOSS_TIME_LIMIT.toFixed(1)}`;
    bossTimerLabel.classList.add("hidden");
    return;
  }
  const remaining = Math.max(0, BOSS_TIME_LIMIT - bossClock);
  bossTimerLabel.textContent = `TIME: ${remaining.toFixed(1)}`;
  bossTimerLabel.classList.remove("hidden");
}

function updatePendingGameClear(delta) {
  if (!pendingGameClear || gameState !== "running") {
    return;
  }
  pendingGameClearTimer -= delta;
  if (pendingGameClearTimer <= 0) {
    pendingGameClear = false;
    triggerGameClear();
  }
}

function handleCollisions() {
  if (pendingGameClear) {
    return;
  }
  const playerBounds = player.getBounds();

  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    const enemyBounds = enemy.getBounds();
    let handledBySupport = false;

    for (let s = player.supportShips.length - 1; s >= 0; s -= 1) {
      const support = player.supportShips[s];
      const supportBounds = support.getBounds();
      if (rectsOverlap(supportBounds, enemyBounds)) {
        if (!enemy.isDead) {
          enemy.takeDamage(1);
        }
        if (enemy.isDead) {
          onEnemyDefeated(enemy);
          enemies.splice(i, 1);
          handledBySupport = true;
          break;
        }
        const supportCenter = support.getCenter();
        if (player.invincibleTimer <= 0) {
          const destroyed = support.absorbHit();
          const explosionSize = destroyed
            ? Math.max(96, Math.min(enemy.width, enemy.height))
            : Math.max(60, Math.min(enemy.width, enemy.height));
          explosions.push(
            new Explosion(supportCenter.x, supportCenter.y, explosionSize),
          );
          if (destroyed) {
            const levelChanged = player.removeSupportShipAt(s);
            if (levelChanged) {
              updateHud();
            }
          }
          if (enemy.type !== "boss") {
            const enemyCenterX = enemy.x + enemy.width / 2;
            const enemyCenterY = enemy.y + enemy.height / 2;
            const angle = Math.atan2(
              enemyCenterY - supportCenter.y,
              enemyCenterX - supportCenter.x,
            );
            const pushDistance = 60;
            enemy.x = clamp(
              enemy.x + Math.cos(angle) * pushDistance,
              -enemy.width,
              canvas.width,
            );
            enemy.y = clamp(
              enemy.y + Math.sin(angle) * pushDistance,
              -enemy.height,
              canvas.height - enemy.height,
            );
          }
        }
        handledBySupport = true;
        break;
      }
    }

    if (handledBySupport) {
      continue;
    }

    if (rectsOverlap(playerBounds, enemyBounds)) {
      if (player.attackCooldownTimer <= 0) {
        const damage = player.getAttackDamage();
        if (damage > 0) {
          enemy.takeDamage(damage);
          const defeated = enemy.isDead;
          if (defeated) {
            onEnemyDefeated(enemy);
            enemies.splice(i, 1);
            player.attackCooldownTimer = 0.28;
            break;
          } else {
            explosions.push(
              new Explosion(
                enemy.x + enemy.width / 2,
                enemy.y + enemy.height / 2,
                Math.max(72, Math.min(enemy.width, enemy.height)),
              ),
            );
          }
        }
        player.attackCooldownTimer = 0.28;
      }
      const immediateShift = 24;
      player.x = clamp(player.x - immediateShift, 0, canvas.width - player.width);
      player.y = clamp(player.y, 0, canvas.height - player.height);
      player.applyKnockback(-320);
      break;
    }
  }

  for (let i = enemyShots.length - 1; i >= 0; i -= 1) {
    const shot = enemyShots[i];
    const shotBounds = shot.getBounds();
    let blockedBySupport = false;

    for (let s = player.supportShips.length - 1; s >= 0; s -= 1) {
      const support = player.supportShips[s];
      if (rectsOverlap(support.getBounds(), shotBounds)) {
        enemyShots.splice(i, 1);
        if (player.invincibleTimer <= 0) {
          const supportCenter = support.getCenter();
          const destroyed = support.absorbHit();
          const explosionSize = destroyed ? 96 : 64;
          explosions.push(
            new Explosion(supportCenter.x, supportCenter.y, explosionSize),
          );
          if (destroyed) {
            const levelChanged = player.removeSupportShipAt(s);
            if (levelChanged) {
              updateHud();
            }
          }
        }
        blockedBySupport = true;
        break;
      }
    }

    if (blockedBySupport) {
      continue;
    }

    if (rectsOverlap(playerBounds, shotBounds)) {
      enemyShots.splice(i, 1);
      handlePlayerHit();
    }
  }

  for (let i = powerUps.length - 1; i >= 0; i -= 1) {
    const item = powerUps[i];
    if (rectsOverlap(playerBounds, item.getBounds())) {
      const applied = player.upgrade("power", item.powerAmount);
      if (!applied) {
        score += 200;
        updateHud();
      }
      powerUps.splice(i, 1);
      explosions.push(
        new Explosion(
          player.x + player.width / 2,
          player.y + player.height / 2,
          80,
          { spriteKey: "effectStar" },
        ),
      );
      updateHud();
    }
  }
}

function handlePlayerHit() {
  if (player.invincibleTimer > 0) {
    return;
  }

  player.decreasePower();
  updateHud();
  explosions.push(
    new Explosion(
      player.x + player.width / 2,
      player.y + player.height / 2,
      96,
    ),
  );
  player.invincibleTimer = 1.2;
  player.attackCooldownTimer = 0;
}

function drawGame() {
  drawBackground();
  drawEnemyShots();
  drawPowerUps();
  drawEnemies();
  player.draw();
  drawExplosions();
}

function drawBackground() {
  const bg = assets.background;
  if (!bg) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const offset = backgroundOffset % canvas.width;
  ctx.drawImage(bg, -offset, 0, canvas.width, canvas.height);
  ctx.drawImage(bg, canvas.width - offset, 0, canvas.width, canvas.height);
}

function drawEnemyShots() {
  enemyShots.forEach((shot) => shot.draw());
}

function drawEnemies() {
  enemies.forEach((enemy) => enemy.draw());
}

function drawPowerUps() {
  powerUps.forEach((item) => item.draw());
}

function drawExplosions() {
  explosions.forEach((boom) => boom.draw());
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateHud() {
  scoreElement.textContent = score.toString().padStart(6, "0");
  attackLabel.textContent = `ATTACK: ${player.powerLevel} / ${MAX_ATTACK_LEVEL}`;
}

function setOverlay(title, body) {
  overlayTitle.textContent = title;
  overlayBody.innerHTML = body;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function resetGame() {
  score = 0;
  elapsedTime = 0;
  backgroundOffset = 0;
  enemySpawnTimer = 1.2;
  midBossTimer = 12;
  bossTimer = BOSS_INITIAL_SPAWN_TIME;
  bossClock = 0;
  bossPresent = false;
  bossDefeated = false;
  roamingPowerUpTimer = 6;
  enemyShots.length = 0;
  enemies.length = 0;
  powerUps.length = 0;
  explosions.length = 0;
  totalSupportShipsObtained = 0;
  player.reset();
  updateBossTimerLabel();
  updateHud();
  pendingGameClear = false;
  pendingGameClearTimer = 0;
}

function startGame() {
  if (gameState === "loading") {
    return;
  }
  resetGame();
  hideOverlay();
  gameState = "running";
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function triggerGameOver() {
  if (gameState !== "running") {
    return;
  }
  gameState = "gameover";
  updateBossTimerLabel();
  setOverlay(
    "武装が停止しました",
    `SCORE: ${score.toString().padStart(6, "0")} / スペースキー または タップ・クリックで再スタート`,
  );
}

function triggerBossTimeout() {
  if (gameState !== "running") {
    return;
  }
  bossPresent = false;
  bossClock = 0;
  gameState = "gameover";
  updateBossTimerLabel();
  setOverlay(
    "時間切れ",
    `SCORE: ${score.toString().padStart(6, "0")} / ボスを${BOSS_TIME_LIMIT}秒以内に撃破できませんでした。スペースキー または タップ・クリックで再スタート`,
  );
}

function triggerGameClear() {
  if (gameState !== "running") {
    return;
  }
  bossPresent = false;
  bossClock = 0;
  gameState = "gameover";
  updateBossTimerLabel();
  const formattedScore = score.toString().padStart(6, "0");
  const remainingSupportShips = player.supportShips.length;
  const messageLines = [
    `<font color="red">SCORE: ${formattedScore}</font>`,
    `🐟️<font color="pink">助けたスクミー: ${totalSupportShipsObtained}匹</font>`,
    `🐟️<font color="green">生き残ったスクミー: ${remainingSupportShips}匹</font>`,
    "スペースキー または タップ・クリックで再スタート",
  ];
  setOverlay(
    "BOSS 撃破！",
    messageLines.join("<br/>"),
  );
  pendingGameClear = false;
  pendingGameClearTimer = 0;
}

function loop(timestamp) {
  if (gameState !== "running") {
    return;
  }

  const delta = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  updateGame(delta);
  drawGame();

  if (gameState === "running") {
    requestAnimationFrame(loop);
  }
}

function handleKeyDown(event) {
  const key = event.key;
  if (key in KEY_BINDINGS) {
    inputState[KEY_BINDINGS[key]] = true;
    event.preventDefault();
  }

  if (key.length === 1 && KEY_BINDINGS[key.toLowerCase()]) {
    inputState[KEY_BINDINGS[key.toLowerCase()]] = true;
    event.preventDefault();
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (gameState === "ready" || gameState === "gameover") {
      startGame();
    }
  }
}

function handleKeyUp(event) {
  const key = event.key;
  if (key in KEY_BINDINGS) {
    inputState[KEY_BINDINGS[key]] = false;
    event.preventDefault();
  }

  if (key.length === 1 && KEY_BINDINGS[key.toLowerCase()]) {
    inputState[KEY_BINDINGS[key.toLowerCase()]] = false;
    event.preventDefault();
  }
}

function updatePointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  pointerState.x =
    ((event.clientX - rect.left) / rect.width) * canvas.width;
  pointerState.y =
    ((event.clientY - rect.top) / rect.height) * canvas.height;
}

function setPointerCaptureSafe(target, pointerId) {
  if (!target || typeof target.setPointerCapture !== "function") {
    return;
  }
  try {
    target.setPointerCapture(pointerId);
  } catch (error) {
    // ignore capture errors
  }
}

function releasePointerCaptureSafe(target, pointerId) {
  if (!target || typeof target.releasePointerCapture !== "function") {
    return;
  }
  try {
    if (
      typeof target.hasPointerCapture !== "function" ||
      target.hasPointerCapture(pointerId)
    ) {
      target.releasePointerCapture(pointerId);
    }
  } catch (error) {
    // ignore release errors
  }
}

function handlePointerDown(event) {
  if (!pointerState.active || pointerState.type === "mouse" || pointerState.id === event.pointerId) {
    pointerState.active = true;
    pointerState.id = event.pointerId;
    pointerState.type = event.pointerType;
    updatePointerFromEvent(event);
    setPointerCaptureSafe(event.currentTarget, event.pointerId);
  }
  if (gameState === "ready" || gameState === "gameover") {
    startGame();
  }
  event.preventDefault();
}

function handlePointerMove(event) {
  if (pointerState.active && event.pointerId === pointerState.id) {
    updatePointerFromEvent(event);
    event.preventDefault();
  } else if (event.pointerType === "mouse") {
    updatePointerFromEvent(event);
  }
}

function releasePointerIfNeeded(event) {
  releasePointerCaptureSafe(event.currentTarget, event.pointerId);
  releasePointerCaptureSafe(canvas, event.pointerId);
  releasePointerCaptureSafe(overlay, event.pointerId);
}

function handlePointerUp(event) {
  if (event.pointerId === pointerState.id) {
    pointerState.active = false;
    pointerState.id = null;
    pointerState.type = null;
  }
  releasePointerIfNeeded(event);
  event.preventDefault();
}

function handlePointerCancel(event) {
  handlePointerUp(event);
}

function handlePointerLeave() {
  pointerState.active = false;
  pointerState.id = null;
  pointerState.type = null;
}

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerCancel);
canvas.addEventListener("pointerleave", handlePointerLeave);
canvas.addEventListener("pointerout", handlePointerLeave);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
overlay.addEventListener("pointerdown", handlePointerDown);
overlay.addEventListener("pointermove", handlePointerMove);
overlay.addEventListener("pointerup", handlePointerUp);
overlay.addEventListener("pointercancel", handlePointerCancel);
overlay.addEventListener("pointerleave", handlePointerLeave);
overlay.addEventListener("pointerout", handlePointerLeave);

function init() {
  setOverlay("読み込み中…", "少しだけお待ちください");
  loadAssets()
    .then(() => {
      gameState = "ready";
      updateHud();
      setOverlay(
        "そうだ！みんなで集まるんだ！",
        "スペースキー または タップ・クリックでスタート/体当たりで攻撃！",
      );
      drawBackground();
      player.draw();
    })
    .catch((error) => {
      console.error("Failed to load assets", error);
      setOverlay("エラー", "画像の読み込みに失敗しました。再読み込みしてください。");
    });
}

window.addEventListener("load", init);
