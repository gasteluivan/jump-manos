/**
 * =============================================
 * CYBER RUNNER - Performance Optimized
 * Version: 2.1.0
 * =============================================
 * Flat 2D infinite runner - NO parallax
 * Maximum performance for mobile devices
 * =============================================
 */

// ============================================
// MOBILE DEVICE DETECTION
// ============================================
const DeviceDetection = {
    isMobile: function () {
        const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
        return mobileUA.test(navigator.userAgent) ||
            (navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches);
    }
};

let IS_MOBILE = false;

// ============================================
// GAME CONFIGURATION (Simplified)
// ============================================
const CONFIG = {
    INITIAL_SPEED: 6,
    MAX_SPEED: 18,
    SPEED_INCREMENT: 0.002,
    GRAVITY: 1.0,
    JUMP_FORCE: -16,
    PLAYER_SIZE: 40,
    PLAYER_X: 80,
    OBSTACLE_WIDTH: 40,
    OBSTACLE_HEIGHT_MIN: 40,
    OBSTACLE_HEIGHT_MAX: 80,
    GAP_MIN: 250,
    GAP_MAX: 400,
    GROUND_HEIGHT: 60,
    // Colors
    BG: '#0a0a0f',
    GROUND: '#1a1a2e',
    GROUND_LINE: '#00ffff',
    PLAYER: '#00ffff',
    OBSTACLE: '#ff00ff',
    TEXT: '#ffffff'
};

// ============================================
// GAME STATE
// ============================================
const State = { LOADING: 0, INTRO: 1, PLAYING: 2, GAME_OVER: 3 };
let gameState = State.LOADING;
let score = 0;
let highScores = [];
let speed = CONFIG.INITIAL_SPEED;

// Player
let player = { y: 0, vy: 0, jumping: false, groundY: 0 };

// Obstacles
let obstacles = [];
let nextGap = CONFIG.GAP_MIN;

// Canvas
let canvas, ctx;

// Touch/Gesture
let lastTap = 0;
let touchStart = 0;
let longPress = null;
let flickY = null;
let thumbsStart = null;
let thumbsProgress = 0;

// MediaPipe
let hands = null;
let handData = null;

// Ground animation
let groundOffset = 0;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', init);

function init() {
    IS_MOBILE = DeviceDetection.isMobile();
    if (IS_MOBILE) {
        document.body.classList.add('mobile-device');
        setupOrientation();
    }

    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);

    loadScores();

    if (IS_MOBILE) initTouch();

    initCamera();

    loop();
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    player.groundY = canvas.height - CONFIG.GROUND_HEIGHT;
    if (!player.jumping) player.y = player.groundY - CONFIG.PLAYER_SIZE;
}

// ============================================
// CAMERA & MEDIAPIPE (Simplified)
// ============================================
async function initCamera() {
    updateLoading(20);

    try {
        hands = new Hands({
            locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: IS_MOBILE ? 0 : 1, // Simpler model on mobile
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.4
        });

        hands.onResults(onHands);
        updateLoading(50);

        const video = document.getElementById('webcam');
        const res = IS_MOBILE ? { width: 320, height: 240 } : { width: 640, height: 480 };

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { ...res, facingMode: 'user' }
        });
        video.srcObject = stream;

        const cam = new Camera(video, {
            onFrame: async () => { if (hands) await hands.send({ image: video }); },
            ...res
        });
        await cam.start();

        updateLoading(100);
        setTimeout(() => {
            document.getElementById('loadingScreen').classList.add('hidden');
            gameState = State.INTRO;
        }, 300);

    } catch (e) {
        console.error(e);
        document.getElementById('loadingScreen').classList.add('hidden');
        document.getElementById('permissionRequest').classList.add('show');
    }
}

function updateLoading(p) {
    document.getElementById('loadingProgress').style.width = p + '%';
}

function onHands(r) {
    if (r.multiHandLandmarks && r.multiHandLandmarks.length > 0) {
        handData = r.multiHandLandmarks[0];

        if (gameState === State.INTRO || gameState === State.GAME_OVER) {
            detectThumbsUp();
        } else if (gameState === State.PLAYING) {
            detectFlick();
        }
    } else {
        handData = null;
        thumbsStart = null;
        thumbsProgress = 0;
        flickY = null;
    }
}

// ============================================
// GESTURE DETECTION (Simplified)
// ============================================
function detectThumbsUp() {
    if (!handData) return;

    const thumbUp = handData[4].y < handData[3].y && handData[4].y < handData[0].y;
    const fingersCurled = handData[8].y > handData[6].y &&
        handData[12].y > handData[10].y &&
        handData[16].y > handData[14].y;

    if (thumbUp && fingersCurled) {
        if (!thumbsStart) thumbsStart = Date.now();
        thumbsProgress = Math.min((Date.now() - thumbsStart) / 1500, 1);
        if (thumbsProgress >= 1) {
            if (gameState === State.INTRO) startGame();
            else if (gameState === State.GAME_OVER) startGame();
            thumbsStart = null;
            thumbsProgress = 0;
        }
    } else {
        thumbsStart = null;
        thumbsProgress = 0;
    }
}

