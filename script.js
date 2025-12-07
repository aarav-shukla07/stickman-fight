const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Audio System (Synthesized - Soft & Clicky) ---
const AudioSys = {
    ctx: null,
    init: function () {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    },
    playTone: function (freq, type, duration, vol = 0.1, slide = 0) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        if (slide !== 0) {
            osc.frequency.exponentialRampToValueAtTime(freq + slide, this.ctx.currentTime + duration);
        }
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    playNoise: function (duration, vol = 0.2) {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        // Soft envelope
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        noise.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
    },
    playJump: function () { this.playTone(200, 'sine', 0.15, 0.1, 50); },
    playWhoosh: function () { this.playNoise(0.15, 0.05); },
    playHit: function (heavy = false) {
        this.playNoise(0.2, 0.15);
        this.playTone(heavy ? 60 : 120, 'triangle', 0.1, 0.1, -30);
    },
    playSelect: function () { this.playTone(600, 'sine', 0.1, 0.05); }
};

// --- Game Constants ---
const GRAVITY = 0.7;
const FRICTION = 0.85; // Smoother slide
const MOVE_SPEED = 1.2;
const MAX_SPEED = 8;
const JUMP_FORCE = -15;
const STICKMAN_HEIGHT = 80;
const STICKMAN_WIDTH = 30;
const MAX_HP = 20;

// --- Weapon Definitions ---
const WEAPONS = {
    fists: { name: 'Fists', range: 50, speed: 15, cooldown: 25, damage: 1, color: '#333', type: 'blunt', knockback: 10 },
    sword: { name: 'Blade', range: 90, speed: 20, cooldown: 35, damage: 3, color: '#2d3436', type: 'edge', knockback: 12 },
    spear: { name: 'Lance', range: 130, speed: 30, cooldown: 45, damage: 2, color: '#636e72', type: 'range', knockback: 15 },
    hammer: { name: 'Maul', range: 70, speed: 40, cooldown: 60, damage: 5, color: '#2d3436', type: 'blunt', knockback: 25 },
    nunchucks: { name: 'Links', range: 60, speed: 10, cooldown: 20, damage: 1, color: '#b2bec3', type: 'blunt', knockback: 8 }
};

// --- Global Effects State ---
let shakeIntensity = 0;
let zoomScale = 1.0;
let particles = [];
let trails = [];

// --- Canvas Setup ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Input Handling ---
const keys = {
    a: false, d: false, w: false, s: false, ' ': false
};

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    if (key === ' ') {
        keys[' '] = true;
        e.preventDefault(); // Prevent scrolling or button activation
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
    if (key === ' ') keys[' '] = false;
});

// --- Classes ---

