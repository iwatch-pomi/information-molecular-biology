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

  function orderedPool() {
    var pool = buildPool();
    if (radioValue("order") === "random") return shuffle(pool);
    // まとめプリントの順（分野の順 → データ内の順）
    return pool.slice().sort(function (a, b) {
      return (topicOrder[a.t] - topicOrder[b.t]) || (QUESTIONS.indexOf(a) - QUESTIONS.indexOf(b));
    });
  }

  function updatePoolInfo() {
    var n = buildPool().length;
    var wrongTotal = QUESTIONS.filter(function (q) { return history[q.id] && history[q.id].wrong; }).length;
    var count = parseInt(radioValue("count"), 10);
    var asked = count === 0 ? n : Math.min(n, count);
    $("pool-info").textContent = n === 0
      ? "条件に合う問題がありません"
      : "対象 " + n + " 問から " + asked + " 問を出題（あいまい：" + wrongTotal + " 問）";
    $("filter-vague-label").textContent = "あいまいな問題だけ（" + wrongTotal + "）";
    $("start").disabled = n === 0;
    $("open-list").disabled = n === 0;
  }

  // ── 出題 ──
  var session = null;

  function startSession(questions) {
    session = {
      items: questions.map(function (q) { return { q: q, answered: false, result: null }; }),
      index: 0
    };
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
    $("next").hidden = true;
    $("next").textContent = session.index === total - 1 ? "結果を見る" : "次へ";

    body.appendChild(el("p", "think", q.type === "term"
      ? "1〜2文で意味を言えるか、頭の中で答えてみてください。"
      : "試験のつもりで、説明の流れとキーワードを頭の中で組み立ててみてください。"));

    var actions = el("div", "w-actions");
    var reveal = el("button", "btn primary", "答えを見る");
    reveal.type = "button";
    actions.appendChild(reveal);
    body.appendChild(actions);
    reveal.addEventListener("click", function () { revealAnswer(item, reveal); });
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
      renderQuestion();
    } else {
      showResult();
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

  function showResult() {
    var done = session.items.filter(function (it) { return it.answered; });
    var ok = done.filter(function (it) { return it.result === "ok"; }).length;
    var ng = done.length - ok;

    $("result-score").textContent = done.length ? ok + " / " + done.length : "—";
    $("result-sub").textContent = done.length
      ? "答えれた " + ok + " 問・あいまい " + ng + " 問"
      : "記録した問題がありません";

    var missed = done.filter(function (it) { return it.result !== "ok"; });
    $("retry-wrong").hidden = missed.length === 0;

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
  function showList() {
    var pool = buildPool().slice().sort(function (a, b) {
      return (topicOrder[a.t] - topicOrder[b.t]) || (QUESTIONS.indexOf(a) - QUESTIONS.indexOf(b));
    });
    var body = $("list-body");
    body.textContent = "";
    $("list-info").textContent = (radioValue("filter") === "wrong" ? "あいまいな問題 " : "") + pool.length + " 問";
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
      answerBlock(q, card);
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
      var count = parseInt(radioValue("count"), 10);
      if (count > 0) pool = pool.slice(0, count);
      if (pool.length) startSession(pool);
    });

    $("open-list").addEventListener("click", showList);
    $("list-back").addEventListener("click", function () { updatePoolInfo(); show("setup"); });
    $("next").addEventListener("click", next);
    $("quit").addEventListener("click", showResult);
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
      }
    });
  }

  renderExam();
  renderTopics();
  bind();
  updatePoolInfo();
})();