function detectFlick() {
    if (!handData) return;

    const y = handData[8].y * canvas.height;
    if (flickY !== null) {
        const vel = flickY - y;
        if (vel > 12 && !player.jumping) jump();
    }
    flickY = y;
}

// ============================================
// TOUCH CONTROLS
// ============================================
function initTouch() {
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchStart = Date.now();

        if (gameState !== State.PLAYING) {
            longPress = setTimeout(() => {
                startGame();
                vibrate(30);
            }, 600);
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (longPress) { clearTimeout(longPress); longPress = null; }

        const dur = Date.now() - touchStart;
        const now = Date.now();

        if (gameState === State.PLAYING && dur < 300) {
            jump();
            vibrate(15);
        }

        if (gameState !== State.PLAYING && now - lastTap < 300) {
            startGame();
            vibrate(30);
        }
        lastTap = now;
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (longPress) { clearTimeout(longPress); longPress = null; }
    }, { passive: false });
}

function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

// ============================================
// GAME LOGIC
// ============================================
function startGame() {
    gameState = State.PLAYING;
    score = 0;
    speed = CONFIG.INITIAL_SPEED;
    obstacles = [];
    nextGap = CONFIG.GAP_MIN;
    player.y = player.groundY - CONFIG.PLAYER_SIZE;
    player.vy = 0;
    player.jumping = false;
}

function jump() {
    if (!player.jumping) {
        player.vy = CONFIG.JUMP_FORCE;
        player.jumping = true;
    }
}

function gameOver() {
    gameState = State.GAME_OVER;
    saveScore(Math.floor(score));
    flickY = null;
}

// ============================================
// HIGH SCORES
// ============================================
function loadScores() {
    try { highScores = JSON.parse(localStorage.getItem('cyberScores')) || []; }
    catch { highScores = []; }
}

function saveScore(s) {
    highScores.push(s);
    highScores.sort((a, b) => b - a);
    highScores = highScores.slice(0, 5);
    try { localStorage.setItem('cyberScores', JSON.stringify(highScores)); } catch { }
}

// ============================================
// UPDATE (Simplified physics)
// ============================================
function update() {
    if (gameState !== State.PLAYING) return;

    // Score & speed
    score += speed * 0.1;
    if (speed < CONFIG.MAX_SPEED) speed += CONFIG.SPEED_INCREMENT;

    // Player physics
    player.vy += CONFIG.GRAVITY;
    player.y += player.vy;

    if (player.y >= player.groundY - CONFIG.PLAYER_SIZE) {
        player.y = player.groundY - CONFIG.PLAYER_SIZE;
        player.vy = 0;
        player.jumping = false;
    }

    // Ground animation
    groundOffset = (groundOffset + speed) % 50;

    // Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        obstacles[i].x -= speed;
        if (obstacles[i].x + CONFIG.OBSTACLE_WIDTH < 0) obstacles.splice(i, 1);
    }

    nextGap -= speed;
    if (nextGap <= 0) {
        const h = CONFIG.OBSTACLE_HEIGHT_MIN + Math.random() * (CONFIG.OBSTACLE_HEIGHT_MAX - CONFIG.OBSTACLE_HEIGHT_MIN);
        obstacles.push({ x: canvas.width, y: player.groundY - h, h: h });
        nextGap = CONFIG.GAP_MIN + Math.random() * (CONFIG.GAP_MAX - CONFIG.GAP_MIN);
    }

    // Collision (simple box)
    const px = CONFIG.PLAYER_X + 5;
    const py = player.y + 5;
    const ps = CONFIG.PLAYER_SIZE - 10;

    for (const o of obstacles) {
        if (px < o.x + CONFIG.OBSTACLE_WIDTH && px + ps > o.x &&
            py < o.y + o.h && py + ps > o.y) {
            gameOver();
            break;
        }
    }
}

// ============================================
// RENDER (Flat 2D, no shadows/glow)
// ============================================
function render() {
    // Clear
    ctx.fillStyle = CONFIG.BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ground
    ctx.fillStyle = CONFIG.GROUND;
    ctx.fillRect(0, player.groundY, canvas.width, CONFIG.GROUND_HEIGHT);

    // Ground line
    ctx.strokeStyle = CONFIG.GROUND_LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, player.groundY);
    ctx.lineTo(canvas.width, player.groundY);
    ctx.stroke();

    // Simple grid on ground
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    for (let x = -groundOffset; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, player.groundY);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    if (gameState === State.INTRO) {
        drawIntro();
    } else if (gameState === State.PLAYING) {
        drawGame();
    } else if (gameState === State.GAME_OVER) {
        drawGame();
        drawGameOver();
    }

    // Camera preview in bottom-right corner (instead of hand skeleton)
    drawCameraPreview();

    // Thumbs up ring
    if (thumbsProgress > 0) {
        drawThumbsRing();
    }
}

