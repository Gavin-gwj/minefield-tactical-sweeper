(() => {
  "use strict";

  const LEVELS = {
    easy: { name: "新兵训练区", rows: 9, cols: 9, mines: 10, baseCell: 43, tip: "9×9 适合热身。先用边缘数字确认第一组安全区域。" },
    medium: { name: "战术扫描区", rows: 16, cols: 16, mines: 40, baseCell: 36, tip: "16×16 更依赖区域推理。别急着猜，先找可以确定的格子。" },
    expert: { name: "专家禁区", rows: 16, cols: 30, mines: 99, baseCell: 30, tip: "专家局信息密度很高。横向滚动时要留意每一行边界。" },
    daily: { name: "每日信号", rows: 14, cols: 20, mines: 55, baseCell: 34, tip: "每日挑战使用固定随机种子，全世界的棋盘一致，答案不止一种。" }
  };

  const $ = (selector) => document.querySelector(selector);
  const boardEl = $("#mineBoard");
  const boardStage = $(".board-stage");
  const boardZone = $(".board-zone");
  const resultCard = $("#resultCard");
  const soundToggle = $("#soundToggle");
  const saveStatus = $("#saveStatus");
  const confettiCanvas = $("#confettiCanvas");
  const ctx = confettiCanvas.getContext("2d");

  const dom = {
    mineCounter: $("#mineCounter"),
    timer: $("#timer"),
    progressText: $("#progressText"),
    progressBar: $("#progressBar"),
    levelTitle: $("#levelTitle"),
    statusText: $("#statusText"),
    boardStatus: $("#boardStatus"),
    fieldStatus: $("#fieldStatus"),
    fieldHint: $("#fieldHint"),
    gamesWon: $("#gamesWon"),
    bestTime: $("#bestTime"),
    winStreak: $("#winStreak"),
    riskScore: $("#riskScore"),
    riskMeter: $("#riskMeter"),
    tipText: $("#tipText"),
    hintButton: $("#hintButton"),
    hintCount: $("#hintCount"),
    resultEyebrow: $("#resultEyebrow"),
    resultTitle: $("#resultTitle"),
    resultText: $("#resultText"),
    dailyBoardSize: $("#dailyBoardSize"),
    dailyButton: $("#dailyButton")
  };

  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const statsKey = "minefield.stats.v1";

  const state = {
    level: "easy",
    rows: LEVELS.easy.rows,
    cols: LEVELS.easy.cols,
    mines: LEVELS.easy.mines,
    cells: [],
    started: false,
    ended: false,
    won: false,
    flagCount: 0,
    revealedCount: 0,
    seconds: 0,
    timerId: null,
    startTime: 0,
    hints: 3,
    focusIndex: 0,
    minesPlaced: false,
    random: Math.random,
    seed: null,
    sound: true,
    longPressTimer: null,
    longPressed: false,
    suppressClick: false,
    particles: [],
    confettiFrame: null,
    audioContext: null
  };

  let stats = loadStats();

  function loadStats() {
    const fallback = { gamesWon: 0, streak: 0, best: {}, sound: true };
    try {
      const raw = JSON.parse(localStorage.getItem(statsKey));
      return raw ? { ...fallback, ...raw, best: { ...fallback.best, ...(raw.best || {}) } } : fallback;
    } catch {
      return fallback;
    }
  }

  function saveStats() {
    localStorage.setItem(statsKey, JSON.stringify(stats));
    saveStatus.classList.add("is-saving");
    window.setTimeout(() => saveStatus.classList.remove("is-saving"), 360);
  }

  function createSeed(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    return function random() {
      let value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(values, random) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function pad(value, length = 3) {
    return String(value).padStart(length, "0");
  }

  function formatBest(seconds) {
    if (!Number.isFinite(seconds)) return "--:--";
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${pad(minutes, 2)}:${pad(rest, 2)}`;
  }

  function currentConfig() {
    return LEVELS[state.level];
  }

  function neighborIndexes(index, rows = state.rows, cols = state.cols) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const result = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow >= 0 && nextRow < rows && nextCol >= 0 && nextCol < cols) {
          result.push(nextRow * cols + nextCol);
        }
      }
    }
    return result;
  }

  function resetBoard(level) {
    if (state.timerId) window.clearInterval(state.timerId);
    state.level = level;
    const config = currentConfig();
    state.rows = config.rows;
    state.cols = config.cols;
    state.mines = config.mines;
    state.cells = Array.from({ length: state.rows * state.cols }, (_, index) => ({
      index,
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0
    }));
    state.started = false;
    state.ended = false;
    state.won = false;
    state.flagCount = 0;
    state.revealedCount = 0;
    state.seconds = 0;
    state.timerId = null;
    state.startTime = 0;
    state.hints = 3;
    state.focusIndex = Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2);
    state.minesPlaced = false;
    state.seed = level === "daily" ? createSeed(`minefield-${todayKey}`) : null;
    state.random = state.seed === null ? Math.random : mulberry32(state.seed);
    state.particles = [];
    resultCard.classList.remove("is-visible", "is-loss");
    boardStage.classList.remove("is-loss");
    renderBoard();
    updateAll();
    setStatus("等待首次点击", "idle");
    dom.fieldStatus.textContent = level === "daily" ? "DAILY" : "STANDBY";
    dom.fieldHint.textContent = level === "daily" ? `今日种子 ${todayKey}` : config.tip;
    dom.levelTitle.textContent = config.name;
    dom.tipText.textContent = config.tip;
  }

  function renderBoard() {
    const config = currentConfig();
    const availableWidth = Math.max(240, boardZone.clientWidth - (window.innerWidth < 560 ? 50 : 96));
    const gap = window.innerWidth < 480 ? 3 : 4;
    const maxCell = Math.floor((availableWidth - gap * (state.cols - 1)) / state.cols);
    const minCell = state.cols > 24 ? 24 : state.cols > 16 ? 28 : 30;
    const cell = Math.max(minCell, Math.min(config.baseCell, maxCell || config.baseCell));

    boardEl.style.setProperty("--cols", state.cols);
    boardEl.style.setProperty("--cell", `${cell}px`);
    boardEl.style.setProperty("--gap", `${gap}px`);
    boardEl.innerHTML = "";

    const fragment = document.createDocumentFragment();
    state.cells.forEach((cellState, index) => {
      const row = Math.floor(index / state.cols) + 1;
      const col = (index % state.cols) + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.index = String(index);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", `第 ${row} 行，第 ${col} 列，未翻开`);
      button.tabIndex = index === state.focusIndex ? 0 : -1;
      fragment.appendChild(button);
      cellState.el = button;
    });
    boardEl.appendChild(fragment);
  }

  function fitBoard() {
    if (!state.cells.length) return;
    const config = currentConfig();
    const availableWidth = Math.max(240, boardZone.clientWidth - (window.innerWidth < 560 ? 50 : 96));
    const gap = window.innerWidth < 480 ? 3 : 4;
    const maxCell = Math.floor((availableWidth - gap * (state.cols - 1)) / state.cols);
    const minCell = state.cols > 24 ? 24 : state.cols > 16 ? 28 : 30;
    const cell = Math.max(minCell, Math.min(config.baseCell, maxCell || config.baseCell));
    boardEl.style.setProperty("--cell", `${cell}px`);
    boardEl.style.setProperty("--gap", `${gap}px`);
  }

  function placeMines(safeIndex) {
    const protectedIndexes = new Set([safeIndex, ...neighborIndexes(safeIndex)]);
    let candidates = state.cells.map((cell) => cell.index).filter((index) => !protectedIndexes.has(index));

    if (candidates.length < state.mines) {
      candidates = state.cells.map((cell) => cell.index).filter((index) => index !== safeIndex);
    }

    const mineIndexes = shuffled(candidates, state.random).slice(0, state.mines);
    mineIndexes.forEach((index) => { state.cells[index].mine = true; });

    state.cells.forEach((cell) => {
      if (cell.mine) return;
      cell.adjacent = neighborIndexes(cell.index).filter((index) => state.cells[index].mine).length;
    });

    state.minesPlaced = true;
  }

  function startTimer() {
    if (state.started || state.ended) return;
    state.started = true;
    state.startTime = Date.now();
    state.timerId = window.setInterval(() => {
      state.seconds = Math.floor((Date.now() - state.startTime) / 1000);
      updateTimer();
    }, 250);
    setStatus("扫描进行中", "live");
    dom.fieldStatus.textContent = "SCANNING";
    dom.fieldHint.textContent = "保持推理节奏";
  }

  function updateTimer() {
    dom.timer.textContent = pad(Math.min(state.seconds, 999));
  }

  function updateAll() {
    updateTimer();
    updateStats();
    updateAriaState();
  }

  function updateStats() {
    const flagsLeft = Math.max(0, state.mines - state.flagCount);
    const revealable = state.rows * state.cols - state.mines;
    const progress = revealable > 0 ? Math.min(100, Math.round((state.revealedCount / revealable) * 100)) : 0;
    dom.mineCounter.textContent = pad(flagsLeft);
    dom.progressText.textContent = `${progress}%`;
    dom.progressBar.style.width = `${progress}%`;
    dom.hintCount.textContent = String(state.hints);
    dom.hintButton.disabled = state.hints <= 0 || state.ended;
    dom.gamesWon.textContent = String(stats.gamesWon || 0);
    dom.winStreak.textContent = String(stats.streak || 0);
    dom.bestTime.textContent = formatBest(stats.best?.[state.level]);

    const density = state.mines / (state.rows * state.cols);
    const flagPressure = state.mines ? state.flagCount / state.mines : 0;
    const riskBase = density * 230 + flagPressure * 10 + (state.level === "expert" ? 16 : 0);
    const risk = Math.min(100, Math.round(riskBase));
    dom.riskMeter.style.width = `${Math.max(18, risk)}%`;
    if (risk < 35) {
      dom.riskScore.textContent = "LOW";
      dom.riskScore.style.color = "var(--acid)";
      dom.riskMeter.style.background = "var(--acid)";
    } else if (risk < 68) {
      dom.riskScore.textContent = "MED";
      dom.riskScore.style.color = "var(--amber)";
      dom.riskMeter.style.background = "var(--amber)";
    } else {
      dom.riskScore.textContent = "HIGH";
      dom.riskScore.style.color = "var(--coral)";
      dom.riskMeter.style.background = "var(--coral)";
    }
  }

  function updateAriaState() {
    state.cells.forEach((cell, index) => {
      if (!cell.el) return;
      const row = Math.floor(index / state.cols) + 1;
      const col = (index % state.cols) + 1;
      let value = "未翻开";
      if (cell.flagged) value = "已标记地雷";
      if (cell.revealed) value = cell.mine ? "地雷" : cell.adjacent ? `${cell.adjacent} 个相邻地雷` : "空白安全格";
      cell.el.setAttribute("aria-label", `第 ${row} 行，第 ${col} 列，${value}`);
    });
  }

  function setStatus(text, type) {
    dom.statusText.textContent = text;
    dom.boardStatus.classList.remove("is-live", "is-win", "is-loss");
    if (type !== "idle") dom.boardStatus.classList.add(`is-${type}`);
  }

  function setCellContent(cell) {
    const el = cell.el;
    el.className = "cell";
    el.textContent = "";
    el.style.removeProperty("--hint");
    if (cell.flagged) el.classList.add("is-flagged");
    if (cell.revealed) {
      el.classList.add("is-revealed");
      if (cell.mine) {
        el.classList.add("is-mine");
      } else if (cell.adjacent > 0) {
        el.textContent = String(cell.adjacent);
        el.classList.add(`n${cell.adjacent}`);
      }
    }
    updateSingleAria(cell);
  }

  function updateSingleAria(cell) {
    const index = cell.index;
    const row = Math.floor(index / state.cols) + 1;
    const col = (index % state.cols) + 1;
    let value = "未翻开";
    if (cell.flagged) value = "已标记地雷";
    if (cell.revealed) value = cell.mine ? "地雷" : cell.adjacent ? `${cell.adjacent} 个相邻地雷` : "空白安全格";
    cell.el.setAttribute("aria-label", `第 ${row} 行，第 ${col} 列，${value}`);
  }

  function revealCell(index, fromFlood = false) {
    const cell = state.cells[index];
    if (!cell || state.ended || cell.revealed || cell.flagged) return false;

    if (!state.started) {
      startTimer();
    }

    if (!state.minesPlaced) {
      placeMines(index);
    }

    if (cell.mine) {
      loseGame(index);
      return true;
    }

    const queue = [index];
    const visited = new Set();

    while (queue.length) {
      const currentIndex = queue.shift();
      if (visited.has(currentIndex)) continue;
      visited.add(currentIndex);

      const current = state.cells[currentIndex];
      if (!current || current.revealed || current.flagged || current.mine) continue;

      current.revealed = true;
      state.revealedCount += 1;
      setCellContent(current);
      current.el.classList.add("is-rippling");
      window.setTimeout(() => current.el?.classList.remove("is-rippling"), 540);

      if (current.adjacent === 0) {
        neighborIndexes(currentIndex).forEach((next) => {
          const nextCell = state.cells[next];
          if (!nextCell.revealed && !nextCell.flagged && !nextCell.mine) queue.push(next);
        });
      }
    }

    playSound(fromFlood ? "flood" : "reveal");
    checkWin();
    updateStats();
    return true;
  }

  function toggleFlag(index) {
    const cell = state.cells[index];
    if (!cell || state.ended || cell.revealed) return;
    cell.flagged = !cell.flagged;
    state.flagCount += cell.flagged ? 1 : -1;
    setCellContent(cell);
    updateStats();
    playSound("flag");
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function chordCell(index) {
    const cell = state.cells[index];
    if (!cell || state.ended || !cell.revealed || cell.adjacent === 0) return;
    const neighbors = neighborIndexes(index);
    const flagged = neighbors.filter((next) => state.cells[next].flagged).length;
    if (flagged !== cell.adjacent) {
      cell.el.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-2px)" }, { transform: "translateX(2px)" }, { transform: "translateX(0)" }],
        { duration: 180, iterations: 1 }
      );
      return;
    }
    neighbors.forEach((next) => {
      const neighbor = state.cells[next];
      if (!neighbor.flagged && !neighbor.revealed) revealCell(next, true);
    });
  }

  function loseGame(explodedIndex) {
    state.ended = true;
    state.won = false;
    if (state.timerId) window.clearInterval(state.timerId);
    state.cells.forEach((cell) => {
      if (cell.mine) {
        cell.revealed = true;
        setCellContent(cell);
      } else if (cell.flagged) {
        cell.el.classList.add("is-wrong");
      }
    });
    state.cells[explodedIndex]?.el.classList.add("is-mine");
    stats.streak = 0;
    saveStats();
    setStatus("信号中断", "loss");
    dom.fieldStatus.textContent = "FAILED";
    dom.fieldHint.textContent = "复盘雷区，再试一次";
    boardStage.classList.add("is-loss");
    showResult("MISSION FAILED", "任务失败", `你在 ${formatBest(state.seconds)} 触发了地雷。下一局会把首击安全区继续保留。`, true);
    playSound("explosion");
    updateStats();
  }

  function checkWin() {
    const safeTotal = state.rows * state.cols - state.mines;
    if (state.revealedCount < safeTotal || state.ended) return;

    state.ended = true;
    state.won = true;
    if (state.timerId) window.clearInterval(state.timerId);
    state.seconds = Math.max(0, Math.floor((Date.now() - state.startTime) / 1000));

    state.cells.forEach((cell) => {
      if (cell.mine && !cell.flagged) {
        cell.flagged = true;
        state.flagCount += 1;
      }
      if (cell.mine) setCellContent(cell);
    });

    const previousBest = stats.best?.[state.level];
    const isRecord = !Number.isFinite(previousBest) || state.seconds < previousBest;
    if (isRecord) {
      stats.best = { ...(stats.best || {}), [state.level]: state.seconds };
    }
    stats.gamesWon = (stats.gamesWon || 0) + 1;
    stats.streak = (stats.streak || 0) + 1;
    saveStats();

    setStatus("区域已清除", "win");
    dom.fieldStatus.textContent = "SECURED";
    dom.fieldHint.textContent = isRecord ? "新纪录已写入本地存档" : "继续保持连胜";
    showResult(
      isRecord ? "NEW FIELD RECORD" : "FIELD SECURED",
      isRecord ? "刷新纪录" : "任务完成",
      `用时 ${formatBest(state.seconds)}，清除 ${safeTotal} 个安全格。${isRecord ? "这已成为当前难度的最佳成绩。" : "逻辑清晰，继续推进下一局。"}`
    );
    playSound("win");
    burstConfetti();
    updateStats();
  }

  function showResult(eyebrow, title, text, isLoss = false) {
    dom.resultEyebrow.textContent = eyebrow;
    dom.resultTitle.textContent = title;
    dom.resultText.textContent = text;
    resultCard.classList.toggle("is-loss", isLoss);
    window.setTimeout(() => resultCard.classList.add("is-visible"), 220);
  }

  function hint() {
    if (state.hints <= 0 || state.ended) return;
    if (!state.started) {
      const center = Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2);
      startTimer();
      placeMines(center);
    }

    const candidates = state.cells
      .filter((cell) => !cell.revealed && !cell.flagged && !cell.mine)
      .sort((a, b) => {
        const aKnown = neighborIndexes(a.index).some((index) => state.cells[index].revealed) ? 0 : 1;
        const bKnown = neighborIndexes(b.index).some((index) => state.cells[index].revealed) ? 0 : 1;
        return aKnown - bKnown;
      });

    if (!candidates.length) return;
    const target = candidates[Math.floor(Math.random() * Math.min(candidates.length, 6))];
    state.hints -= 1;
    target.el.classList.add("is-hint");
    window.setTimeout(() => target.el?.classList.remove("is-hint"), 1900);
    dom.fieldHint.textContent = `安全候选：第 ${Math.floor(target.index / state.cols) + 1} 行，第 ${(target.index % state.cols) + 1} 列`;
    playSound("hint");
    updateStats();
  }

  function moveFocus(index) {
    if (index < 0 || index >= state.cells.length) return;
    state.focusIndex = index;
    state.cells.forEach((cell, cellIndex) => {
      if (cell.el) cell.el.tabIndex = cellIndex === index ? 0 : -1;
    });
    state.cells[index].el?.focus({ preventScroll: true });
    scrollCellIntoView(state.cells[index].el);
  }

  function scrollCellIntoView(el) {
    const scroll = boardEl.parentElement;
    if (!scroll) return;
    const scrollRect = scroll.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.left < scrollRect.left || rect.right > scrollRect.right) {
      scroll.scrollLeft += rect.left - scrollRect.left - 24;
    }
    if (rect.top < scrollRect.top || rect.bottom > scrollRect.bottom) {
      scroll.scrollTop += rect.top - scrollRect.top - 24;
    }
  }

  function handleBoardKey(event) {
    const cell = event.target.closest?.(".cell");
    const index = cell ? Number(cell.dataset.index) : state.focusIndex;
    const row = Math.floor(index / state.cols);
    const col = index % state.cols;
    let next = index;

    if (event.key === "ArrowUp") next = row > 0 ? index - state.cols : index;
    else if (event.key === "ArrowDown") next = row < state.rows - 1 ? index + state.cols : index;
    else if (event.key === "ArrowLeft") next = col > 0 ? index - 1 : index;
    else if (event.key === "ArrowRight") next = col < state.cols - 1 ? index + 1 : index;
    else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFlag(index);
      return;
    } else if (event.key.toLowerCase() === "x") {
      event.preventDefault();
      chordCell(index);
      return;
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      revealCell(index);
      return;
    } else {
      return;
    }

    event.preventDefault();
    moveFocus(next);
  }

  function playSound(kind) {
    if (!state.sound) return;
    try {
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const audio = state.audioContext;
      if (audio.state === "suspended") audio.resume();
      const now = audio.currentTime;

      const tone = (frequency, duration, type = "sine", gain = 0.035, offset = 0, endFrequency) => {
        const oscillator = audio.createOscillator();
        const volume = audio.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, now + offset);
        if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + offset + duration);
        volume.gain.setValueAtTime(0.0001, now + offset);
        volume.gain.exponentialRampToValueAtTime(gain, now + offset + 0.012);
        volume.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        oscillator.connect(volume).connect(audio.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + duration + 0.02);
      };

      if (kind === "reveal") tone(360 + Math.random() * 80, 0.07, "triangle", 0.022);
      if (kind === "flood") {
        tone(260, 0.12, "sine", 0.025);
        tone(420, 0.16, "triangle", 0.018, 0.04);
      }
      if (kind === "flag") tone(620, 0.055, "square", 0.019);
      if (kind === "hint") tone(880, 0.16, "sine", 0.023, 0, 1180);
      if (kind === "explosion") {
        tone(150, 0.52, "sawtooth", 0.065, 0, 28);
        tone(72, 0.62, "square", 0.04, 0, 22);
      }
      if (kind === "win") {
        [392, 523.25, 659.25, 783.99].forEach((frequency, index) => tone(frequency, 0.34, "triangle", 0.026, index * 0.085));
      }
    } catch {
      state.sound = false;
      updateSoundButton();
    }
  }

  function updateSoundButton() {
    soundToggle.classList.toggle("is-muted", !state.sound);
    soundToggle.setAttribute("aria-pressed", String(state.sound));
    soundToggle.setAttribute("aria-label", state.sound ? "关闭音效" : "开启音效");
  }

  function resizeConfetti() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    confettiCanvas.width = Math.floor(window.innerWidth * ratio);
    confettiCanvas.height = Math.floor(window.innerHeight * ratio);
    confettiCanvas.style.width = `${window.innerWidth}px`;
    confettiCanvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function burstConfetti() {
    resizeConfetti();
    const colors = ["#b9ff43", "#52dbff", "#ff7658", "#ffc95c", "#eef3ed"];
    const originX = window.innerWidth / 2;
    const originY = Math.max(150, window.innerHeight * 0.34);
    state.particles = Array.from({ length: 130 }, () => ({
      x: originX + (Math.random() - 0.5) * 180,
      y: originY + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 12,
      vy: -5 - Math.random() * 9,
      gravity: 0.22 + Math.random() * 0.12,
      drag: 0.985,
      rotation: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      size: 4 + Math.random() * 7,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1
    }));
    if (!state.confettiFrame) {
      state.confettiFrame = requestAnimationFrame(animateConfetti);
    }
  }

  function animateConfetti() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    state.particles.forEach((particle) => {
      particle.vx *= particle.drag;
      particle.vy += particle.gravity;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.vr;
      particle.life -= 0.008;
      ctx.save();
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = particle.color;
      ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.55);
      ctx.restore();
    });
    state.particles = state.particles.filter((particle) => particle.life > 0 && particle.y < window.innerHeight + 40);
    if (state.particles.length) {
      state.confettiFrame = requestAnimationFrame(animateConfetti);
    } else {
      cancelAnimationFrame(state.confettiFrame);
      state.confettiFrame = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function handleBoardClick(event) {
    const cell = event.target.closest?.(".cell");
    if (!cell) return;
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    const index = Number(cell.dataset.index);
    state.focusIndex = index;
    revealCell(index);
  }

  function handleBoardContextMenu(event) {
    const cell = event.target.closest?.(".cell");
    if (!cell) return;
    event.preventDefault();
    const index = Number(cell.dataset.index);
    toggleFlag(index);
  }

  function handleBoardDoubleClick(event) {
    const cell = event.target.closest?.(".cell");
    if (!cell) return;
    event.preventDefault();
    chordCell(Number(cell.dataset.index));
  }

  function handlePointerDown(event) {
    const cell = event.target.closest?.(".cell");
    if (!cell || event.pointerType === "mouse") return;
    state.longPressed = false;
    state.suppressClick = false;
    state.longPressTimer = window.setTimeout(() => {
      state.longPressed = true;
      state.suppressClick = true;
      toggleFlag(Number(cell.dataset.index));
    }, 460);
  }

  function clearLongPress() {
    if (state.longPressTimer) {
      window.clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
  }

  function handlePointerUp(event) {
    clearLongPress();
    if (state.longPressed) {
      state.longPressed = false;
      state.suppressClick = true;
      event.preventDefault();
    }
  }

  function bindEvents() {
    document.querySelectorAll(".difficulty-item").forEach((button) => {
      button.addEventListener("click", () => {
        resetBoard(button.dataset.level);
        if (button.dataset.level === "daily") {
          dom.dailyButton.textContent = `今日挑战 · ${todayKey}`;
        }
      });
    });

    $("#newGameButton").addEventListener("click", () => resetBoard(state.level));
    $("#replayButton").addEventListener("click", () => resetBoard(state.level));
    $("#closeResultButton").addEventListener("click", () => resultCard.classList.remove("is-visible"));
    dom.dailyButton.addEventListener("click", () => resetBoard("daily"));
    dom.hintButton.addEventListener("click", hint);

    boardEl.addEventListener("click", handleBoardClick);
    boardEl.addEventListener("contextmenu", handleBoardContextMenu);
    boardEl.addEventListener("dblclick", handleBoardDoubleClick);
    boardEl.addEventListener("keydown", handleBoardKey);
    boardEl.addEventListener("pointerdown", handlePointerDown);
    boardEl.addEventListener("pointerup", handlePointerUp);
    boardEl.addEventListener("pointercancel", clearLongPress);
    boardEl.addEventListener("pointerleave", clearLongPress);
    boardEl.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        const cell = event.target.closest?.(".cell");
        if (cell) chordCell(Number(cell.dataset.index));
      }
    });
    boardEl.addEventListener("focusin", (event) => {
      const cell = event.target.closest?.(".cell");
      if (cell) state.focusIndex = Number(cell.dataset.index);
    });

    soundToggle.addEventListener("click", () => {
      state.sound = !state.sound;
      stats.sound = state.sound;
      saveStats();
      updateSoundButton();
      if (state.sound) playSound("flag");
    });

    window.addEventListener("resize", () => {
      fitBoard();
      resizeConfetti();
    });
  }

  function boot() {
    dom.dailyBoardSize.textContent = `${LEVELS.daily.cols} × ${LEVELS.daily.rows}`;
    dom.dailyButton.textContent = "进入今日挑战";
    state.sound = stats.sound !== false;
    updateSoundButton();
    resizeConfetti();
    bindEvents();
    resetBoard("easy");
    window.setTimeout(fitBoard, 80);
  }

  boot();
})();