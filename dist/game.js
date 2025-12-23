/**
 * =============================================
 * CYBER RUNNER - Hand Gesture Infinite Runner
 * Version: 1.2.0
 * =============================================
 * A cyberpunk-themed infinite runner game controlled
 * entirely by webcam hand gestures using MediaPipe.
 * Optimized for mobile devices with touch controls.
 * =============================================
 */

// ============================================
// MOBILE DEVICE DETECTION
// ============================================
const DeviceDetection = {
    /**
     * Detect if the device is mobile based on multiple signals
     * NOT based on screen size - uses actual device characteristics
     */
    isMobile: function () {
        // Check user agent for mobile devices
        const mobileUserAgentRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
        const hasMobileUserAgent = mobileUserAgentRegex.test(navigator.userAgent);

        // Check for touch points (most reliable for touch devices)
        const hasTouchPoints = navigator.maxTouchPoints > 0;

        // Check for touch events support
        const hasTouchEvents = 'ontouchstart' in window;

        // Check for mobile-specific APIs
        const hasOrientationAPI = typeof window.orientation !== 'undefined';

        // Check for coarse pointer (finger vs mouse)
        const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

        // Combine signals - require at least mobile UA or (touch + coarse pointer)
        return hasMobileUserAgent || (hasTouchPoints && hasCoarsePointer) || hasOrientationAPI;
    },

    /**
     * Check if device is iOS specifically
     */
    isIOS: function () {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    },

    /**
     * Check if device is Android specifically
     */
    isAndroid: function () {
        return /Android/i.test(navigator.userAgent);
    }
};

// Global mobile state
let IS_MOBILE = false;
let touchIndicator = null;

// ============================================
// GAME CONFIGURATION
// ============================================
const CONFIG = {
    // Game settings
    INITIAL_SPEED: 5,
    MAX_SPEED: 15,
    SPEED_INCREMENT: 0.001,
    GRAVITY: 0.8,
    JUMP_FORCE: -18,

    // Player settings
    PLAYER_SIZE: 50,
    PLAYER_X_POSITION: 100,

    // Obstacle settings
    OBSTACLE_MIN_WIDTH: 30,
    OBSTACLE_MAX_WIDTH: 60,
    OBSTACLE_MIN_HEIGHT: 40,
    OBSTACLE_MAX_HEIGHT: 100,
    OBSTACLE_GAP_MIN: 300,
    OBSTACLE_GAP_MAX: 500,

    // Gesture settings
    FLICK_VELOCITY_THRESHOLD: 15,
    FLICK_COOLDOWN: 300,
    THUMBS_UP_HOLD_TIME: 1500,

    // Visual settings
    PARALLAX_DEPTH_SHIFT: 30,

    // Colors
    COLORS: {
        NEON_CYAN: '#00ffff',
        NEON_MAGENTA: '#ff00ff',
        NEON_YELLOW: '#ffff00',
        DARK_BG: '#0a0a0f',
        DARK_SECONDARY: '#1a1a2e',
        GLOW_CYAN: 'rgba(0, 255, 255, 0.5)',
        GLOW_MAGENTA: 'rgba(255, 0, 255, 0.5)'
    }
};

// ============================================
// GAME STATE ENUM
// ============================================
const GameState = {
    LOADING: 'LOADING',
    INTRO: 'INTRO',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER'
};

// ============================================
// GLOBAL VARIABLES
// ============================================
let canvas, ctx;
let gameState = GameState.LOADING;
let score = 0;
let highScores = [];
let gameSpeed = CONFIG.INITIAL_SPEED;

// Player state
let player = {
    x: CONFIG.PLAYER_X_POSITION,
    y: 0,
    width: CONFIG.PLAYER_SIZE,
    height: CONFIG.PLAYER_SIZE,
    velocityY: 0,
    isJumping: false,
    rotation: 0,
    groundY: 0
};

// Obstacles array
let obstacles = [];
let nextObstacleDistance = 0;

// Parallax background layers
let parallaxLayers = [];
let jumpDepthOffset = 0;

// Hand tracking state
let handLandmarks = null;
let previousIndexY = null;
let lastFlickTime = 0;
let thumbsUpStartTime = null;
let thumbsUpProgress = 0;
let handPosition = { x: 0, y: 0 };

// MediaPipe instances
let hands = null;
let camera = null;

// DOM elements
let loadingScreen, loadingProgress, permissionRequest, webcamElement;

