/* ============================================================
   Designer Essentials
   A catch-the-falling-kit game rendered on a fixed 360×800 stage.
   Vanilla DOM sprites driven by a single requestAnimationFrame loop.
   ============================================================ */

(function () {
    'use strict';

    /* ── Configuration ──────────────────────────────────────────────
       Gameplay values come from tokens/game.json (generated into
       assets/game-config.js). Geometry is read off the same design tokens
       the stylesheet uses, so neither can drift from the other. */

    const CONFIG = window.DESIGNER_ESSENTIALS;
    if (!CONFIG) {
        throw new Error('assets/game-config.js must be loaded before game.js');
    }

    const rootStyle = window.getComputedStyle(document.documentElement);
    const cssNumber = function (name) {
        return parseFloat(rootStyle.getPropertyValue(name));
    };

    const STAGE_W = cssNumber('--stage-width');
    const STAGE_H = cssNumber('--stage-height');
    const PLAYER_W = cssNumber('--player-width');
    const PLAYER_H = cssNumber('--player-height');

    const ROUND = CONFIG.round;
    const PLAY = CONFIG.player;
    const FALL = CONFIG.fall;

    const PLAYER_LIFT = PLAY.lift;                       // basket base above stage floor
    const PLAYER_TOP = STAGE_H - PLAYER_LIFT - PLAYER_H;
    const CATCH_TOP = PLAYER_TOP + PLAY.catchInset;
    const CATCH_DEPTH = PLAY.catchDepth;
    const CATCH_REACH = PLAY.catchReach;                 // horizontal forgiveness either side
    const PLAYER_MIN_X = PLAYER_W / 2 - PLAY.edgeOverhang;
    const PLAYER_MAX_X = STAGE_W - PLAYER_W / 2 + PLAY.edgeOverhang;

    const ROUND_SECONDS = ROUND.seconds;
    const COFFEE_BONUS_SECONDS = ROUND.coffeeBonusSeconds;
    const BOOST_SECONDS = ROUND.boostSeconds;
    const COMBO_STEP = ROUND.comboStep;
    const COMBO_MAX = ROUND.comboMax;

    const BEST_KEY = CONFIG.storageKey;

    /* The shared table names fields for both runtimes; this maps them onto the
       short names the loop uses. Every sprite keeps its own width and height —
       the assets have different aspect ratios. */
    const ITEMS = CONFIG.items.map(function (item) {
        return {
            id: item.id,
            src: item.file,
            w: item.width,
            h: item.height,
            points: item.points,
            weight: item.weight,
            effect: item.effect
        };
    });

    const TOTAL_WEIGHT = ITEMS.reduce((sum, item) => sum + item.weight, 0);

    /* ── Elements ──────────────────────────────────────────────── */
    const el = {
        stage: document.getElementById('stage'),
        field: document.getElementById('field'),
        player: document.getElementById('player'),
        hud: document.getElementById('hud'),
        score: document.getElementById('score'),
        timerFill: document.getElementById('timer-fill'),
        timerValue: document.getElementById('timer-value'),
        timer: document.querySelector('.timer'),
        combo: document.getElementById('combo'),
        comboValue: document.getElementById('combo-value'),
        boost: document.getElementById('boost'),
        screenStart: document.getElementById('screen-start'),
        screenOver: document.getElementById('screen-over'),
        btnPlay: document.getElementById('btn-play'),
        btnAgain: document.getElementById('btn-again'),
        btnHome: document.getElementById('btn-home'),
        btnSound: document.getElementById('btn-sound'),
        btnBack: document.getElementById('btn-back'),
        finalScore: document.getElementById('final-score'),
        finalItems: document.getElementById('final-items'),
        finalCombo: document.getElementById('final-combo'),
        finalBest: document.getElementById('final-best'),
        finalGap: document.getElementById('final-gap'),
        overEyebrow: document.getElementById('over-eyebrow'),
        announcer: document.getElementById('announcer')
    };

    /* ── State ─────────────────────────────────────────────────── */
    const state = {
        running: false,
        paused: false,
        timeLeft: ROUND_SECONDS,
        elapsed: 0,
        score: 0,
        combo: 0,
        bestCombo: 0,
        caught: 0,
        boostLeft: 0,
        spawnIn: FALL.firstSpawnDelay,
        playerX: STAGE_W / 2,
        targetX: STAGE_W / 2,
        keyLeft: false,
        keyRight: false,
        pointerActive: false,
        soundOn: true,
        best: readBest()
    };

    const live = [];   // active falling items
    const pool = [];   // recycled sprite elements

    /* ============================================================
       Stage scaling — keep the 360×800 design ratio, letterboxed
       ============================================================ */

    function fitStage() {
        /* Contain rather than cover: cropping the play field would hide items.
           Capped so the art never upscales past its source resolution. */
        const scale = Math.min(
            window.innerWidth / STAGE_W,
            window.innerHeight / STAGE_H,
            1.6
        );
        el.stage.style.setProperty('--scale', scale);
    }

    window.addEventListener('resize', fitStage);
    window.addEventListener('orientationchange', fitStage);
    fitStage();

    /* ============================================================
       Persistence
       ============================================================ */

    function readBest() {
        try {
            return Number(window.localStorage.getItem(BEST_KEY)) || 0;
        } catch (err) {
            return 0;
        }
    }

    function writeBest(value) {
        try {
            window.localStorage.setItem(BEST_KEY, String(value));
        } catch (err) {
            /* private mode or blocked storage — the round still stands */
        }
    }

    /* ============================================================
       Audio — a tiny synth, so the game ships no sound files
       ============================================================ */

    let audioCtx = null;

    function ensureAudio() {
        if (audioCtx || !state.soundOn) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try {
            audioCtx = new Ctx();
        } catch (err) {
            audioCtx = null;
        }
    }

    function tone(freq, duration, type, gainPeak) {
        if (!state.soundOn || !audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(gainPeak || 0.16, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
    }

    function sfxCatch(step) {
        tone(420 + Math.min(step, 8) * 42, 0.13, 'triangle', 0.14);
    }

    function sfxSpecial() {
        tone(660, 0.1, 'sine', 0.14);
        window.setTimeout(function () { tone(880, 0.14, 'sine', 0.12); }, 80);
    }

    function sfxMiss() {
        tone(150, 0.16, 'square', 0.07);
    }

    function sfxEnd() {
        [660, 520, 400, 300].forEach(function (f, i) {
            window.setTimeout(function () { tone(f, 0.22, 'triangle', 0.12); }, i * 130);
        });
    }

    /* ============================================================
       Sprite pool
       ============================================================ */

    function takeSprite() {
        const node = pool.pop();
        if (node) return node;
        const img = document.createElement('img');
        img.className = 'item';
        img.alt = '';
        img.decoding = 'async';
        return img;
    }

    function releaseSprite(node) {
        node.remove();
        node.className = 'item';
        pool.push(node);
    }

    /* ============================================================
       Spawning
       ============================================================ */

    function pickItem() {
        let roll = Math.random() * TOTAL_WEIGHT;
        for (let i = 0; i < ITEMS.length; i += 1) {
            roll -= ITEMS[i].weight;
            if (roll <= 0) return ITEMS[i];
        }
        return ITEMS[0];
    }

    function spawn() {
        const def = pickItem();
        const node = takeSprite();
        const progress = state.elapsed / ROUND_SECONDS;

        node.src = 'assets/img/' + def.src;
        node.width = def.w;
        node.height = def.h;
        node.style.width = def.w + 'px';
        node.style.height = def.h + 'px';
        if (def.effect) node.classList.add('item--special');

        const sway = FALL.swayMin + Math.random() * FALL.swayRange;
        const margin = sway + 8;   // keep the sway arc inside the stage

        const entity = {
            def: def,
            node: node,
            x: margin + Math.random() * (STAGE_W - margin * 2 - def.w),
            y: -def.h - Math.random() * 60,
            vy: (FALL.baseSpeed + FALL.speedRamp * progress) *
                (FALL.speedJitterMin + Math.random() * FALL.speedJitterRange),
            rot: (Math.random() * FALL.tiltRange) - FALL.tiltRange / 2,
            rotV: (Math.random() * FALL.spinRange) - FALL.spinRange / 2,
            swayAmp: sway,
            swayRate: FALL.swayRateMin + Math.random() * FALL.swayRateRange,
            swayPhase: Math.random() * Math.PI * 2,
            baseX: 0,
            dead: false
        };
        entity.baseX = entity.x;

        el.field.appendChild(node);
        live.push(entity);
    }

    /* ============================================================
       Feedback — score pops and catch flash
       ============================================================ */

    function popText(text, x, y, variant) {
        const node = document.createElement('span');
        node.className = 'pop' + (variant ? ' pop--' + variant : '');
        node.textContent = text;
        node.style.setProperty('--pop-x', Math.round(x) + 'px');
        node.style.setProperty('--pop-y', Math.round(y) + 'px');
        node.addEventListener('animationend', function () { node.remove(); });
        window.setTimeout(function () { node.remove(); }, 1500);  // belt and braces
        el.stage.appendChild(node);
    }

    function retrigger(node, className) {
        node.classList.remove(className);
        void node.offsetWidth;
        node.classList.add(className);
    }

    /* ============================================================
       Scoring
       ============================================================ */

    function comboMultiplier() {
        return Math.min(1 + Math.floor(state.combo / COMBO_STEP), COMBO_MAX);
    }

    function updateComboBadge() {
        const mult = comboMultiplier();
        if (mult > 1) {
            el.comboValue.textContent = '×' + mult;
            el.combo.hidden = false;
        } else {
            el.combo.hidden = true;
        }
    }

    function catchItem(entity) {
        const def = entity.def;
        const mult = comboMultiplier() * (state.boostLeft > 0 ? ROUND.boostMultiplier : 1);
        const gained = def.points * mult;

        state.score += gained;
        state.combo += 1;
        state.caught += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);

        el.score.textContent = state.score;
        retrigger(el.score, 'is-bumped');
        updateComboBadge();

        const cx = entity.x + def.w / 2;
        const cy = entity.y;

        if (def.effect === 'time') {
            state.timeLeft = Math.min(state.timeLeft + COFFEE_BONUS_SECONDS,
                ROUND_SECONDS + ROUND.maxOvertimeSeconds);
            popText('+' + COFFEE_BONUS_SECONDS + 's', cx, cy, 'time');
            retrigger(el.timerValue, 'is-gained');
            sfxSpecial();
        } else if (def.effect === 'boost') {
            state.boostLeft = BOOST_SECONDS;
            el.boost.hidden = false;
            popText('DOUBLE!', cx, cy);
            sfxSpecial();
        } else if (def.effect === 'bonus') {
            popText('+' + gained, cx, cy);
            sfxSpecial();
        } else {
            popText('+' + gained, cx, cy);
            sfxCatch(state.combo);
        }

        retrigger(el.player, 'is-catching');
        kill(entity);
    }

    function missItem(entity) {
        if (state.combo >= COMBO_STEP) {
            popText('combo lost', state.playerX, PLAYER_TOP - 20, 'miss');
        }
        state.combo = 0;
        updateComboBadge();
        sfxMiss();
        kill(entity);
    }

    function kill(entity) {
        entity.dead = true;
        releaseSprite(entity.node);
    }

    /* ============================================================
       Input
       ============================================================ */

    function stageToLogicalX(clientX) {
        const rect = el.stage.getBoundingClientRect();
        return ((clientX - rect.left) / rect.width) * STAGE_W;
    }

    function onPointerDown(event) {
        if (!state.running) return;
        state.pointerActive = true;
        try {
            el.stage.setPointerCapture(event.pointerId);
        } catch (err) {
            /* pointer already released, or a synthetic event — dragging still works */
        }
        state.targetX = stageToLogicalX(event.clientX);
    }

    function onPointerMove(event) {
        if (!state.running || !state.pointerActive) return;
        state.targetX = stageToLogicalX(event.clientX);
    }

    function onPointerUp(event) {
        state.pointerActive = false;
        if (el.stage.hasPointerCapture && el.stage.hasPointerCapture(event.pointerId)) {
            el.stage.releasePointerCapture(event.pointerId);
        }
    }

    el.stage.addEventListener('pointerdown', onPointerDown);
    el.stage.addEventListener('pointermove', onPointerMove);
    el.stage.addEventListener('pointerup', onPointerUp);
    el.stage.addEventListener('pointercancel', onPointerUp);

    window.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
            state.keyLeft = true;
            event.preventDefault();
        } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
            state.keyRight = true;
            event.preventDefault();
        } else if ((event.key === 'r' || event.key === 'R') && !state.running) {
            startGame();
        }
    });

    window.addEventListener('keyup', function (event) {
        if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
            state.keyLeft = false;
        } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
            state.keyRight = false;
        }
    });

    document.addEventListener('visibilitychange', function () {
        state.paused = document.hidden;
        if (!document.hidden) lastFrame = 0;
    });

    /* ============================================================
       Loop
       ============================================================ */

    let lastFrame = 0;
    let rafId = 0;

    function frame(now) {
        if (!state.running) {
            rafId = 0;
            return;
        }
        rafId = window.requestAnimationFrame(frame);

        if (state.paused) {
            lastFrame = 0;
            return;
        }

        const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
        lastFrame = now;
        if (dt === 0) return;

        step(dt);
    }

    function startLoop() {
        if (rafId) return;
        lastFrame = 0;
        rafId = window.requestAnimationFrame(frame);
    }

    function step(dt) {
        /* ── clock ── */
        state.timeLeft -= dt;
        state.elapsed += dt;

        if (state.boostLeft > 0) {
            state.boostLeft -= dt;
            if (state.boostLeft <= 0) el.boost.hidden = true;
        }

        const remaining = Math.max(state.timeLeft, 0);
        el.timerFill.style.width = (remaining / ROUND_SECONDS) * 100 + '%';
        el.timerValue.textContent = Math.ceil(remaining) + 's';
        el.timer.classList.toggle('is-low', remaining <= 10);

        if (state.timeLeft <= 0) {
            endGame();
            return;
        }

        /* ── player ── */
        if (state.keyLeft) state.targetX -= PLAY.keySpeed * dt;
        if (state.keyRight) state.targetX += PLAY.keySpeed * dt;
        state.targetX = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, state.targetX));

        const follow = 1 - Math.pow(PLAY.followDamping, dt);
        state.playerX += (state.targetX - state.playerX) * follow;

        const tilt = Math.max(-PLAY.maxTiltDeg,
            Math.min(PLAY.maxTiltDeg, (state.targetX - state.playerX) * 0.5));
        el.player.style.transform =
            'translate3d(' + (state.playerX - STAGE_W / 2).toFixed(2) + 'px, ' +
            (-PLAYER_LIFT) + 'px, 0) rotate(' + tilt.toFixed(2) + 'deg)';

        /* ── spawning ── */
        const progress = state.elapsed / ROUND_SECONDS;
        state.spawnIn -= dt;
        if (state.spawnIn <= 0) {
            spawn();
            state.spawnIn = Math.max(FALL.spawnFloor, FALL.spawnBase - FALL.spawnRamp * progress) *
                (FALL.spawnJitterMin + Math.random() * FALL.spawnJitterRange);
        }

        /* ── items ── */
        for (let i = live.length - 1; i >= 0; i -= 1) {
            const item = live[i];

            item.y += item.vy * dt;
            item.swayPhase += item.swayRate * dt;
            item.x = item.baseX + Math.sin(item.swayPhase) * item.swayAmp;
            item.rot += item.rotV * dt;

            item.node.style.transform =
                'translate3d(' + item.x.toFixed(2) + 'px, ' + item.y.toFixed(2) + 'px, 0) ' +
                'rotate(' + item.rot.toFixed(2) + 'deg)';

            const bottom = item.y + item.def.h;
            const centerX = item.x + item.def.w / 2;

            if (bottom >= CATCH_TOP && bottom <= CATCH_TOP + CATCH_DEPTH &&
                Math.abs(centerX - state.playerX) <= CATCH_REACH) {
                catchItem(item);
            } else if (item.y > STAGE_H) {
                missItem(item);
            }

            if (item.dead) live.splice(i, 1);
        }
    }

    /* ============================================================
       Screen flow
       ============================================================ */

    function showScreen(target) {
        /* Visibility is driven by the class alone — `hidden` would kill the
           cross-fade, and `visibility: hidden` already removes a screen from
           the tab order. */
        el.screenStart.classList.toggle('is-active', target === 'start');
        el.screenOver.classList.toggle('is-active', target === 'over');
        el.hud.hidden = target !== 'game';
    }

    function clearField() {
        while (live.length) kill(live.pop());
    }

    /* A screen is still `visibility: hidden` in the frame its class flips, and
       a hidden element cannot take focus — so wait one frame before moving it. */
    function focusWhenVisible(node) {
        window.requestAnimationFrame(function () {
            node.focus({ preventScroll: true });
        });
    }

    function startGame() {
        ensureAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

        clearField();

        state.running = true;
        state.paused = false;
        state.timeLeft = ROUND_SECONDS;
        state.elapsed = 0;
        state.score = 0;
        state.combo = 0;
        state.bestCombo = 0;
        state.caught = 0;
        state.boostLeft = 0;
        state.spawnIn = FALL.firstSpawnDelay;
        state.playerX = STAGE_W / 2;
        state.targetX = STAGE_W / 2;

        el.score.textContent = '0';
        el.timerValue.textContent = ROUND_SECONDS + 's';
        el.timerFill.style.width = '100%';
        el.timer.classList.remove('is-low');
        el.combo.hidden = true;
        el.boost.hidden = true;
        el.stage.classList.add('is-playing');

        showScreen('game');
        startLoop();
    }

    function endGame() {
        state.running = false;
        el.stage.classList.remove('is-playing');
        el.player.style.transform = '';
        clearField();
        sfxEnd();

        const isBest = state.score > state.best;
        if (isBest) {
            state.best = state.score;
            writeBest(state.best);
        }

        el.finalScore.textContent = state.score;
        el.finalItems.textContent = state.caught;
        el.finalCombo.textContent = String(state.bestCombo);
        el.finalBest.textContent = state.best;
        const gap = state.best - state.score;
        el.finalGap.hidden = isBest || gap <= 0;
        el.finalGap.textContent = gap + ' short of your best';
        el.overEyebrow.textContent = isBest ? 'New personal best' : 'Time’s up';
        el.overEyebrow.classList.toggle('is-best', isBest);

        el.announcer.textContent =
            'Round over. You scored ' + state.score + ' points from ' + state.caught + ' items.';

        showScreen('over');
        focusWhenVisible(el.btnAgain);
    }

    function goHome() {
        showScreen('start');
        focusWhenVisible(el.btnPlay);
    }

    /* Leave the round without recording a score — the player backed out
       rather than running the clock down. */
    function abandonRound() {
        state.running = false;
        el.stage.classList.remove('is-playing');
        el.player.style.transform = '';
        clearField();
        goHome();
    }

    /* ============================================================
       Wiring
       ============================================================ */

    el.btnPlay.addEventListener('click', startGame);
    el.btnAgain.addEventListener('click', startGame);
    el.btnHome.addEventListener('click', goHome);
    el.btnBack.addEventListener('click', abandonRound);

    el.btnSound.addEventListener('click', function () {
        state.soundOn = !state.soundOn;
        el.btnSound.setAttribute('aria-pressed', String(state.soundOn));
        el.btnSound.setAttribute('aria-label', state.soundOn ? 'Sound on' : 'Sound off');
        if (state.soundOn) ensureAudio();
    });

    /* Warm the sprite cache so the first fall is not a pop-in */
    ITEMS.forEach(function (def) {
        const img = new Image();
        img.src = 'assets/img/' + def.src;
    });

    showScreen('start');
}());
