(function () {
  "use strict";

  var TOPICS = window.TOPICS || [];
  var QUESTIONS = window.QUESTIONS || [];
  var EXAM = window.EXAM || {};
  var STORE_KEY = "imb-quiz-history-v2";
  var topicName = {};
  var topicOrder = {};
  TOPICS.forEach(function (t, i) { topicName[t.key] = t.name; topicOrder[t.key] = i; });

  // ── 記録（localStorage が使えない環境でも動くように） ──
  var memoryHistory = {};
  function loadHistory() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return memoryHistory; }
  }
  function saveHistory(h) {
    memoryHistory = h;
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(h)); } catch (e) { /* 保存できなくても続行 */ }
  }
  var history = loadHistory();

  // ── 途中経過（続きから再開用） ──
  var SESSION_KEY = "imb-quiz-session-v1";
  var memorySession = null;
  var byId = {};
  QUESTIONS.forEach(function (q) { byId[q.id] = q; });

  function saveSessionState() {
    if (!session) return;
    var results = {};
    session.items.forEach(function (it) { if (it.answered) results[it.q.id] = it.result; });
    var data = {
      ids: session.items.map(function (it) { return it.q.id; }),
      index: session.index,
      results: results,
      savedAt: Date.now()
    };
    memorySession = data;
    try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) { /* 保存できなくても続行 */ }
  }
  function loadSessionState() {
    var data = memorySession;
    try {
      var raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { /* メモリ上の値を使う */ }
    if (!data || !data.ids) return null;
    var ids = data.ids.filter(function (id) { return byId[id]; });
    if (!ids.length) return null;
    data.ids = ids;
    data.index = Math.min(Math.max(data.index || 0, 0), ids.length - 1);
    return data;
  }
  function clearSessionState() {
    memorySession = null;
    try { window.localStorage.removeItem(SESSION_KEY); } catch (e) { /* 無視 */ }
  }

  // ── ユーティリティ ──
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function radioValue(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }
  function show(id) {
    ["setup", "quiz", "result", "list"].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }
  function typeLabel(q) { return q.type === "term" ? "用語" : "説明"; }

  // ── 設定画面 ──
  function renderExam() {
    $("exam-date").textContent = (EXAM.date || "") + (EXAM.room ? "　" + EXAM.room : "");
    $("exam-rules").textContent = EXAM.rules || "";
  }

  function renderTopics() {
    var list = $("topic-list");
    list.textContent = "";
    TOPICS.forEach(function (t) {
      var w = QUESTIONS.filter(function (q) { return q.t === t.key && q.type === "w"; }).length;
      var term = QUESTIONS.filter(function (q) { return q.t === t.key && q.type === "term"; }).length;
      var label = el("label", "topic");
      var cb = el("input");
      cb.type = "checkbox"; cb.value = t.key; cb.checked = true; cb.name = "topic";
      var name = el("span", "name", t.name);
      name.appendChild(el("span", "sub", t.sub));
      var count = el("span", "count", "説明" + w + "・用語" + term);
      label.appendChild(cb); label.appendChild(name); label.appendChild(count);
      list.appendChild(label);
    });
  }

  function selectedTopics() {
    return Array.prototype.slice.call(document.querySelectorAll('input[name="topic"]:checked'))
      .map(function (c) { return c.value; });
  }

  function buildPool() {
    var topics = selectedTopics();
    var mode = radioValue("mode");
    var filter = radioValue("filter");
    return QUESTIONS.filter(function (q) {
      if (topics.indexOf(q.t) < 0) return false;
      if (mode !== "all" && q.type !== mode) return false;
      if (filter === "past" && !(q.p && q.p.length)) return false;
      if (filter === "wrong" && !(history[q.id] && history[q.id].wrong)) return false;
      return true;
    });
  }

  function orderedPoolStable() {
    return buildPool().slice().sort(function (a, b) {
      return (topicOrder[a.t] - topicOrder[b.t]) || (QUESTIONS.indexOf(a) - QUESTIONS.indexOf(b));
    });
  }

  function orderedPool() {
    var pool = buildPool();
    if (radioValue("order") === "random") return shuffle(pool);
    // まとめプリントの順（分野の順 → データ内の順）
    return pool.slice().sort(function (a, b) {
      return (topicOrder[a.t] - topicOrder[b.t]) || (QUESTIONS.indexOf(a) - QUESTIONS.indexOf(b));
    });
  }

  function renderStartFrom(pool) {
    var sel = $("start-from");
    var keep = sel.value;
    var isPrint = radioValue("order") === "print";
    sel.textContent = "";
    if (!isPrint) {
      sel.appendChild(el("option", "", "ランダムのときは最初から"));
      sel.disabled = true;
      $("start-from-hint").textContent = "途中の問題から始めるには「まとめプリントの順」を選んでください。";
      return;
    }
    sel.disabled = pool.length === 0;
    var current = null;
    var group = null;
    pool.forEach(function (q, i) {
      if (q.t !== current) {
        current = q.t;
        group = document.createElement("optgroup");
        group.label = topicName[q.t] || q.t;
        sel.appendChild(group);
      }
      var text = q.q.length > 34 ? q.q.slice(0, 34) + "…" : q.q;
      var opt = el("option", "", (i + 1) + ". " + text);
      opt.value = q.id;
      group.appendChild(opt);
    });
    if (keep && pool.some(function (q) { return q.id === keep; })) sel.value = keep;
    $("start-from-hint").textContent = "途中の問題から始められます。分野の見出しで探せます。";
  }

  function startIndex(pool) {
    if (radioValue("order") !== "print") return 0;
    var id = $("start-from").value;
    for (var i = 0; i < pool.length; i++) if (pool[i].id === id) return i;
    return 0;
  }

  function renderResume() {
    var saved = loadSessionState();
    if (!saved) { $("resume").hidden = true; return; }
    var answered = Object.keys(saved.results || {}).length;
    var d = new Date(saved.savedAt || Date.now());
    var when = (d.getMonth() + 1) + "/" + d.getDate() + " " + d.getHours() + ":" + ("0" + d.getMinutes()).slice(-2);
    var q = byId[saved.ids[saved.index]];
    $("resume-info").textContent = (saved.index + 1) + " / " + saved.ids.length + " 問目から（記録済み " + answered + " 問・" + when + "）"
      + (q ? "　次：" + (q.q.length > 30 ? q.q.slice(0, 30) + "…" : q.q) : "");
    $("resume").hidden = false;
  }

  function updatePoolInfo() {
    var pool = orderedPoolStable();
    var n = pool.length;
    renderStartFrom(pool);
    renderResume();
    renderVagueCard();
    var wrongTotal = QUESTIONS.filter(function (q) { return history[q.id] && history[q.id].wrong; }).length;
    var count = parseInt(radioValue("count"), 10);
    var rest = n - startIndex(pool);
    var asked = count === 0 ? rest : Math.min(rest, count);
    var from = startIndex(pool) > 0 ? "（" + (startIndex(pool) + 1) + "問目から）" : "";
    $("pool-info").textContent = n === 0
      ? "条件に合う問題がありません"
      : "対象 " + n + " 問のうち " + asked + " 問を出題" + from + "・あいまい " + wrongTotal + " 問";
    $("filter-vague-label").textContent = "あいまいな問題だけ（" + wrongTotal + "）";
    $("start").disabled = n === 0;
    $("open-list").disabled = n === 0;
  }

  // ── 出題 ──
  var session = null;

  function startSession(questions, index, results) {
    results = results || {};
    session = {
      items: questions.map(function (q) {
        var r = results[q.id] || null;
        return { q: q, answered: !!r, result: r };
      }),
      index: index || 0
    };
    saveSessionState();
    show("quiz");
    renderQuestion();
  }

  function scoreText() {
    var done = session.items.filter(function (it) { return it.answered; });
    var ok = done.filter(function (it) { return it.result === "ok"; }).length;
    return done.length ? "答えれた " + ok + " / " + done.length : "";
  }

  function renderMeta(q, container) {
    container.textContent = "";
    container.appendChild(el("span", "tag", topicName[q.t] || q.t));
    container.appendChild(el("span", "tag type" + (q.type === "term" ? " term" : ""), typeLabel(q)));
    if (q.p && q.p.length) container.appendChild(el("span", "tag past", "過去問 " + q.p.join("・")));
    if (q.quiz) container.appendChild(el("span", "tag quiz", "確認問題"));
    if (history[q.id] && history[q.id].wrong) container.appendChild(el("span", "tag vague", "前回あいまい"));
  }

  function renderQuestion() {
    var item = session.items[session.index];
    var q = item.q;
    var total = session.items.length;
    $("q-index").textContent = (session.index + 1) + " / " + total;
    $("q-score").textContent = scoreText();
    $("bar-fill").style.width = (session.index / total * 100) + "%";
    renderMeta(q, $("q-meta"));
    $("q-text").textContent = q.q;
    $("q-note").hidden = true;

    var body = $("q-body");
    body.textContent = "";
    var fb = $("feedback");
    fb.hidden = true; fb.textContent = "";
    $("next").hidden = !item.answered;
    $("next").textContent = session.index === total - 1 ? "結果を見る" : "次へ";
    $("prev").disabled = session.index === 0;

    body.appendChild(el("p", "think", q.type === "term"
      ? "1〜2文で意味を言えるか、頭の中で答えてみてください。"
      : "試験のつもりで、説明の流れとキーワードを頭の中で組み立ててみてください。"));

    var actions = el("div", "w-actions");
    var reveal = el("button", "btn primary", "答えを見る");
    reveal.type = "button";
    actions.appendChild(reveal);
    body.appendChild(actions);
    reveal.addEventListener("click", function () { revealAnswer(item, reveal); });
    if (item.answered) {
      body.appendChild(el("p", "hint", "記録済み：" + (item.result === "ok" ? "答えれた" : "あいまい") + "（答えを見て押し直すと上書きされます）"));
    }
  }

  function revealAnswer(item, reveal) {
    var q = item.q;
    reveal.parentNode.hidden = true;
    if (q.note) {
      $("q-note").textContent = "メモ：" + q.note;
      $("q-note").hidden = false;
    }
    var fb = $("feedback");
    fb.textContent = "";
    var model = el("div", "model");
    model.appendChild(el("h3", "", "入れたいキーワード"));
    var ul = el("ul", "keys");
    (q.k || []).forEach(function (k) { ul.appendChild(el("li", "", k)); });
    model.appendChild(ul);
    model.appendChild(el("h3", "", "模範解答"));
    model.appendChild(el("p", "", q.a));
    var self = el("div", "self two");
    [["ok", "答えれた", "sel-ok"], ["ng", "あいまい", "sel-ng"]].forEach(function (s, i) {
      var b = el("button", "btn ghost", (i + 1) + "  " + s[1]);
      b.type = "button";
      b.addEventListener("click", function () { grade(item, s[0], s[2], self, b); });
      if (item.answered && item.result === s[0]) b.classList.add(s[2]);
      self.appendChild(b);
    });
    model.appendChild(self);
    fb.appendChild(model);
    fb.hidden = false;
  }

  function grade(item, result, cls, self, button) {
    Array.prototype.forEach.call(self.querySelectorAll(".btn"), function (x) {
      x.classList.remove("sel-ok", "sel-ng");
    });
    button.classList.add(cls);
    item.answered = true;
    item.result = result;
    record(item.q.id, result !== "ok");
    saveSessionState();
    $("q-score").textContent = scoreText();
    $("next").hidden = false;
  }

  function record(id, wrong) {
    var h = history[id] || { n: 0, miss: 0 };
    h.n += 1;
    if (wrong) h.miss += 1;
    h.wrong = wrong;
    history[id] = h;
    saveHistory(history);
  }

  function next() {
    if (session.index < session.items.length - 1) {
      session.index += 1;
      saveSessionState();
      renderQuestion();
      window.scrollTo(0, 0);
    } else {
      showResult(true);
    }
  }

  function prev() {
    if (session.index > 0) {
      session.index -= 1;
      saveSessionState();
      renderQuestion();
      window.scrollTo(0, 0);
    }
  }

  // ── 結果 ──
  function answerBlock(q, card) {
    var a = el("p", "ans");
    a.appendChild(el("b", "", "模範解答："));
    a.appendChild(document.createTextNode(q.a));
    card.appendChild(a);
    if (q.k && q.k.length) card.appendChild(el("p", "exp", "キーワード：" + q.k.join("／")));
    if (q.note) card.appendChild(el("p", "exp", "メモ：" + q.note));
  }

  function showResult(completed) {
    if (completed === true) clearSessionState();
    else saveSessionState();
    var done = session.items.filter(function (it) { return it.answered; });
    var ok = done.filter(function (it) { return it.result === "ok"; }).length;
    var ng = done.length - ok;

    $("result-score").textContent = done.length ? ok + " / " + done.length : "—";
    $("result-sub").textContent = done.length
      ? "答えれた " + ok + " 問・あいまい " + ng + " 問"
      : "記録した問題がありません";

    var missed = done.filter(function (it) { return it.result !== "ok"; });
    $("retry-wrong").hidden = missed.length === 0;
    $("result-read").hidden = vagueQuestions().length === 0;

    var review = $("review");
    review.textContent = "";
    if (missed.length) {
      review.appendChild(el("h2", "review-title", "あいまいだった問題（" + missed.length + "問）"));
      missed.forEach(function (it) {
        var q = it.q;
        var card = el("article", "card review-item");
        var meta = el("div", "meta");
        renderMeta(q, meta);
        card.appendChild(meta);
        card.appendChild(el("p", "q-text", q.q));
        answerBlock(q, card);
        review.appendChild(card);
      });
    } else if (done.length) {
      review.appendChild(el("p", "hint", "全部答えれました。"));
    }

    session.missed = missed.map(function (it) { return it.q; });
    show("result");
  }

  // ── 一覧（模範解答を通して読む） ──
  function vagueQuestions() {
    return QUESTIONS.filter(function (q) { return history[q.id] && history[q.id].wrong; })
      .sort(function (a, b) {
        return (topicOrder[a.t] - topicOrder[b.t]) || (QUESTIONS.indexOf(a) - QUESTIONS.indexOf(b));
      });
  }

  function renderVagueCard() {
    var n = vagueQuestions().length;
    $("vague-card").hidden = n === 0;
    $("vague-info").textContent = n + " 問あります。模範解答をまとめて読むか、解き直して確認しましょう。";
  }

  var listMode = "pool";
  var listReturn = "setup";

  // mode: "pool"（設定画面の条件）/ "vague"（あいまいな問題すべて）
  function showList(mode, from) {
    listMode = mode || "pool";
    listReturn = from || "setup";
    var vague = listMode === "vague";
    var pool = vague ? vagueQuestions() : orderedPoolStable();
    var body = $("list-body");
    body.textContent = "";
    $("list-info").textContent = (vague ? "あいまいな問題 " : "") + pool.length + " 問";
    $("list-hint").hidden = !vague;
    $("list-body").classList.toggle("hide-answers", $("hide-answers").checked);
    if (!pool.length) body.appendChild(el("p", "hint", vague ? "あいまいな問題はありません。" : "問題がありません。"));
    var current = null;
    pool.forEach(function (q) {
      if (q.t !== current) {
        current = q.t;
        body.appendChild(el("h2", "review-title", topicName[q.t] || q.t));
      }
      var card = el("article", "card list-item");
      var meta = el("div", "meta");
      renderMeta(q, meta);
      card.appendChild(meta);
      card.appendChild(el("p", "q-text", q.q));
      var ansWrap = el("div", "ans-wrap");
      answerBlock(q, ansWrap);
      card.appendChild(ansWrap);
      var cover = el("button", "btn ghost reveal-one", "答えを表示");
      cover.type = "button";
      cover.addEventListener("click", function () { card.classList.add("shown"); });
      card.appendChild(cover);
      if (vague) {
        var row = el("div", "list-grade");
        var ok = el("button", "btn ghost", "答えれた（あいまいから外す）");
        ok.type = "button";
        ok.addEventListener("click", function () {
          record(q.id, false);
          card.classList.add("cleared");
          row.textContent = "";
          row.appendChild(el("p", "hint", "あいまいから外しました。"));
          var left = vagueQuestions().length;
          $("list-info").textContent = "あいまいな問題 残り " + left + " 問";
        });
        row.appendChild(ok);
        card.appendChild(row);
      }
      body.appendChild(card);
    });
    show("list");
  }

  // ── イベント ──
  function bind() {
    document.querySelectorAll('input[name="mode"], input[name="filter"], input[name="count"], input[name="order"]')
      .forEach(function (i) { i.addEventListener("change", updatePoolInfo); });
    $("topic-list").addEventListener("change", updatePoolInfo);

    document.querySelectorAll("[data-select]").forEach(function (b) {
      b.addEventListener("click", function () {
        var on = b.dataset.select === "all";
        document.querySelectorAll('input[name="topic"]').forEach(function (c) { c.checked = on; });
        updatePoolInfo();
      });
    });

    $("start").addEventListener("click", function () {
      var pool = orderedPool();
      if (radioValue("order") === "print") pool = pool.slice(startIndex(pool));
      var count = parseInt(radioValue("count"), 10);
      if (count > 0) pool = pool.slice(0, count);
      if (pool.length) startSession(pool);
    });

    $("open-list").addEventListener("click", function () { showList("pool", "setup"); });
    $("vague-read").addEventListener("click", function () { showList("vague", "setup"); });
    $("vague-retry").addEventListener("click", function () {
      var qs = vagueQuestions();
      if (qs.length) startSession(qs);
    });
    $("result-read").addEventListener("click", function () { showList("vague", "result"); });
    $("hide-answers").addEventListener("change", function () {
      $("list-body").classList.toggle("hide-answers", $("hide-answers").checked);
      Array.prototype.forEach.call($("list-body").querySelectorAll(".list-item.shown"), function (c) { c.classList.remove("shown"); });
    });
    $("list-back").addEventListener("click", function () {
      if (listReturn === "result" && session) { show("result"); return; }
      updatePoolInfo(); show("setup");
    });
    $("next").addEventListener("click", next);
    $("quit").addEventListener("click", function () { showResult(false); });
    $("prev").addEventListener("click", prev);
    $("start-from").addEventListener("change", updatePoolInfo);
    $("resume-btn").addEventListener("click", function () {
      var saved = loadSessionState();
      if (!saved) { renderResume(); return; }
      startSession(saved.ids.map(function (id) { return byId[id]; }), saved.index, saved.results);
    });
    $("resume-discard").addEventListener("click", function () {
      clearSessionState();
      renderResume();
    });
    $("back").addEventListener("click", function () { updatePoolInfo(); show("setup"); });
    $("retry-wrong").addEventListener("click", function () {
      if (session && session.missed && session.missed.length) startSession(session.missed);
    });
    $("reset-history").addEventListener("click", function () {
      history = {};
      saveHistory(history);
      updatePoolInfo();
    });

    // キーボード：Space＝答えを見る、1＝答えれた、2＝あいまい、Enter＝次へ
    document.addEventListener("keydown", function (e) {
      if ($("quiz").hidden || !session) return;
      var reveal = $("q-body").querySelector(".w-actions .btn");
      if (e.key === " " && reveal && !reveal.parentNode.hidden) {
        e.preventDefault();
        reveal.click();
      } else if (/^[1-2]$/.test(e.key)) {
        var btns = $("feedback").querySelectorAll(".self .btn");
        if (btns.length) btns[parseInt(e.key, 10) - 1].click();
      } else if (e.key === "Enter" && !$("next").hidden && document.activeElement !== $("next")) {
        next();
      } else if (e.key === "ArrowLeft" && document.activeElement.tagName !== "SELECT") {
        prev();
      } else if (e.key === "ArrowRight" && !$("next").hidden) {
        next();
      }
    });
  }

  renderExam();
  renderTopics();
  bind();
  updatePoolInfo();
})();