// Mobile-specific settings
const MOBILE_CONFIG = {
    // Reduced visual effects for performance
    REDUCED_GLOW: true,
    SIMPLIFIED_HAND_SKELETON: true,
    LOWER_CAMERA_RESOLUTION: true,
    // Touch settings
    DOUBLE_TAP_THRESHOLD: 300,
    LONG_PRESS_DURATION: 800
};

// Touch state
let lastTapTime = 0;
let touchStartTime = 0;
let longPressTimer = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', init);

function init() {
    // Detect mobile device FIRST
    IS_MOBILE = DeviceDetection.isMobile();
    console.log('Device detected as:', IS_MOBILE ? 'MOBILE' : 'DESKTOP');

    // Apply mobile class to body for CSS
    if (IS_MOBILE) {
        document.body.classList.add('mobile-device');

        // Force landscape orientation on mobile
        lockLandscapeOrientation();

        // Listen for orientation changes
        setupOrientationListener();
    }

    // Get DOM elements
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    loadingScreen = document.getElementById('loadingScreen');
    loadingProgress = document.getElementById('loadingProgress');
    permissionRequest = document.getElementById('permissionRequest');
    webcamElement = document.getElementById('webcam');
    touchIndicator = document.getElementById('touchIndicator');

    // Set canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load high scores from localStorage
    loadHighScores();

    // Initialize touch controls for mobile
    if (IS_MOBILE) {
        initTouchControls();
    }

    // Initialize MediaPipe
    initMediaPipe();

    // Start game loop
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Update ground position
    player.groundY = canvas.height - 100;
    if (!player.isJumping) {
        player.y = player.groundY - player.height;
    }

    // Reinitialize parallax layers
    initParallaxLayers();
}

// ============================================
// MEDIAPIPE INITIALIZATION
// ============================================
async function initMediaPipe() {
    updateLoadingProgress(10);

    try {
        // Initialize MediaPipe Hands
        hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
            }
        });

        updateLoadingProgress(30);

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });

        hands.onResults(onHandResults);

        updateLoadingProgress(50);

        // Request camera permission
        await startCamera();

    } catch (error) {
        console.error('Error initializing MediaPipe:', error);
        showPermissionRequest();
    }
}

async function startCamera() {
    try {
        // Use lower resolution for mobile devices
        const videoConfig = IS_MOBILE && MOBILE_CONFIG.LOWER_CAMERA_RESOLUTION
            ? { width: 320, height: 240, facingMode: 'user' }
            : { width: 640, height: 480, facingMode: 'user' };

        const stream = await navigator.mediaDevices.getUserMedia({
            video: videoConfig
        });

        webcamElement.srcObject = stream;

        updateLoadingProgress(70);

        // Initialize camera utility with appropriate resolution
        camera = new Camera(webcamElement, {
            onFrame: async () => {
                if (hands) {
                    await hands.send({ image: webcamElement });
                }
            },
            width: videoConfig.width,
            height: videoConfig.height
        });

        await camera.start();

        updateLoadingProgress(100);

        // Hide loading screen after a brief delay
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            gameState = GameState.INTRO;

            // Show touch indicator on mobile
            if (IS_MOBILE && touchIndicator) {
                showTouchIndicator();
            }
        }, 500);

    } catch (error) {
        console.error('Camera error:', error);
        showPermissionRequest();
    }
}

function showPermissionRequest() {
    loadingScreen.classList.add('hidden');
    permissionRequest.classList.add('show');
}

function updateLoadingProgress(percent) {
    loadingProgress.style.width = percent + '%';
}

// ============================================
// HAND TRACKING RESULTS
// ============================================
function onHandResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        handLandmarks = results.multiHandLandmarks[0];

        // Calculate hand center position for UI
        const wrist = handLandmarks[0];
        handPosition.x = (1 - wrist.x) * canvas.width; // Mirror horizontally
        handPosition.y = wrist.y * canvas.height;

        // Process gestures based on game state
        if (gameState === GameState.INTRO || gameState === GameState.GAME_OVER) {
            detectThumbsUp();
        } else if (gameState === GameState.PLAYING) {
            detectIndexFlick();
        }
    } else {
        handLandmarks = null;
        thumbsUpStartTime = null;
        thumbsUpProgress = 0;
        previousIndexY = null;
    }
}

// ============================================
// GESTURE DETECTION
// ============================================

/**
 * Detect thumbs up gesture with hold timer
 * Used for START and RESTART actions
 */