class Particle {
    constructor(x, y, color, type = 'circle') {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
        this.color = color;
        this.size = Math.random() * 6 + 2;
        this.type = type; // 'circle', 'ink'
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.95; // Drag
        this.vy *= 0.95;
        this.life -= this.decay;
        if (this.type === 'ink') this.size += 0.2; // Ink spreads
    }
    draw(ctx) {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        if (this.type === 'ink') {
            // Irregular blob
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.arc(this.x + 2, this.y - 2, this.size * 0.6, 0, Math.PI * 2);
        } else {
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class Player {
    constructor(x, isAI = false) {
        this.x = x;
        this.y = canvas.height - 150;
        this.vx = 0;
        this.vy = 0;
        this.isAI = isAI;
        this.hp = MAX_HP;
        this.facingRight = !isAI;
        this.weapon = WEAPONS.fists;

        // Combat State
        this.isAttacking = false;
        this.attackTimer = 0;
        this.cooldownTimer = 0;
        this.isGrounded = false;
        this.hitStun = 0;

        // Animation State
        this.idleTimer = 0;
        this.leanAngle = 0;

        // AI State
        this.aiState = 'IDLE';
        this.aiTimer = 0;
    }

    equip(weaponKey) {
        this.weapon = WEAPONS[weaponKey] || WEAPONS.fists;
    }

    update(opponent) {
        // Idle Animation
        this.idleTimer += 0.05;

        // Gravity
        this.vy += GRAVITY;
        this.y += this.vy;

        // Ground Collision
        const groundY = canvas.height - 150; // Higher ground for aesthetics
        if (this.y + STICKMAN_HEIGHT >= groundY) {
            this.y = groundY - STICKMAN_HEIGHT;
            this.vy = 0;
            this.isGrounded = true;
        } else {
            this.isGrounded = false;
        }

        // Hit Stun
        if (this.hitStun > 0) {
            this.hitStun--;
            this.vx *= 0.9;
            this.x += this.vx;
            this.checkBoundaries();
            return;
        }

        // Control
        if (this.isAI) {
            this.updateAI(opponent);
        } else {
            this.updatePlayerInput();
        }

        // Physics & Lean
        this.vx *= FRICTION;
        this.x += this.vx;

        // Calculate lean based on velocity
        const targetLean = (this.vx / MAX_SPEED) * 0.3;
        this.leanAngle += (targetLean - this.leanAngle) * 0.2;

        this.checkBoundaries();

        // Attack Logic
        if (this.cooldownTimer > 0) this.cooldownTimer--;

        if (this.isAttacking) {
            this.attackTimer--;
            const hitFrame = Math.floor(this.weapon.speed / 2);
            if (this.attackTimer === hitFrame) {
                this.checkHit(opponent);
            }
            if (this.attackTimer <= 0) {
                this.isAttacking = false;
            }
        }
    }

    updatePlayerInput() {
        if (keys.a) { this.vx -= MOVE_SPEED; this.facingRight = false; }
        if (keys.d) { this.vx += MOVE_SPEED; this.facingRight = true; }
        if (keys.w && this.isGrounded) {
            this.vy = JUMP_FORCE;
            this.isGrounded = false;
            AudioSys.playJump();
        }
        if ((keys[' '] || keys.s) && this.cooldownTimer === 0 && !this.isAttacking) {
            this.attack();
        }
    }

    updateAI(opponent) {
        const dist = opponent.x - this.x;
        const absDist = Math.abs(dist);
        this.facingRight = dist > 0;

        if (this.aiTimer > 0) this.aiTimer--;

        if (this.aiTimer === 0) {
            const idealRange = this.weapon.range * 0.8;
            if (absDist < idealRange + 20) {
                this.aiState = Math.random() < 0.7 ? 'ATTACK' : 'RETREAT';
                this.aiTimer = 15;
            } else if (absDist < 500) {
                this.aiState = 'CHASE';
                this.aiTimer = 30;
            } else {
                this.aiState = 'IDLE';
                this.aiTimer = 40;
            }
        }

        switch (this.aiState) {
            case 'CHASE':
                this.vx += (dist > 0 ? 1 : -1) * MOVE_SPEED * 0.9;
                if (this.isGrounded && Math.random() < 0.01) this.vy = JUMP_FORCE;
                break;
            case 'RETREAT':
                this.vx += (dist > 0 ? -1 : 1) * MOVE_SPEED;
                break;
            case 'ATTACK':
                if (this.cooldownTimer === 0 && !this.isAttacking) {
                    if (Math.random() < 0.9) this.attack();
                }
                break;
        }
    }

    checkBoundaries() {
        if (this.x < 0) { this.x = 0; this.vx = 0; }
        if (this.x + STICKMAN_WIDTH > canvas.width) { this.x = canvas.width - STICKMAN_WIDTH; this.vx = 0; }
    }

    attack() {
        this.isAttacking = true;
        this.attackTimer = this.weapon.speed;
        this.cooldownTimer = this.weapon.cooldown;
        AudioSys.playWhoosh();
    }

    checkHit(opponent) {
        const reach = this.weapon.range;
        const hitX = this.facingRight ? this.x + STICKMAN_WIDTH : this.x - reach;
        const hitWidth = reach;

        // Simple AABB
        if (
            hitX < opponent.x + STICKMAN_WIDTH &&
            hitX + hitWidth > opponent.x &&
            Math.abs(this.y - opponent.y) < 50
        ) {
            opponent.takeDamage(this.facingRight ? 1 : -1, this.weapon);
        }
    }

    takeDamage(direction, weapon) {
        this.hp -= weapon.damage;
        this.hitStun = 15 + weapon.damage * 2;
        this.vx = direction * weapon.knockback;
        this.vy = -5 - (weapon.damage);

        // Juice
        shakeIntensity = 5 + weapon.damage * 2;
        zoomScale = 1.05;
        AudioSys.playHit(weapon.damage > 2);

        // Ink Particles
        const color = this.isAI ? '#d63031' : '#0984e3';
        spawnParticles(this.x + STICKMAN_WIDTH / 2, this.y + STICKMAN_HEIGHT / 2, 12, color, 'ink');

        updateHealthUI();
        checkWin();
    }

    draw() {
        ctx.save();

        // Apply Lean
        const pivotX = this.x + STICKMAN_WIDTH / 2;
        const pivotY = this.y + STICKMAN_HEIGHT;
        ctx.translate(pivotX, pivotY);
        ctx.rotate(this.leanAngle);
        ctx.translate(-pivotX, -pivotY);

        // Style
        ctx.strokeStyle = '#2d3436';
        ctx.fillStyle = '#2d3436';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const headRadius = 12;
        const centerX = this.x + STICKMAN_WIDTH / 2;
        // Bobbing effect
        const bobY = Math.sin(this.idleTimer) * 2;
        const bodyTop = this.y + headRadius * 2 + bobY;
        const bodyBottom = this.y + STICKMAN_HEIGHT - 25;

        ctx.beginPath();
        // Head
        ctx.arc(centerX, this.y + headRadius + bobY, headRadius, 0, Math.PI * 2);
        ctx.fill(); // Solid head for premium look

        // Body
        ctx.moveTo(centerX, bodyTop);
        ctx.lineTo(centerX, bodyBottom);

        // Legs
        const walkOffset = Math.sin(Date.now() / 80) * 15 * (Math.abs(this.vx) > 0.1 && this.isGrounded ? 1 : 0);
        ctx.moveTo(centerX, bodyBottom);
        ctx.lineTo(centerX - 10 + walkOffset, this.y + STICKMAN_HEIGHT);
        ctx.moveTo(centerX, bodyBottom);
        ctx.lineTo(centerX + 10 - walkOffset, this.y + STICKMAN_HEIGHT);

        // Arms & Weapon
        const armY = bodyTop + 15;
        const dir = this.facingRight ? 1 : -1;

        if (this.isAttacking) {
            const progress = 1 - (this.attackTimer / this.weapon.speed);
            const handX = centerX + 20 * dir;
            const handY = armY;

            ctx.moveTo(centerX, armY);
            ctx.lineTo(handX, handY);
            this.drawWeapon(handX, handY, progress, dir);
        } else {
            // Idle Arms
            const breathArm = Math.sin(this.idleTimer * 1.5) * 2;
            ctx.moveTo(centerX, armY);
            ctx.lineTo(centerX + 15 * dir, armY + 20 + breathArm);
            this.drawWeapon(centerX + 15 * dir, armY + 20 + breathArm, 0, dir, true);
            ctx.moveTo(centerX, armY);
            ctx.lineTo(centerX - 10 * dir, armY + 20 + breathArm);
        }

        ctx.stroke();
        ctx.restore();
    }

    drawWeapon(x, y, progress, dir, isIdle = false) {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = this.weapon.color;
        ctx.lineWidth = 4;

        if (isIdle) {
            ctx.rotate(dir * Math.PI / 3); // Hold weapon down
        } else {
            // Smooth Swing
            const startAngle = -Math.PI / 1.5;
            const endAngle = Math.PI / 1.5;
            // Ease out cubic
            const ease = 1 - Math.pow(1 - progress, 3);
            const currentAngle = startAngle + (endAngle - startAngle) * ease;
            ctx.rotate(dir * currentAngle);

            // Trail
            if (progress > 0.1 && progress < 0.9) {
                trails.push({
                    x: x + (Math.cos(dir * currentAngle) * this.weapon.range),
                    y: y + (Math.sin(dir * currentAngle) * this.weapon.range),
                    color: 'rgba(255,255,255,0.5)', // White swoosh
                    life: 0.3
                });
            }
        }

        ctx.beginPath();
        // Simple elegant shapes
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -this.weapon.range);

        if (this.weapon.name === 'Blade') {
            ctx.moveTo(0, -10); ctx.lineTo(5, -10);
        }
        if (this.weapon.name === 'Maul') {
            ctx.fillRect(-10, -this.weapon.range, 20, 15);
        }

        ctx.stroke();
        ctx.restore();
    }
}

// --- Game State ---
let player1, player2;
let gameRunning = false;
let selectedWeapon = null;

function spawnParticles(x, y, count, color, type) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color, type));
    }
}

