(function () {
  "use strict";

  var TOPICS = window.TOPICS || [];
  var QUESTIONS = window.QUESTIONS || [];
  var STORE_KEY = "imb-quiz-history-v1";
  var topicName = {};
  TOPICS.forEach(function (t) { topicName[t.key] = t.name; });

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
  function isWritten(q) { return q.type === "w"; }
  function radioValue(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }
  function show(id) {
    ["setup", "quiz", "result"].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  // ── 設定画面 ──
  function renderTopics() {
    var list = $("topic-list");
    list.textContent = "";
    TOPICS.forEach(function (t) {
      var mc = QUESTIONS.filter(function (q) { return q.t === t.key && !isWritten(q); }).length;
      var w = QUESTIONS.filter(function (q) { return q.t === t.key && isWritten(q); }).length;
      var label = el("label", "topic");
      var cb = el("input");
      cb.type = "checkbox"; cb.value = t.key; cb.checked = true; cb.name = "topic";
      var name = el("span", "name", t.name);
      name.appendChild(el("span", "sub", t.sub));
      var count = el("span", "count", "選択" + mc + "・記述" + w);
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
      if (mode === "mc" && isWritten(q)) return false;
      if (mode === "w" && !isWritten(q)) return false;
      if (filter === "past" && !(q.p && q.p.length)) return false;
      if (filter === "wrong" && !(history[q.id] && history[q.id].wrong)) return false;
      return true;
    });
  }

  function updatePoolInfo() {
    var n = buildPool().length;
    var wrongTotal = QUESTIONS.filter(function (q) { return history[q.id] && history[q.id].wrong; }).length;
    var count = parseInt(radioValue("count"), 10);
    var asked = count === 0 ? n : Math.min(n, count);
    $("pool-info").textContent = n === 0
      ? "条件に合う問題がありません"
      : "対象 " + n + " 問から " + asked + " 問を出題（前回まちがえた問題：" + wrongTotal + " 問）";
    $("start").disabled = n === 0;
  }

  // ── 出題 ──
  var session = null;

  function startSession(questions) {
    session = {
      items: questions.map(function (q) {
        var item = { q: q, answered: false, result: null, chosen: null };
        if (!isWritten(q)) {
          item.order = shuffle(q.c.map(function (_, i) { return i; }));
        }
        return item;
      }),
      index: 0
    };
    show("quiz");
    renderQuestion();
  }

  function scoreText() {
    var mc = session.items.filter(function (it) { return it.answered && !isWritten(it.q); });
    var ok = mc.filter(function (it) { return it.result === "ok"; }).length;
    return mc.length ? "正解 " + ok + " / " + mc.length : "";
  }

  function renderMeta(q, container) {
    container.textContent = "";
    container.appendChild(el("span", "tag", topicName[q.t] || q.t));
    container.appendChild(el("span", "tag type", isWritten(q) ? "記述" : "選択"));
    if (q.p && q.p.length) container.appendChild(el("span", "tag past", "過去問 " + q.p.join("・")));
    if (q.quiz) container.appendChild(el("span", "tag quiz", "確認問題"));
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
    var body = $("q-body");
    body.textContent = "";
    var fb = $("feedback");
    fb.hidden = true; fb.textContent = "";
    $("next").hidden = true;
    $("next").textContent = session.index === total - 1 ? "結果を見る" : "次へ";

    if (isWritten(q)) renderWritten(item, body);
    else renderChoices(item, body);
  }

  function renderChoices(item, body) {
    var q = item.q;
    var wrap = el("div", "choices");
    item.order.forEach(function (origIndex, pos) {
      var b = el("button", "choice");
      b.type = "button";
      b.dataset.orig = String(origIndex);
      b.appendChild(el("span", "num", String(pos + 1)));
      b.appendChild(el("span", "", q.c[origIndex]));
      b.addEventListener("click", function () { answerChoice(item, origIndex); });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }

  function answerChoice(item, origIndex) {
    if (item.answered) return;
    item.answered = true;
    item.chosen = origIndex;
    item.result = origIndex === 0 ? "ok" : "ng";
    record(item.q.id, item.result !== "ok");

    var buttons = $("q-body").querySelectorAll(".choice");
    Array.prototype.forEach.call(buttons, function (b) {
      b.disabled = true;
      var o = parseInt(b.dataset.orig, 10);
      if (o === 0) b.classList.add("correct");
      else if (o === origIndex) b.classList.add("wrong");
    });

    var fb = $("feedback");
    fb.textContent = "";
    var v = el("p", "verdict " + (item.result === "ok" ? "ok" : "ng"), item.result === "ok" ? "正解" : "不正解");
    fb.appendChild(v);
    fb.appendChild(el("p", "", item.q.e));
    fb.hidden = false;
    $("q-score").textContent = scoreText();
    $("next").hidden = false;
    $("next").focus();
  }

  function renderWritten(item, body) {
    var q = item.q;
    var ta = el("textarea");
    ta.placeholder = "ここに解答を書く（任意）。書き終えたら「模範解答を見る」を押してください。";
    ta.value = item.draft || "";
    ta.addEventListener("input", function () { item.draft = ta.value; });
    body.appendChild(ta);

    var actions = el("div", "w-actions");
    var reveal = el("button", "btn primary", "模範解答を見る");
    reveal.type = "button";
    actions.appendChild(reveal);
    body.appendChild(actions);

    reveal.addEventListener("click", function () {
      reveal.disabled = true;
      var fb = $("feedback");
      fb.textContent = "";
      var model = el("div", "model");
      model.appendChild(el("h3", "", "入れたいキーワード（入っていたらチェック）"));
      var ul = el("ul", "keys");
      (q.k || []).forEach(function (k) {
        var li = el("li");
        var lab = el("label");
        var cb = el("input"); cb.type = "checkbox";
        lab.appendChild(cb); lab.appendChild(el("span", "", k));
        li.appendChild(lab); ul.appendChild(li);
      });
      model.appendChild(ul);
      model.appendChild(el("h3", "", "模範解答の骨子"));
      model.appendChild(el("p", "", q.a));
      model.appendChild(el("h3", "", "自己採点"));
      var self = el("div", "self");
      [["ok", "書けた", "sel-ok"], ["mid", "一部書けた", "sel-mid"], ["ng", "書けなかった", "sel-ng"]].forEach(function (s) {
        var b = el("button", "btn ghost", s[1]);
        b.type = "button";
        b.addEventListener("click", function () {
          Array.prototype.forEach.call(self.querySelectorAll(".btn"), function (x) {
            x.classList.remove("sel-ok", "sel-mid", "sel-ng");
          });
          b.classList.add(s[2]);
          item.answered = true;
          item.result = s[0];
          record(q.id, s[0] !== "ok");
          $("next").hidden = false;
        });
        self.appendChild(b);
      });
      model.appendChild(self);
      fb.appendChild(model);
      fb.hidden = false;
    });
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
  function showResult() {
    var done = session.items.filter(function (it) { return it.answered; });
    var mc = done.filter(function (it) { return !isWritten(it.q); });
    var w = done.filter(function (it) { return isWritten(it.q); });
    var ok = mc.filter(function (it) { return it.result === "ok"; }).length;

    if (mc.length) {
      $("result-score").textContent = Math.round(ok / mc.length * 100) + "%";
      $("result-sub").textContent = "選択問題 " + ok + " / " + mc.length + " 問正解" +
        (w.length ? "・記述 " + w.length + " 問" : "");
    } else {
      var wok = w.filter(function (it) { return it.result === "ok"; }).length;
      $("result-score").textContent = wok + " / " + w.length;
      $("result-sub").textContent = w.length ? "記述問題で「書けた」と自己採点した数" : "解答した問題がありません";
    }

    var missed = done.filter(function (it) { return it.result !== "ok"; });
    $("retry-wrong").hidden = missed.length === 0;

    var review = $("review");
    review.textContent = "";
    if (missed.length) {
      review.appendChild(el("h2", "review-title", "復習する問題（" + missed.length + "問）"));
      missed.forEach(function (it) {
        var q = it.q;
        var card = el("article", "card review-item" + (it.result === "mid" ? " mid" : ""));
        var meta = el("div", "meta");
        renderMeta(q, meta);
        card.appendChild(meta);
        card.appendChild(el("p", "q-text", q.q));
        if (isWritten(q)) {
          var a = el("p", "ans");
          a.appendChild(el("b", "", "模範解答："));
          a.appendChild(document.createTextNode(q.a));
          card.appendChild(a);
          if (q.k && q.k.length) card.appendChild(el("p", "exp", "キーワード：" + q.k.join("／")));
        } else {
          var ans = el("p", "ans");
          ans.appendChild(el("b", "", "正解："));
          ans.appendChild(document.createTextNode(q.c[0]));
          card.appendChild(ans);
          card.appendChild(el("p", "yours", "あなたの解答：" + q.c[it.chosen]));
          card.appendChild(el("p", "exp", q.e));
        }
        review.appendChild(card);
      });
    } else if (done.length) {
      review.appendChild(el("p", "hint", "全問正解です。"));
    }

    session.missed = missed.map(function (it) { return it.q; });
    show("result");
  }

  // ── イベント ──
  function bind() {
    document.querySelectorAll('input[name="topic"], input[name="mode"], input[name="filter"], input[name="count"]')
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
      var pool = shuffle(buildPool());
      var count = parseInt(radioValue("count"), 10);
      if (count > 0) pool = pool.slice(0, count);
      if (pool.length) startSession(pool);
    });

    $("next").addEventListener("click", next);
    $("quit").addEventListener("click", showResult);
    $("back").addEventListener("click", function () { updatePoolInfo(); show("setup"); });
    $("retry-wrong").addEventListener("click", function () {
      if (session && session.missed && session.missed.length) startSession(shuffle(session.missed));
    });
    $("reset-history").addEventListener("click", function () {
      history = {};
      saveHistory(history);
      updatePoolInfo();
    });

    document.addEventListener("keydown", function (e) {
      if ($("quiz").hidden || !session) return;
      if (e.target && e.target.tagName === "TEXTAREA") return;
      var item = session.items[session.index];
      if (!isWritten(item.q) && !item.answered && /^[1-9]$/.test(e.key)) {
        var pos = parseInt(e.key, 10) - 1;
        if (pos < item.order.length) answerChoice(item, item.order[pos]);
      } else if (e.key === "Enter" && !$("next").hidden && document.activeElement !== $("next")) {
        next();
      }
    });
  }

  renderTopics();
  bind();
  updatePoolInfo();
})();