function detectThumbsUp() {
    if (!handLandmarks) return;

    const isThumbsUp = checkThumbsUpPose(handLandmarks);

    if (isThumbsUp) {
        if (thumbsUpStartTime === null) {
            thumbsUpStartTime = Date.now();
        }

        const elapsed = Date.now() - thumbsUpStartTime;
        thumbsUpProgress = Math.min(elapsed / CONFIG.THUMBS_UP_HOLD_TIME, 1);

        if (elapsed >= CONFIG.THUMBS_UP_HOLD_TIME) {
            // Thumbs up held long enough - trigger action
            if (gameState === GameState.INTRO) {
                startGame();
            } else if (gameState === GameState.GAME_OVER) {
                restartGame();
            }
            thumbsUpStartTime = null;
            thumbsUpProgress = 0;
        }
    } else {
        thumbsUpStartTime = null;
        thumbsUpProgress = 0;
    }
}

/**
 * Check if hand is in thumbs up pose
 * Thumb extended up, other fingers curled
 */
function checkThumbsUpPose(landmarks) {
    // Landmark indices
    const THUMB_TIP = 4;
    const THUMB_IP = 3;
    const THUMB_MCP = 2;
    const INDEX_TIP = 8;
    const INDEX_PIP = 6;
    const MIDDLE_TIP = 12;
    const MIDDLE_PIP = 10;
    const RING_TIP = 16;
    const RING_PIP = 14;
    const PINKY_TIP = 20;
    const PINKY_PIP = 18;
    const WRIST = 0;

    // Check thumb is extended upward
    const thumbUp = landmarks[THUMB_TIP].y < landmarks[THUMB_IP].y &&
        landmarks[THUMB_TIP].y < landmarks[WRIST].y;

    // Check other fingers are curled (tips below PIPs)
    const indexCurled = landmarks[INDEX_TIP].y > landmarks[INDEX_PIP].y;
    const middleCurled = landmarks[MIDDLE_TIP].y > landmarks[MIDDLE_PIP].y;
    const ringCurled = landmarks[RING_TIP].y > landmarks[RING_PIP].y;
    const pinkyCurled = landmarks[PINKY_TIP].y > landmarks[PINKY_PIP].y;

    return thumbUp && indexCurled && middleCurled && ringCurled && pinkyCurled;
}

/**
 * Detect index finger flick gesture for jumping
 * Tracks vertical velocity of index fingertip
 */
function detectIndexFlick() {
    if (!handLandmarks) return;

    const INDEX_TIP = 8;
    const currentIndexY = handLandmarks[INDEX_TIP].y * canvas.height;

    if (previousIndexY !== null) {
        // Calculate vertical velocity (negative = moving up)
        const velocityY = previousIndexY - currentIndexY;

        const now = Date.now();
        const cooldownPassed = now - lastFlickTime > CONFIG.FLICK_COOLDOWN;

        // Check for upward flick
        if (velocityY > CONFIG.FLICK_VELOCITY_THRESHOLD && cooldownPassed && !player.isJumping) {
            jump();
            lastFlickTime = now;
        }
    }

    previousIndexY = currentIndexY;
}

// ============================================
// GAME ACTIONS
// ============================================
function startGame() {
    gameState = GameState.PLAYING;
    score = 0;
    gameSpeed = CONFIG.INITIAL_SPEED;
    obstacles = [];
    nextObstacleDistance = CONFIG.OBSTACLE_GAP_MIN;
    player.y = player.groundY - player.height;
    player.velocityY = 0;
    player.isJumping = false;
    player.rotation = 0;
    jumpDepthOffset = 0;
}

function restartGame() {
    startGame();
}

function jump() {
    if (!player.isJumping) {
        player.velocityY = CONFIG.JUMP_FORCE;
        player.isJumping = true;
    }
}

function gameOver() {
    gameState = GameState.GAME_OVER;
    saveHighScore(Math.floor(score));
    previousIndexY = null; // Reset flick detection
}

// ============================================
// HIGH SCORE MANAGEMENT
// ============================================
function loadHighScores() {
    try {
        const stored = localStorage.getItem('cyberRunnerHighScores');
        highScores = stored ? JSON.parse(stored) : [];
    } catch (e) {
        highScores = [];
    }
}

function saveHighScore(newScore) {
    highScores.push(newScore);
    highScores.sort((a, b) => b - a);
    highScores = highScores.slice(0, 5); // Keep top 5

    try {
        localStorage.setItem('cyberRunnerHighScores', JSON.stringify(highScores));
    } catch (e) {
        console.error('Failed to save high scores:', e);
    }
}

function isNewHighScore(score) {
    return highScores.length === 0 || score > highScores[0];
}