function initGame() {
    resizeCanvas();
    player1 = new Player(200, false);
    player2 = new Player(canvas.width - 200, true);

    player1.equip(selectedWeapon || 'fists');
    const weaponKeys = Object.keys(WEAPONS);
    player2.equip(weaponKeys[Math.floor(Math.random() * weaponKeys.length)]);

    gameRunning = true;
    particles = [];
    trails = [];
    shakeIntensity = 0;

    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.add('hidden');
    updateHealthUI();
}

function updateHealthUI() {
    const p1Pct = (player1.hp / MAX_HP) * 100;
    const p2Pct = (player2.hp / MAX_HP) * 100;
    document.getElementById('p1-health-bar').style.width = `${Math.max(0, p1Pct)}%`;
    document.getElementById('p2-health-bar').style.width = `${Math.max(0, p2Pct)}%`;
}

function checkWin() {
    if (player1.hp <= 0 || player2.hp <= 0) {
        gameRunning = false;
        const winner = player1.hp > 0 ? "VICTORY" : "DEFEAT";
        document.getElementById('winner-text').innerText = winner;
        document.getElementById('game-over-screen').classList.remove('hidden');
    }
}

function gameLoop() {
    // Smooth Camera
    let shakeX = 0;
    let shakeY = 0;
    if (shakeIntensity > 0) {
        shakeX = (Math.random() - 0.5) * shakeIntensity;
        shakeY = (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= 0.9; // Fast decay
    }
    zoomScale += (1.0 - zoomScale) * 0.05; // Smooth zoom return

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-canvas.width / 2 + shakeX, -canvas.height / 2 + shakeY);

    ctx.clearRect(-100, -100, canvas.width + 200, canvas.height + 200);

    // Floor
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 150);
    ctx.lineTo(canvas.width, canvas.height - 150);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (gameRunning) {
        player1.update(player2);
        player2.update(player1);
    }

    player1.draw();
    player2.draw();

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw(ctx);
        if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // Trails
    for (let i = trails.length - 1; i >= 0; i--) {
        const t = trails[i];
        ctx.globalAlpha = t.life;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
        ctx.fill();
        t.life -= 0.08;
        if (t.life <= 0) trails.splice(i, 1);
    }
    ctx.globalAlpha = 1.0;

    ctx.restore();
    requestAnimationFrame(gameLoop);
}

// UI Interaction
const weaponCards = document.querySelectorAll('.weapon-card');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

function selectWeapon(card) {
    weaponCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedWeapon = card.dataset.weapon;
    startBtn.disabled = false;
    AudioSys.playSelect();
}

weaponCards.forEach((card, index) => {
    card.addEventListener('click', (e) => {
        e.stopPropagation();
        selectWeapon(card);
    });
});

window.addEventListener('keydown', (e) => {
    if (document.getElementById('menu-screen').classList.contains('hidden')) return;
    const key = parseInt(e.key);
    if (key >= 1 && key <= 5) {
        if (weaponCards[key - 1]) selectWeapon(weaponCards[key - 1]);
    }
    if (e.key === 'Enter' && !startBtn.disabled) {
        startBtn.click();
    }
});

startBtn.addEventListener('click', () => {
    startBtn.blur(); // Remove focus so Space doesn't trigger it again
    AudioSys.init();
    initGame();
    if (!window.loopStarted) {
        gameLoop();
        window.loopStarted = true;
    }
});

restartBtn.addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
    startBtn.disabled = true;
    weaponCards.forEach(c => c.classList.remove('selected'));
    selectedWeapon = null;
});

// Initial
resizeCanvas();