function drawGame() {
    // Player (simple square)
    ctx.fillStyle = CONFIG.PLAYER;
    ctx.fillRect(CONFIG.PLAYER_X, player.y, CONFIG.PLAYER_SIZE, CONFIG.PLAYER_SIZE);

    // Obstacles (simple rectangles)
    ctx.fillStyle = CONFIG.OBSTACLE;
    for (const o of obstacles) {
        ctx.fillRect(o.x, o.y, CONFIG.OBSTACLE_WIDTH, o.h);
    }

    // Score
    ctx.fillStyle = CONFIG.TEXT;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('SCORE: ' + Math.floor(score), canvas.width - 20, 40);

    // Instructions
    ctx.textAlign = 'left';
    ctx.font = '12px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(IS_MOBILE ? 'TAP to jump' : 'Flick finger UP to jump', 20, 30);
}

function drawIntro() {
    ctx.fillStyle = 'rgba(10, 10, 15, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.fillStyle = CONFIG.GROUND_LINE;
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CYBER RUNNER', cx, cy - 60);

    ctx.fillStyle = CONFIG.OBSTACLE;
    ctx.font = '18px Arial';
    ctx.fillText('GESTURE CONTROL', cx, cy - 20);

    if (highScores.length > 0) {
        ctx.fillStyle = '#ffff00';
        ctx.font = '16px Arial';
        ctx.fillText('HIGH SCORE: ' + highScores[0], cx, cy + 20);
    }

    ctx.fillStyle = CONFIG.TEXT;
    ctx.font = '16px Arial';
    ctx.fillText(IS_MOBILE ? 'Double-tap or hold to Start' : 'Hold 👍 to Start', cx, cy + 70);
}

function drawGameOver() {
    ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.fillStyle = CONFIG.OBSTACLE;
    ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', cx, cy - 80);

    ctx.fillStyle = CONFIG.GROUND_LINE;
    ctx.font = 'bold 28px Arial';
    ctx.fillText('SCORE: ' + Math.floor(score), cx, cy - 30);

    // Top 5
    ctx.font = '14px Arial';
    ctx.fillStyle = CONFIG.TEXT;
    ctx.fillText('TOP SCORES', cx, cy + 10);

    for (let i = 0; i < 5; i++) {
        const s = highScores[i] || '---';
        ctx.fillStyle = (highScores[i] === Math.floor(score) && i === highScores.indexOf(Math.floor(score)))
            ? '#ffff00' : 'rgba(255,255,255,0.6)';
        ctx.fillText((i + 1) + '. ' + s, cx, cy + 35 + i * 20);
    }

    ctx.fillStyle = CONFIG.TEXT;
    ctx.font = '14px Arial';
    ctx.fillText(IS_MOBILE ? 'Double-tap or hold to Restart' : 'Hold 👍 to Restart', cx, cy + 150);
}

function drawCameraPreview() {
    const video = document.getElementById('webcam');
    if (!video || !video.srcObject) return;

    // Preview size
    const previewWidth = IS_MOBILE ? 100 : 150;
    const previewHeight = IS_MOBILE ? 75 : 112;
    const margin = 15;
    const borderWidth = 2;

    // Position: bottom-right corner
    const x = canvas.width - previewWidth - margin;
    const y = canvas.height - previewHeight - margin;

    // Draw border
    ctx.strokeStyle = CONFIG.GROUND_LINE;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(x - borderWidth, y - borderWidth, previewWidth + borderWidth * 2, previewHeight + borderWidth * 2);

    // Draw video (mirrored horizontally)
    ctx.save();
    ctx.translate(x + previewWidth, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, previewWidth, previewHeight);
    ctx.restore();
}

function drawThumbsRing() {
    if (!handData) return;
    const x = (1 - handData[0].x) * canvas.width;
    const y = handData[0].y * canvas.height;

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 50, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = CONFIG.GROUND_LINE;
    ctx.beginPath();
    ctx.arc(x, y, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * thumbsProgress);
    ctx.stroke();
}

// ============================================
// GAME LOOP
// ============================================
function loop() {
    update();
    render();
    requestAnimationFrame(loop);
}

// ============================================
// KEYBOARD FALLBACK
// ============================================
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (gameState === State.PLAYING) jump();
        else startGame();
    }
});

// ============================================
// ORIENTATION LOCK
// ============================================
function setupOrientation() {
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    document.addEventListener('click', tryFullscreen, { once: true });
    document.addEventListener('touchstart', tryFullscreen, { once: true });
}

function checkOrientation() {
    const prompt = document.getElementById('orientationPrompt');
    if (!prompt || !IS_MOBILE) return;

    const portrait = window.innerHeight > window.innerWidth;
    prompt.style.display = portrait ? 'flex' : 'none';
}

async function tryFullscreen() {
    if (!IS_MOBILE) return;
    try {
        const el = document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
        }
    } catch { }
}