// ============================================
// PARALLAX BACKGROUND SYSTEM
// ============================================
function initParallaxLayers() {
    parallaxLayers = [
        // Layer 1: Distant city skyline (slowest)
        {
            speed: 0.2,
            depthMultiplier: 0.3,
            elements: generateSkylineElements(),
            y: canvas.height * 0.3,
            color: CONFIG.COLORS.DARK_SECONDARY
        },
        // Layer 2: Mid-ground geometric shapes
        {
            speed: 0.5,
            depthMultiplier: 0.6,
            elements: generateMidgroundElements(),
            y: canvas.height * 0.5,
            color: 'rgba(255, 0, 255, 0.3)'
        },
        // Layer 3: Foreground ground with grid
        {
            speed: 1.0,
            depthMultiplier: 1.0,
            gridOffset: 0,
            y: canvas.height - 100,
            color: CONFIG.COLORS.NEON_CYAN
        }
    ];
}

function generateSkylineElements() {
    const elements = [];
    let x = 0;
    while (x < canvas.width * 2) {
        const width = 30 + Math.random() * 60;
        const height = 50 + Math.random() * 150;
        elements.push({ x, width, height });
        x += width + Math.random() * 20;
    }
    return elements;
}

function generateMidgroundElements() {
    const elements = [];
    for (let i = 0; i < 15; i++) {
        elements.push({
            x: Math.random() * canvas.width * 2,
            size: 20 + Math.random() * 40,
            type: Math.random() > 0.5 ? 'triangle' : 'diamond'
        });
    }
    return elements;
}

// ============================================
// OBSTACLE MANAGEMENT
// ============================================
function spawnObstacle() {
    const width = CONFIG.OBSTACLE_MIN_WIDTH +
        Math.random() * (CONFIG.OBSTACLE_MAX_WIDTH - CONFIG.OBSTACLE_MIN_WIDTH);
    const height = CONFIG.OBSTACLE_MIN_HEIGHT +
        Math.random() * (CONFIG.OBSTACLE_MAX_HEIGHT - CONFIG.OBSTACLE_MIN_HEIGHT);

    obstacles.push({
        x: canvas.width,
        y: player.groundY - height,
        width: width,
        height: height,
        glowPhase: Math.random() * Math.PI * 2
    });

    nextObstacleDistance = CONFIG.OBSTACLE_GAP_MIN +
        Math.random() * (CONFIG.OBSTACLE_GAP_MAX - CONFIG.OBSTACLE_GAP_MIN);
}

function updateObstacles() {
    // Move obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        obstacles[i].x -= gameSpeed;
        obstacles[i].glowPhase += 0.1;

        // Remove off-screen obstacles
        if (obstacles[i].x + obstacles[i].width < 0) {
            obstacles.splice(i, 1);
        }
    }

    // Spawn new obstacles
    nextObstacleDistance -= gameSpeed;
    if (nextObstacleDistance <= 0) {
        spawnObstacle();
    }
}

// ============================================
// COLLISION DETECTION
// ============================================
function checkCollision() {
    const playerBox = {
        x: player.x + 5,
        y: player.y + 5,
        width: player.width - 10,
        height: player.height - 10
    };

    for (const obstacle of obstacles) {
        if (playerBox.x < obstacle.x + obstacle.width &&
            playerBox.x + playerBox.width > obstacle.x &&
            playerBox.y < obstacle.y + obstacle.height &&
            playerBox.y + playerBox.height > obstacle.y) {
            return true;
        }
    }
    return false;
}

// ============================================
// UPDATE FUNCTIONS
// ============================================
function update() {
    if (gameState !== GameState.PLAYING) return;

    // Update score
    score += gameSpeed * 0.1;

    // Increase speed over time
    if (gameSpeed < CONFIG.MAX_SPEED) {
        gameSpeed += CONFIG.SPEED_INCREMENT;
    }

    // Update player physics
    player.velocityY += CONFIG.GRAVITY;
    player.y += player.velocityY;

    // Ground collision
    if (player.y >= player.groundY - player.height) {
        player.y = player.groundY - player.height;
        player.velocityY = 0;
        player.isJumping = false;
        player.rotation = 0;
    }

    // Update rotation during jump
    if (player.isJumping) {
        player.rotation += 0.15;
    }

    // Calculate jump depth offset for parallax
    const jumpHeight = (player.groundY - player.height) - player.y;
    jumpDepthOffset = (jumpHeight / (player.groundY - player.height)) * CONFIG.PARALLAX_DEPTH_SHIFT;

    // Update parallax layers
    updateParallax();

    // Update obstacles
    updateObstacles();

    // Check collision
    if (checkCollision()) {
        gameOver();
    }
}

