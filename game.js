(function () {
  "use strict";
  var N = 6, EXIT = 4; // NED box (length 2) is out when its left edge reaches column 4
  var LEVELS = window.FJ_LEVELS;
  var SIZES2 = ["16x25x1", "20x20x1", "14x20x1", "16x20x1", "20x25x1", "12x24x1", "14x25x1", "18x24x1"];
  var SIZES3 = ["20x25x4", "16x25x4", "20x20x4", "24x24x2"];
  var STORE = "filterjam_v1";

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    board: $("board"), level: $("levelNum"), par: $("parNum"), moves: $("moveCount"), status: $("status"),
    undo: $("undoBtn"), restart: $("restartBtn"), hint: $("hintBtn"), levels: $("levelsBtn"),
    win: $("winModal"), winStars: $("winStars"), winText: $("winText"), winTitle: $("winTitle"),
    replay: $("replayBtn"), next: $("nextBtn"),
    levelsModal: $("levelsModal"), levelGrid: $("levelGrid"), levelsNote: $("levelsNote"), closeLevels: $("closeLevelsBtn")
  };

  var save = load();
  var S = { level: 0, pieces: [], pos: [], hist: [], els: [], done: false };

  function load() {
    try { var s = JSON.parse(localStorage.getItem(STORE)); if (s && s.best) return s; } catch (e) {}
    return { best: {}, level: 0 };
  }
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) {} }
  function unlockedUpTo() {
    var n = 0; while (n < LEVELS.length && save.best[n] != null) n++;
    return Math.min(n, LEVELS.length - 1);
  }

  // 3 stars: at or under par. 2 stars: within max(3, 25% of par). 1 star: any finish.
  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= par + Math.max(3, Math.ceil(par * 0.25))) return 2;
    return 1;
  }
  function starString(n) { return "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n); }

  // ---------- board logic ----------
  function grid(pos) {
    var g = new Array(N * N).fill(-1);
    S.pieces.forEach(function (p, i) {
      for (var k = 0; k < p.len; k++) {
        var r = p.h ? p.fixed : pos[i] + k, c = p.h ? pos[i] + k : p.fixed;
        g[r * N + c] = i;
      }
    });
    return g;
  }
  function range(pos, i) { // lowest and highest start this piece can slide to
    var g = grid(pos), p = S.pieces[i], s = pos[i];
    var cell = function (x) { return p.h ? g[p.fixed * N + x] : g[x * N + p.fixed]; };
    var lo = s, hi = s;
    while (lo - 1 >= 0 && cell(lo - 1) === -1) lo--;
    while (hi + p.len < N && cell(hi + p.len) === -1) hi++;
    return [lo, hi];
  }
  function solve(start) { // BFS; returns first move {i,to} of a shortest solution, plus its length
    var key = function (p) { return p.join(","); };
    var seen = {}; seen[key(start)] = null;
    var q = [start];
    for (var h = 0; h < q.length; h++) {
      var cur = q[h];
      if (cur[0] === EXIT) {
        var path = [], k = key(cur);
        while (seen[k]) { path.push(seen[k]); k = seen[k].prev; }
        path.reverse();
        return { first: path[0], len: path.length };
      }
      for (var i = 0; i < S.pieces.length; i++) {
        var r = range(cur, i);
        for (var x = r[0]; x <= r[1]; x++) {
          if (x === cur[i]) continue;
          var n = cur.slice(); n[i] = x; var nk = key(n);
          if (!(nk in seen)) { seen[nk] = { i: i, to: x, prev: key(cur) }; q.push(n); }
        }
      }
    }
    return null;
  }

  // ---------- rendering ----------
  function cellPx() {
    var w = el.board.getBoundingClientRect().width;
    return (w - 2 * w * 0.035) / N;
  }
  function placeStyle(i) {
    var p = S.pieces[i], e = S.els[i], s = S.pos[i];
    var r = p.h ? p.fixed : s, c = p.h ? s : p.fixed;
    e.style.left = "calc(var(--pad) + var(--cell) * " + c + ")";
    e.style.top = "calc(var(--pad) + var(--cell) * " + r + ")";
    e.style.width = "calc(var(--cell) * " + (p.h ? p.len : 1) + ")";
    e.style.height = "calc(var(--cell) * " + (p.h ? 1 : p.len) + ")";
    e.setAttribute("aria-label", describe(i));
  }
  function describe(i) {
    var p = S.pieces[i], s = S.pos[i];
    var name = i === 0 ? "NED box" : (p.h ? "Wide box " : "Tall box ") + p.label;
    return p.h ? name + ", row " + (p.fixed + 1) + ", columns " + (s + 1) + " to " + (s + p.len) + ". Use left and right arrows."
               : name + ", column " + (p.fixed + 1) + ", rows " + (s + 1) + " to " + (s + p.len) + ". Use up and down arrows.";
  }
  // move piece i to its current S.pos, animating from a visual offset (px, along its axis)
  function settle(i, fromOffsetPx) {
    var e = S.els[i], p = S.pieces[i];
    e.classList.add("dragging");
    e.style.transform = fromOffsetPx ? (p.h ? "translateX(" : "translateY(") + fromOffsetPx + "px)" : "";
    placeStyle(i);
    void e.offsetWidth;
    e.classList.remove("dragging");
    e.style.transform = "";
  }

  function build() {
    S.els.forEach(function (e) { e.remove(); });
    S.els = S.pieces.map(function (p, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "piece " + (p.h ? "h" : "v") + (i === 0 ? " ned" : " k" + ((i % 4) + 1));
      b.innerHTML = '<span class="box"><span class="label">' + (i === 0 ? "NED&nbsp;→" : p.label) + "</span></span>";
      b.addEventListener("pointerdown", function (ev) { startDrag(ev, i); });
      b.addEventListener("keydown", function (ev) { keyMove(ev, i); });
      el.board.appendChild(b);
      return b;
    });
    S.els.forEach(function (_, i) { placeStyle(i); });
  }

  function startLevel(n) {
    n = Math.max(0, Math.min(n, LEVELS.length - 1));
    var L = LEVELS[n], c2 = 0, c3 = 0;
    S.level = n; S.done = false; S.hist = [];
    S.pieces = L.p.map(function (a, i) {
      var p = { h: !!a[0], fixed: a[1], len: a[2] };
      if (i > 0) p.label = a[2] === 3 ? SIZES3[(c3++ + n) % SIZES3.length] : SIZES2[(c2++ + n) % SIZES2.length];
      return p;
    });
    S.pos = L.p.map(function (a) { return a[3]; });
    save.level = n; persist();
    build(); update();
    el.status.textContent = n === 0
      ? "Drag a box along its track. Boxes only slide the way they're facing."
      : "Level " + (n + 1) + ". Par is " + L.par + ".";
  }

  function update() {
    el.level.textContent = S.level + 1;
    el.par.textContent = LEVELS[S.level].par;
    el.moves.textContent = S.hist.length;
    el.undo.disabled = !S.hist.length || S.done;
    el.hint.disabled = S.done;
  }

  // ---------- moves ----------
  function commit(i, to, fromOffsetPx) {
    var from = S.pos[i];
    if (to === from) { settle(i, fromOffsetPx); return; }
    var last = S.hist[S.hist.length - 1];
    if (last && last.i === i) { // sliding the same box again counts as one move
      last.to = to;
      if (last.to === last.from) S.hist.pop();
    } else S.hist.push({ i: i, from: from, to: to });
    S.pos[i] = to;
    settle(i, fromOffsetPx != null ? fromOffsetPx : (from - to) * cellPx());
    clearHint();
    update();
    if (i === 0 && to === EXIT) win();
  }

  var drag = null;
  function startDrag(ev, i) {
    if (S.done || (ev.button != null && ev.button !== 0)) return;
    ev.preventDefault();
    var e = S.els[i], p = S.pieces[i];
    try { e.setPointerCapture(ev.pointerId); } catch (x) {}
    e.focus({ preventScroll: true });
    var r = range(S.pos, i), c = cellPx();
    drag = { i: i, id: ev.pointerId, start: p.h ? ev.clientX : ev.clientY, min: (r[0] - S.pos[i]) * c, max: (r[1] - S.pos[i]) * c, c: c, off: 0 };
    e.classList.add("dragging");
  }
  function moveDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var p = S.pieces[drag.i];
    var d = (p.h ? ev.clientX : ev.clientY) - drag.start;
    drag.off = Math.max(drag.min, Math.min(drag.max, d));
    S.els[drag.i].style.transform = (p.h ? "translateX(" : "translateY(") + drag.off + "px)";
  }
  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var d = drag; drag = null;
    var steps = Math.round(d.off / d.c);
    var to = S.pos[d.i] + steps;
    commit(d.i, to, d.off - steps * d.c);
  }
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  function keyMove(ev, i) {
    if (S.done) return;
    var p = S.pieces[i], dir = 0;
    if (p.h && ev.key === "ArrowLeft") dir = -1;
    else if (p.h && ev.key === "ArrowRight") dir = 1;
    else if (!p.h && ev.key === "ArrowUp") dir = -1;
    else if (!p.h && ev.key === "ArrowDown") dir = 1;
    if (!dir) return;
    ev.preventDefault();
    var r = range(S.pos, i), to = S.pos[i] + dir;
    if (to < r[0] || to > r[1]) return;
    commit(i, to);
  }

  function undo() {
    if (!S.hist.length || S.done) return;
    var m = S.hist.pop();
    var cur = S.pos[m.i];
    S.pos[m.i] = m.from;
    settle(m.i, (cur - m.from) * cellPx());
    clearHint(); update();
  }

  var hintTimer = null;
  function clearHint() { S.els.forEach(function (e) { e.classList.remove("hint"); }); clearTimeout(hintTimer); }
  function hint() {
    if (S.done) return;
    var s = solve(S.pos.slice());
    if (!s) { el.status.textContent = "No way out from here. Try Undo or Restart."; return; }
    clearHint();
    var m = s.first, p = S.pieces[m.i];
    var dirWord = p.h ? (m.to > S.pos[m.i] ? "right" : "left") : (m.to > S.pos[m.i] ? "down" : "up");
    var n = Math.abs(m.to - S.pos[m.i]);
    S.els[m.i].classList.add("hint");
    hintTimer = setTimeout(clearHint, 3200);
    el.status.textContent = "Hint: slide the " + (m.i === 0 ? "NED box" : "glowing box") + " " + dirWord + " " + n + (n === 1 ? " space" : " spaces") + ". " + s.len + (s.len === 1 ? " move" : " moves") + " left at best.";
  }

  function win() {
    S.done = true; update();
    var e = S.els[0], c = cellPx();
    e.classList.add("leaving");
    e.style.transform = "translateX(" + (c * 2.6) + "px)";
    var par = LEVELS[S.level].par, moves = S.hist.length, stars = starsFor(moves, par);
    var prev = save.best[S.level];
    if (prev == null || moves < prev) save.best[S.level] = moves;
    persist();
    var last = S.level === LEVELS.length - 1;
    el.winTitle.textContent = last ? "Every jam cleared!" : "Delivered!";
    el.winStars.textContent = starString(stars);
    el.winStars.setAttribute("aria-label", stars + " out of 3 stars");
    el.winText.textContent = moves + (moves === 1 ? " move" : " moves") + " (par " + par + "). " +
      (stars === 3 ? (moves < par ? "Better than par!" : "Perfect run.") : "Match par for 3 stars.") +
      (last ? " You finished all " + LEVELS.length + " levels." : "");
    el.next.textContent = last ? "Back to level 1" : "Next level →";
    el.status.textContent = "The NED box is out the door!";
    setTimeout(function () { if (el.win.showModal) el.win.showModal(); else el.win.setAttribute("open", ""); }, 650);
  }
  function closeModal(m) { if (m.close) m.close(); else m.removeAttribute("open"); }

  function openLevels() {
    var max = unlockedUpTo();
    el.levelGrid.innerHTML = "";
    LEVELS.forEach(function (L, n) {
      var b = document.createElement("button");
      b.type = "button";
      var best = save.best[n];
      b.className = "lvl" + (best != null ? " done" : "") + (n === S.level ? " current" : "");
      b.disabled = n > max;
      b.innerHTML = (n + 1) + "<small>" + (best != null ? starString(starsFor(best, L.par)) : "") + "</small>";
      b.setAttribute("aria-label", "Level " + (n + 1) + (best != null ? ", best " + best + " moves" : n > max ? ", locked" : ""));
      b.addEventListener("click", function () { closeModal(el.levelsModal); startLevel(n); });
      el.levelGrid.appendChild(b);
    });
    var done = Object.keys(save.best).length;
    el.levelsNote.textContent = done + " of " + LEVELS.length + " cleared. Solve a level to unlock the next.";
    if (el.levelsModal.showModal) el.levelsModal.showModal(); else el.levelsModal.setAttribute("open", "");
  }

  el.undo.addEventListener("click", undo);
  el.restart.addEventListener("click", function () { startLevel(S.level); });
  el.hint.addEventListener("click", hint);
  el.levels.addEventListener("click", openLevels);
  el.closeLevels.addEventListener("click", function () { closeModal(el.levelsModal); });
  el.replay.addEventListener("click", function () { closeModal(el.win); startLevel(S.level); });
  el.next.addEventListener("click", function () {
    closeModal(el.win);
    startLevel(S.level === LEVELS.length - 1 ? 0 : S.level + 1);
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); undo(); }
  });

  window.FJ = { solve: function () { return solve(S.pos.slice()); }, state: S, start: startLevel, commit: commit };
  startLevel(Math.min(save.level || 0, unlockedUpTo()));
})();