function updateParallax() {
    // Update layer 1 (skyline)
    for (const elem of parallaxLayers[0].elements) {
        elem.x -= gameSpeed * parallaxLayers[0].speed;
        if (elem.x + elem.width < 0) {
            elem.x = canvas.width + Math.random() * 100;
            elem.height = 50 + Math.random() * 150;
        }
    }

    // Update layer 2 (midground)
    for (const elem of parallaxLayers[1].elements) {
        elem.x -= gameSpeed * parallaxLayers[1].speed;
        if (elem.x + elem.size < 0) {
            elem.x = canvas.width + Math.random() * 200;
        }
    }

    // Update layer 3 (ground grid)
    parallaxLayers[2].gridOffset = (parallaxLayers[2].gridOffset + gameSpeed) % 50;
}

// ============================================
// RENDER FUNCTIONS
// ============================================
function render() {
    // Clear canvas
    ctx.fillStyle = CONFIG.COLORS.DARK_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw based on game state
    switch (gameState) {
        case GameState.LOADING:
            // Loading screen is handled by HTML/CSS
            break;
        case GameState.INTRO:
            drawParallax();
            drawIntroScreen();
            break;
        case GameState.PLAYING:
            drawParallax();
            drawObstacles();
            drawPlayer();
            drawScore();
            drawInstructions();
            break;
        case GameState.GAME_OVER:
            drawParallax();
            drawObstacles();
            drawPlayer();
            drawGameOverScreen();
            break;
    }

    // Always draw hand overlay when landmarks available (reduced on mobile)
    if (handLandmarks && gameState !== GameState.LOADING) {
        drawHandSkeleton();

        // Draw thumbs up progress ring
        if (thumbsUpProgress > 0) {
            drawThumbsUpRing();
        }
    }

    // Draw touch ripples on mobile
    updateTouchRipples();
}

function drawParallax() {
    // Layer 1: Distant skyline
    const layer1 = parallaxLayers[0];
    const layer1Offset = jumpDepthOffset * layer1.depthMultiplier;
    ctx.fillStyle = layer1.color;
    for (const elem of layer1.elements) {
        ctx.fillRect(
            elem.x,
            layer1.y - elem.height + layer1Offset,
            elem.width,
            elem.height
        );
    }

    // Layer 2: Midground shapes
    const layer2 = parallaxLayers[1];
    const layer2Offset = jumpDepthOffset * layer2.depthMultiplier;
    ctx.fillStyle = layer2.color;
    for (const elem of layer2.elements) {
        ctx.save();
        ctx.translate(elem.x, layer2.y + layer2Offset);

        if (elem.type === 'triangle') {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(elem.size / 2, -elem.size);
            ctx.lineTo(elem.size, 0);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(elem.size / 2, 0);
            ctx.lineTo(elem.size, elem.size / 2);
            ctx.lineTo(elem.size / 2, elem.size);
            ctx.lineTo(0, elem.size / 2);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
    }

    // Layer 3: Ground with neon grid
    const layer3 = parallaxLayers[2];
    const layer3Offset = jumpDepthOffset * layer3.depthMultiplier;

    // Ground platform
    ctx.fillStyle = CONFIG.COLORS.DARK_SECONDARY;
    ctx.fillRect(0, layer3.y + layer3Offset, canvas.width, canvas.height - layer3.y);

    // Neon grid lines
    ctx.strokeStyle = layer3.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;

    // Vertical grid lines
    for (let x = -layer3.gridOffset; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, layer3.y + layer3Offset);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    // Horizontal grid lines
    for (let y = layer3.y + layer3Offset; y < canvas.height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Ground line with glow
    ctx.strokeStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.lineWidth = 3;
    ctx.shadowColor = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(0, layer3.y + layer3Offset);
    ctx.lineTo(canvas.width, layer3.y + layer3Offset);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawPlayer() {
    ctx.save();

    // Translate to player center for rotation
    const centerX = player.x + player.width / 2;
    const centerY = player.y + player.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(player.rotation);

    // Draw glow
    ctx.shadowColor = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 20;

    // Draw cube outline
    ctx.strokeStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.lineWidth = 3;
    ctx.strokeRect(-player.width / 2, -player.height / 2, player.width, player.height);

    // Draw inner fill
    ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.fillRect(-player.width / 2, -player.height / 2, player.width, player.height);

    // Draw diagonal lines for cube effect
    ctx.beginPath();
    ctx.moveTo(-player.width / 2, -player.height / 2);
    ctx.lineTo(player.width / 2, player.height / 2);
    ctx.moveTo(player.width / 2, -player.height / 2);
    ctx.lineTo(-player.width / 2, player.height / 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();
}

function drawObstacles() {
    for (const obstacle of obstacles) {
        const glowIntensity = 0.5 + Math.sin(obstacle.glowPhase) * 0.3;

        ctx.save();
        ctx.shadowColor = CONFIG.COLORS.NEON_MAGENTA;
        ctx.shadowBlur = 15 * glowIntensity;

        // Obstacle outline
        ctx.strokeStyle = CONFIG.COLORS.NEON_MAGENTA;
        ctx.lineWidth = 2;
        ctx.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);

        // Obstacle fill
        ctx.fillStyle = `rgba(255, 0, 255, ${0.2 * glowIntensity})`;
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);

        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function drawHandSkeleton() {
    if (!handLandmarks) return;

    // Hand connections for skeleton
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],     // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8],     // Index
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17]             // Palm
    ];

    ctx.save();

    // Create gradient for connections
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, CONFIG.COLORS.NEON_CYAN);
    gradient.addColorStop(1, CONFIG.COLORS.NEON_MAGENTA);

    // Draw connections
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.shadowColor = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 10;

    for (const [i, j] of connections) {
        const from = handLandmarks[i];
        const to = handLandmarks[j];

        ctx.beginPath();
        ctx.moveTo((1 - from.x) * canvas.width, from.y * canvas.height);
        ctx.lineTo((1 - to.x) * canvas.width, to.y * canvas.height);
        ctx.stroke();
    }

    // Draw joints
    ctx.fillStyle = CONFIG.COLORS.NEON_MAGENTA;
    ctx.shadowColor = CONFIG.COLORS.NEON_MAGENTA;

    for (const landmark of handLandmarks) {
        const x = (1 - landmark.x) * canvas.width;
        const y = landmark.y * canvas.height;

        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawThumbsUpRing() {
    const centerX = handPosition.x;
    const centerY = handPosition.y;
    const radius = 60;

    ctx.save();

    // Background ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Progress ring
    ctx.strokeStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowColor = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 15;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * thumbsUpProgress));
    ctx.stroke();

    // Thumbs up icon
    ctx.font = '24px Arial';
    ctx.fillStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👍', centerX, centerY);

    ctx.restore();
}

function drawScore() {
    ctx.save();

    ctx.font = 'bold 28px Orbitron, sans-serif';
    ctx.fillStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowColor = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 10;
    ctx.textAlign = 'right';

    ctx.fillText(`SCORE: ${Math.floor(score)}`, canvas.width - 30, 50);

    ctx.restore();
}

function drawInstructions() {
    ctx.save();

    ctx.font = '14px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'left';

    // Show different instructions based on device type
    if (IS_MOBILE) {
        ctx.fillText('👆 TAP anywhere to jump', 30, 40);
    } else {
        ctx.fillText('☝ Flick index finger UP to jump', 30, 40);
    }

    ctx.restore();
}

function drawIntroScreen() {
    ctx.save();

    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(10, 10, 15, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Title with glow
    ctx.font = 'bold 64px Orbitron, sans-serif';
    ctx.fillStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowColor = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 30;
    ctx.textAlign = 'center';
    ctx.fillText('CYBER RUNNER', centerX, centerY - 80);

    // Subtitle
    ctx.font = '24px Orbitron, sans-serif';
    ctx.shadowBlur = 15;
    ctx.fillStyle = CONFIG.COLORS.NEON_MAGENTA;
    ctx.shadowColor = CONFIG.COLORS.NEON_MAGENTA;
    ctx.fillText('HAND GESTURE CONTROL', centerX, centerY - 30);

    // High score display
    if (highScores.length > 0) {
        ctx.font = '20px Orbitron, sans-serif';
        ctx.fillStyle = CONFIG.COLORS.NEON_YELLOW;
        ctx.shadowColor = CONFIG.COLORS.NEON_YELLOW;
        ctx.shadowBlur = 10;
        ctx.fillText(`HIGH SCORE: ${highScores[0]}`, centerX, centerY + 30);
    }

    // Start instruction - different for mobile vs desktop
    ctx.font = '18px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 0;

    if (IS_MOBILE) {
        ctx.fillText('Double-tap or hold to Start', centerX, centerY + 100);
        ctx.font = '14px Orbitron, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText('Hand gestures also work!', centerX, centerY + 140);
    } else {
        ctx.fillText('Hold 👍 to Start', centerX, centerY + 100);
        ctx.font = '14px Orbitron, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText('Show your hand to the camera', centerX, centerY + 140);
    }

    ctx.restore();
}

function drawGameOverScreen() {
    ctx.save();

    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const currentScore = Math.floor(score);
    const isNewHigh = isNewHighScore(currentScore);

    // Game Over title
    ctx.font = 'bold 56px Orbitron, sans-serif';
    ctx.fillStyle = CONFIG.COLORS.NEON_MAGENTA;
    ctx.shadowColor = CONFIG.COLORS.NEON_MAGENTA;
    ctx.shadowBlur = 30;
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', centerX, centerY - 120);

    // Current score
    ctx.font = 'bold 36px Orbitron, sans-serif';
    ctx.fillStyle = isNewHigh ? CONFIG.COLORS.NEON_YELLOW : CONFIG.COLORS.NEON_CYAN;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 20;
    ctx.fillText(`SCORE: ${currentScore}`, centerX, centerY - 50);

    // New high score badge
    if (isNewHigh) {
        ctx.font = '18px Orbitron, sans-serif';
        ctx.fillStyle = CONFIG.COLORS.NEON_YELLOW;
        ctx.fillText('★ NEW HIGH SCORE! ★', centerX, centerY - 15);
    }

    // Top 5 high scores
    ctx.font = 'bold 20px Orbitron, sans-serif';
    ctx.fillStyle = CONFIG.COLORS.NEON_CYAN;
    ctx.shadowBlur = 10;
    ctx.fillText('TOP 5 SCORES', centerX, centerY + 30);

    ctx.font = '16px Orbitron, sans-serif';
    ctx.shadowBlur = 5;

    for (let i = 0; i < 5; i++) {
        const scoreValue = highScores[i] || '---';
        const yPos = centerY + 60 + (i * 25);
        const isCurrentScore = highScores[i] === currentScore;

        if (isCurrentScore && i === highScores.indexOf(currentScore)) {
            ctx.fillStyle = CONFIG.COLORS.NEON_YELLOW;
            ctx.shadowColor = CONFIG.COLORS.NEON_YELLOW;
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.shadowColor = 'transparent';
        }

        ctx.fillText(`${i + 1}. ${scoreValue}`, centerX, yPos);
    }

    // Restart instruction - different for mobile vs desktop
    ctx.font = '18px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 0;

    if (IS_MOBILE) {
        ctx.fillText('Double-tap or hold to Restart', centerX, centerY + 200);
    } else {
        ctx.fillText('Hold 👍 to Restart', centerX, centerY + 200);
    }

    ctx.restore();
}

// ============================================
// GAME LOOP
// ============================================
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

// ============================================
// KEYBOARD FALLBACK (for testing)
// ============================================
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        if (gameState === GameState.PLAYING) {
            jump();
        } else if (gameState === GameState.INTRO) {
            startGame();
        } else if (gameState === GameState.GAME_OVER) {
            restartGame();
        }
    }
});

// ============================================
// MOBILE TOUCH CONTROLS
// ============================================

/**
 * Initialize touch event listeners for mobile devices
 */
function initTouchControls() {
    console.log('Initializing touch controls for mobile');

    // Prevent default touch behaviors
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });

    // Prevent context menu on long press
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * Handle touch start event
 */
function handleTouchStart(e) {
    e.preventDefault();

    touchStartTime = Date.now();
    const now = Date.now();

    // Start long press timer for START/RESTART
    if (gameState === GameState.INTRO || gameState === GameState.GAME_OVER) {
        longPressTimer = setTimeout(() => {
            if (gameState === GameState.INTRO) {
                startGame();
                vibrate(50); // Haptic feedback
            } else if (gameState === GameState.GAME_OVER) {
                restartGame();
                vibrate(50);
            }
        }, MOBILE_CONFIG.LONG_PRESS_DURATION);
    }
}

/**
 * Handle touch end event
 */
function handleTouchEnd(e) {
    e.preventDefault();

    // Clear long press timer
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    const touchDuration = Date.now() - touchStartTime;
    const now = Date.now();

    // Regular tap during gameplay = JUMP
    if (gameState === GameState.PLAYING && touchDuration < 300) {
        jump();
        vibrate(20); // Light haptic feedback
        showTouchFeedback(e.changedTouches[0]);
    }

    // Double tap detection for quick START/RESTART
    if (gameState === GameState.INTRO || gameState === GameState.GAME_OVER) {
        if (now - lastTapTime < MOBILE_CONFIG.DOUBLE_TAP_THRESHOLD) {
            if (gameState === GameState.INTRO) {
                startGame();
            } else {
                restartGame();
            }
            vibrate(50);
        }
        lastTapTime = now;
    }
}

/**
 * Handle touch move event
 */
function handleTouchMove(e) {
    e.preventDefault();
    // Cancel long press if finger moves
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

/**
 * Vibration feedback for mobile
 */
function vibrate(duration) {
    if ('vibrate' in navigator) {
        navigator.vibrate(duration);
    }
}

/**
 * Show visual feedback on touch location
 */
function showTouchFeedback(touch) {
    const x = touch.clientX;
    const y = touch.clientY;

    // Draw a ripple effect at touch location
    const ripple = { x, y, radius: 0, alpha: 1 };
    touchRipples.push(ripple);
}

// Touch ripple effects array
let touchRipples = [];

/**
 * Show/hide touch indicator
 */
function showTouchIndicator() {
    if (touchIndicator) {
        touchIndicator.classList.add('visible');
        // Hide after 3 seconds
        setTimeout(() => {
            touchIndicator.classList.remove('visible');
        }, 3000);
    }
}

/**
 * Update and draw touch ripples
 */
function updateTouchRipples() {
    if (!IS_MOBILE) return;

    for (let i = touchRipples.length - 1; i >= 0; i--) {
        const ripple = touchRipples[i];
        ripple.radius += 8;
        ripple.alpha -= 0.05;

        if (ripple.alpha <= 0) {
            touchRipples.splice(i, 1);
        } else {
            ctx.save();
            ctx.strokeStyle = `rgba(0, 255, 255, ${ripple.alpha})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// ============================================
// ORIENTATION LOCK (MOBILE)
// ============================================

/**
 * Lock screen to landscape orientation using Screen Orientation API
 * This requires user interaction first (fullscreen) on most browsers
 */
function lockLandscapeOrientation() {
    // Try to lock orientation using Screen Orientation API
    if (screen.orientation && screen.orientation.lock) {
        // Request fullscreen first (required for orientation lock on most browsers)
        console.log('Screen Orientation API available, will lock on first interaction');
    } else {
        console.log('Screen Orientation API not supported, using visual prompt');
    }
    // Always check and show prompt initially
    checkOrientationAndShowPrompt();
}

/**
 * Request fullscreen and then lock orientation
 */
async function requestFullscreenAndLock() {
    try {
        // Check if we can request fullscreen
        const docEl = document.documentElement;

        if (docEl.requestFullscreen) {
            await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
            await docEl.webkitRequestFullscreen();
        } else if (docEl.msRequestFullscreen) {
            await docEl.msRequestFullscreen();
        }

        // Now try to lock orientation
        if (screen.orientation && screen.orientation.lock) {
            try {
                await screen.orientation.lock('landscape');
                console.log('Orientation locked to landscape');
            } catch (lockError) {
                console.log('Could not lock orientation:', lockError.message);
            }
        }

    } catch (fullscreenError) {
        console.log('Could not enter fullscreen:', fullscreenError.message);
    }
}

/**
 * Setup orientation change listener
 */
function setupOrientationListener() {
    // Modern API
    if (screen.orientation) {
        screen.orientation.addEventListener('change', checkOrientationAndShowPrompt);
    }

    // Legacy API
    window.addEventListener('orientationchange', checkOrientationAndShowPrompt);

    // Also check on resize (some devices don't fire orientation events)
    window.addEventListener('resize', debounce(checkOrientationAndShowPrompt, 200));

    // Initial check
    checkOrientationAndShowPrompt();
}

/**
 * Check current orientation and show/hide prompt
 */
function checkOrientationAndShowPrompt() {
    const orientationPrompt = document.getElementById('orientationPrompt');
    if (!orientationPrompt) return;

    const isPortrait = isDeviceInPortrait();

    if (isPortrait && IS_MOBILE) {
        orientationPrompt.style.display = 'flex';
    } else {
        orientationPrompt.style.display = 'none';
    }
}

/**
 * Detect if device is in portrait orientation
 */
function isDeviceInPortrait() {
    // Method 1: Screen Orientation API
    if (screen.orientation && screen.orientation.type) {
        return screen.orientation.type.includes('portrait');
    }

    // Method 2: window.orientation (deprecated but widely supported)
    if (typeof window.orientation !== 'undefined') {
        return window.orientation === 0 || window.orientation === 180;
    }

    // Method 3: Compare dimensions
    return window.innerHeight > window.innerWidth;
}

/**
 * Simple debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Try to enter fullscreen and lock orientation on first user interaction
 */
document.addEventListener('click', function onFirstInteraction() {
    if (IS_MOBILE) {
        requestFullscreenAndLock();
    }
}, { once: true });

document.addEventListener('touchstart', function onFirstTouch() {
    if (IS_MOBILE) {
        requestFullscreenAndLock();
    }
}, { once: true });
