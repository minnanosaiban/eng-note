// 英語ノート: 英文タブ(eng-sentence の「英文」タブと同じ)・解説タブ(Markdown)・同期タブ
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ymd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };

  let rows = [];                                   // 英文の表
  let notes = [];                                  // 解説の表
  let tab = "pick";
  let prefs = { slashMain: false, sh: { gap: 0, rep: 1 }, rate: 1, pick: { tns: true, gram: true, ja: true, label: true, part: true, level: true, groups: true } };

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800) }
  const savePrefs = () => Store.setMeta("prefs", prefs).catch(() => {});
  const oneLine = s => String(s || "").replace(/\s+/g, " ").trim();
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // id は作った順に並ぶ
  const sortAll = () => { rows.sort(byId); notes.sort(byId) };
  const download = (name, text, type = "text/plain;charset=utf-8") => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) };
  const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f) });
  const rowOf = text => rows.find(r => r.text.toLowerCase() === String(text).toLowerCase());
  // 解説(文構造・文法の解説・TOEIC・単語・IU・4択など)が足りないもの
  const needsAI = r => !r.ja || !r.slash || !r.phrases || !r.words || !r.iu || !(r.vocab && r.vocab.length) || !r.quiz || !(r.syntax && r.syntax.length)
    || !(r.elements && r.elements.length) || !r.pattern || !(r.grammar && r.grammar.length) || !r.toeic;

  // ---------- 取り込み ----------
  // 同じ英文があれば、足りないものだけ足す。なければ追加(外から来た値は Clean.sentence で検査して作り直す)
  async function importSentences(list, { keepState = false } = {}) {
    const have = new Map(rows.map(r => [r.text.toLowerCase(), r]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const s = Clean.sentence(o, { keepState }); if (!s) continue;
      const ex = have.get(s.text.toLowerCase());
      if (ex) { if (Clean.fill(ex, s)) { touched.push(ex); u++ } continue }
      rows.push(s); have.set(s.text.toLowerCase(), s); touched.push(s); n++;
    }
    if (touched.length) await Store.put(touched, "sentences");
    sortAll(); return { n, u };
  }
  async function importNotes(list) {
    const have = new Set(notes.map(x => x.id)); const add = [];
    for (const x of list) {
      if (!x || typeof x.text !== "string" || !x.text.trim()) continue;
      const id = typeof x.id === "string" && x.id ? x.id : Clean.uid();
      if (have.has(id)) continue; have.add(id);
      add.push({ id, text: Clean.clip(x.text, 120), body: String(x.body || ""), groups: Array.isArray(x.groups) ? x.groups.filter(g => typeof g === "string") : [], created: +x.created || Date.now(), updated: +x.updated || Date.now() });
    }
    if (add.length) { notes.push(...add); await Store.put(add, "notes"); sortAll() }
    return add.length;
  }
  function parseCsv(text) {
    const out = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = "" }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = "" }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); out.push(row) }
    return out.filter(r => r.some(x => x.trim()));
  }
  const splitGroups = t => [...new Set(String(t || "").split(/[、,]/).map(x => x.trim()).filter(Boolean))];
  // ファイルの中身 → { sentences, notes }。.json はアプリのバックアップ・解析済みの英文(試作の形 {groups, items} も)、.csv / .txt は英文だけ
  function parseFile(name, text) {
    if (/\.json$/i.test(name)) {
      const j = JSON.parse(text);
      if (Array.isArray(j.sentences) || Array.isArray(j.notes)) return { sentences: Array.isArray(j.sentences) ? j.sentences : [], notes: Array.isArray(j.notes) ? j.notes : [] };
      if (Array.isArray(j.items)) { const gn = new Map((j.groups || []).map(g => [g.id, g.name])); return { sentences: j.items.map(x => ({ ...x, groups: [...(x.groups || []), ...(x.gids || []).map(i => gn.get(i)).filter(Boolean)] })), notes: [] } }
      throw new Error("英文が見つかりません");
    }
    if (/\.csv$/i.test(name)) return { sentences: parseCsv(text).map(r => ({ text: r[0], groups: splitGroups(r[1]) })), notes: [] };
    return { sentences: text.split(/\r?\n/).map(x => ({ text: x })), notes: [] };
  }

  // ---------- タブ ----------
  function setTab(t) {
    tab = t; stopAudio();
    document.querySelectorAll("#tabs button[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    document.querySelectorAll(".tab").forEach(s => { s.hidden = s.id !== "tab-" + t });
    if (t === "sync") { Sync.render(); renderInfo() }
    if (t === "pick") renderPick();
    if (t === "note") renderNotes();
    try { localStorage.setItem("tab", t) } catch {}
    selBtnUpdate();
  }
  $("#tabs").onclick = e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab) };
  $("#syncStatus").onclick = () => setTab("sync");

  // ---------- 選択(英文タブ) ----------
  const pickOn = k => k === "g:" ? true : prefs.pick[k] !== false && (k.startsWith("g:") || !!prefs.pick[k]); // 文法の種類ごとの入り切りは、未設定なら「出す」
  const allGroups = () => [...new Set(rows.flatMap(r => r.groups || []))].sort();
  // シャッフル: 一覧の並び順を、ランダムにする(聞く順も、この並び順)。この画面だけのもので、保存はしない
  let shuf = null; // null=元の順 / Map(id → 順位)
  const shuffleOrder = () => {
    const ids = rows.map(r => r.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
    shuf = new Map(ids.map((id, i) => [id, i]));
  };
  function filtered() {
    const q = $("#fq").value.trim().toLowerCase(), g = $("#fgroup").value, lb = $("#flabel").value ? [$("#flabel").value] : [], fx = $("#fexpl").value;
    const out = rows.filter(r =>
      (!q || r.text.toLowerCase().includes(q) || (r.ja || "").includes(q)) &&
      (!lb.length || lb.some(l => (l === "none" ? !r.label : String(r.label) === l))) &&
      (!fx || (fx === "no") === !!needsAI(r)) &&
      inGroup(r, g));
    return shuf ? out.sort((a, b) => (shuf.get(a.id) ?? 1e9) - (shuf.get(b.id) ?? 1e9)) : out;
  }
  // 「グループ」の選択肢は、パート → 難易度 → 自分で付けたグループ の順(ラベルは、別の絞り込み)。値は、種類の印(p: パート / v: 難易度 / g: グループ)+ 中身
  const PART_NAMES = { "Part 1": "写真描写", "Part 2": "応答問題", "Part 3": "会話", "Part 4": "説明文", "Part 5": "短文穴埋め", "Part 6": "長文穴埋め", "Part 7": "読解" };
  function inGroup(r, g) {
    if (!g) return true;
    const k = g[0], v = g.slice(2);
    if (k === "p") return v === "none" ? !Clean.partOf(r) : Clean.partOf(r) === v;
    if (k === "v") return String(r.level) === v;
    return (r.groups || []).includes(v);
  }
  function renderGroupSelect() {
    const cur = $("#fgroup").value, o = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    const opts = [`<option value="">グループ</option>`];
    opts.push(...Object.entries(PART_NAMES).map(([k, n]) => o("p:" + k, `${k} ${n}`)), o("p:none", "パート未設定"));
    opts.push(...[600, 730, 860].map(n => o("v:" + n, "難易度 " + n)));
    opts.push(...allGroups().map(g => o("g:" + g, g)));
    $("#fgroup").innerHTML = opts.join("");
    $("#fgroup").value = [...$("#fgroup").options].some(x => x.value === cur) ? cur : "";
  }
  // 文の要素(S V O C M)ごとに / で区切り、下に記号を付けた表示
  const elsInner = (els, vTag = "") => { const vi = vTag ? els.findIndex(e => e.role === "V") : -1; return els.map((e, i) => (i ? '<span class="slsep">/</span>' : "") + `<span class="el-i" title="${esc(e.note || "")}"><span class="el-t">${esc(e.text)}</span><span class="el-r">${esc(e.role)}${i === vi ? vTag : ""}</span></span>`).join("") };
  const elsShow = new Set(); // 「文」ボタンで、S V O C M の区切りを出している英文
  const slashJa = r => (r.slash && r.slash.length && r.slash.every(s => s.ja) ? r.slash.map(s => s.ja.trim()).join("/") : ""); // 区切りごとの訳を「/」でつなげた和訳
  const jaText = r => { const j = slashJa(r) || r.ja; return j ? esc(j) : `<span class="sub">(和訳なし)</span>` };
  const jaEdit = r => ` <button type="button" class="jt" data-jedit="${r.id}" title="和訳を直す" aria-label="和訳を直す">✎</button>`;
  const jaShow = new Set(); // 「訳」ボタンで和訳を出している英文(初期は、どれも和訳を隠す)
  const jaTail = ja => { const t = (ja || "").replace(/[。.\s]+$/, ""), i = Math.max(...[..."にをでへとがは"].map(c => t.lastIndexOf(c))); return i > 0 ? "～" + t.slice(i) : t };
  const safe = (f, d) => { try { return f() } catch { return d } };
  function pickRow(r) {
    const part = Clean.partOf(r);
    const gAll = safe(() => Clean.gramTags(r), []), jt = ((gAll.find(x => x.k === "自他") || {}).t || "").slice(0, 1); // 自動詞・他動詞 → 自・他
    const ta = safe(() => Clean.tenseTags(r.tense), null), tt = prefs.pick.tns ? ta : null; // ta: 態・時制・相(ボタンに関係なく)。tt: 下のタグの行に出す分
    const elsOn = elsShow.has(r.id) && !!(r.elements && r.elements.length), vOn = !!(ta && elsOn && r.elements.some(e => e.role === "V")), tnsChip = ta ? `<span class="tag tns">${ta.voice}・${ta.tns}・${ta.asp}${jt ? "・" + jt : ""}</span>` : "";
    const gt = pickOn("g:") ? gAll.filter(x => x.k !== "自他" && pickOn("g:" + x.k)) : [];
    const gtag = x => `<span class="tag gm" title="${x.k}">${esc(x.t + (x.w ? " " + x.w : ""))}</span>${Clean.gjaOf(x) ? `<span class="gja">${esc(Clean.gjaOf(x))}</span>` : ""}`,
      gHead = x => x.k === "文型" || x.k === "文の種類"; // 文型 → 文の種類 → 態・時制・相 → ほかの文法 の順
    const tags = `${gt.filter(gHead).map(gtag).join("")}${tt ? `${tnsChip}${r.ja ? `<span class="gja">${esc(jaTail(r.ja))}</span>` : ""}${tt.sub.map(s => `<span class="gja">${esc(s.conj || "")}</span><span class="tag tns">${s.voice}・${s.tns}・${s.asp}</span>${s.ja ? `<span class="gja">${esc(s.ja)}</span>` : ""}`).join("")}` : ""}${gt.filter(x => !gHead(x)).map(gtag).join("")}${prefs.pick.groups ? `${part ? `<span class="tag">${part}</span>` : ""}${r.level ? `<span class="tag">${r.level}</span>` : ""}${r.label ? `<span class="tag">ラベル ${r.label}</span>` : ""}` : ""}${needsAI(r) ? '<span class="tag noexpl" title="解説(文構造・文法・TOEIC・単語など)がまだ足りません">解説なし</span>' : ""}${prefs.pick.groups ? (r.groups || []).map(g => `<span class="tag">${esc(g)}</span>`).join("") : ""}`;
    const body = `${prefs.slashMain && r.slash && r.slash.length ? r.slash.map(x => esc(x.en)).join(' <span class="slsep">/</span> ') : esc(r.text)}${elsOn ? `<div class="elsrow">${elsInner(r.elements, vOn ? tnsChip : "")}</div>` : ""}<div class="m jx"${jaShow.has(r.id) ? "" : " hidden"}>${jaText(r)}${jaEdit(r)}</div>`;
    const spd = v => `<button type="button" class="sm from spd" data-from="${r.id}" data-rate="${v}" title="${v} の速さで、ここから順に聞く(聞いている間は、もう一度押すと止める)" aria-label="${v} の速さで、ここから順に聞く。聞いている間は止める">${v}</button>`;
    return `<label class="row-i"><span class="chk"><input type="checkbox" data-id="${r.id}" hidden>${spd("1.0")}${spd("0.8")}${spd("0.5")}</span><span class="t">${body}<span class="m"><br>${tags}</span></span><span class="side">${r.elements && r.elements.length ? `<button type="button" class="jt els" data-els="${r.id}" aria-pressed="${elsShow.has(r.id)}" title="S V O C M の区切りを、表示・非表示" aria-label="S V O C M の区切りを、表示・非表示">文</button>` : ""}<button type="button" class="jt" data-ja="${r.id}" title="和訳の表示・非表示" aria-label="和訳の表示・非表示">訳</button></span></label>`;
  }
  let selIds = new Set(); // 一覧に出ている英文すべて(.txt保存・ラベル付け・削除の対象)
  function renderPick() {
    $("#btnSlashPick").setAttribute("aria-pressed", String(!!prefs.slashMain));
    $("#btnShuffle").setAttribute("aria-pressed", String(!!shuf)); $("#btnUnshuffle").hidden = !shuf;
    document.querySelectorAll("#pickMenu button[data-p]").forEach(b => b.setAttribute("aria-pressed", String(pickOn(b.dataset.p))));
    renderGroupSelect(); $("#pGap").value = String(prefs.sh.gap); $("#pRep").value = String(prefs.sh.rep);
    const list = filtered();
    $("#pickList").innerHTML = list.length ? list.map(pickRow).join("")
      : `<p class="sub">${rows.length ? "条件に合うものがありません。" : "英文がありません。「＋ 英文」で足すか、「同期」の「データの読み込み」で入れてください。"}</p>`;
    selIds = new Set(list.map(r => r.id));
    pickInfo(list.length);
  }
  function pickInfo(shown) {
    $("#explInfo").textContent = `解説なし ${rows.filter(needsAI).length} 文`;
    $("#pickInfo").textContent = `表示 ${shown ?? filtered().length} 件 / 全 ${rows.length} 件`;
    $("#btnDelSel").disabled = selIds.size === 0;
    const t = selIds.size ? `表示中の ${selIds.size} 件を削除` : "表示中のものを削除"; $("#btnDelSel").title = t; $("#btnDelSel").setAttribute("aria-label", t);
  }
  function renderInfo() { const e = $("#regInfo"); if (e) e.textContent = `英文 ${rows.length} 文・解説 ${notes.length} 件が登録されています。` }
  $("#pickOff").onclick = () => { document.querySelectorAll("#pickShow button[data-p]").forEach(x => { prefs.pick[x.dataset.p] = false }); savePrefs(); renderPick() }; // 文型〜比較の表示を、すべて外す
  $("#pickMenu").addEventListener("click", e => { const b = e.target.closest("button[data-p]"); if (b) { prefs.pick[b.dataset.p] = !pickOn(b.dataset.p); savePrefs(); renderPick() } });
  ["#fq", "#fgroup", "#flabel", "#fexpl"].forEach(s => { $(s).addEventListener("input", renderPick); $(s).addEventListener("input", () => stopAudio()) });
  $("#btnSlashPick").onclick = () => { prefs.slashMain = !prefs.slashMain; savePrefs(); renderPick() };
  // シャッフル: 押すたびに並べ直す。「元の順」で戻す。聞いている途中なら、止めてから並べ直す
  $("#btnShuffle").onclick = () => { stopAudio(); shuffleOrder(); renderPick(); window.scrollTo({ top: 0 }) };
  $("#btnUnshuffle").onclick = () => { stopAudio(); shuf = null; renderPick() };

  // .txt 保存(表示中の英文)
  function saveTxt(lines, name) { download(`${name}-${ymd()}.txt`, lines.join("\n") + "\n") }
  $("#btnPickTxt").onclick = () => {
    const lines = rows.filter(r => selIds.has(r.id)).map(r => String(r.text || "").replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    if (!lines.length) return toast("英文が選ばれていません");
    saveTxt(lines, "eng-note-selected");
  };

  // ラベル(1〜5。付けるかどうかは任意)。表示中の英文に付ける
  $("#labelBtns").onclick = async e => {
    const b = e.target.closest("button[data-l]"); if (!b) return;
    const l = rows.filter(r => selIds.has(r.id)); if (!l.length) return toast("ラベルを付ける英文がありません");
    if (!confirm(`表示中の ${l.length} 文に、${+b.dataset.l ? "ラベル " + b.dataset.l + " を付け" : "ついているラベルを外し"}ます。よろしいですか?`)) return;
    const n = +b.dataset.l;
    l.forEach(r => { if (n) r.label = n; else delete r.label });
    await Store.put(l, "sentences"); renderPick(); toast(n ? `${l.length} 文に、ラベル ${n} を付けました` : `${l.length} 文の、ラベルを外しました`);
  };

  // ---------- 追加(＋ボタン) ----------
  function toggleForm(btn, box, focus) {
    const open = $(box).hidden; $(box).hidden = !open; $(btn).setAttribute("aria-expanded", String(open));
    if (open && focus) $(focus).focus();
  }
  // 英文 + 和訳。解説は付けないので、一覧に「解説なし」と出る
  $("#btnAddSent").onclick = () => toggleForm("#btnAddSent", "#addSent", "#addSentText");
  $("#addSentCancel").onclick = () => toggleForm("#btnAddSent", "#addSent");
  $("#addSentOk").onclick = async () => {
    const text = oneLine($("#addSentText").value), ja = oneLine($("#addSentJa").value), g = oneLine($("#addSentGroup").value);
    if (!text) return toast("英文を入力してください");
    const had = rowOf(text);
    const r = await importSentences([{ text, ja, groups: g ? [g] : [] }]);
    const x = rowOf(text); if (x && !had && x.ja) { x.verified = true; await Store.put(x, "sentences") } // 自分で書いた和訳は、確認済み
    $("#addSentText").value = ""; $("#addSentJa").value = ""; $("#addSentText").focus();
    renderPick(); toast(r.n ? "追加しました" : r.u ? "すでにある英文に、足りない項目を足しました" : "すでに登録されています");
  };

  // ---------- 削除 ----------
  async function confirmDelete(ids) {
    if (!ids.length) return;
    if (!confirm(`${ids.length} 件の英文を削除します。\n同期している場合は、ほかの端末からも消えます。元に戻せません。よろしいですか?`)) return;
    const set = new Set(ids);
    rows = rows.filter(r => !set.has(r.id)); await Store.del(ids, "sentences");
    stopAudio(); renderPick(); toast(`${ids.length} 件の英文を削除しました`);
  }
  $("#btnDelSel").onclick = () => confirmDelete(rows.filter(r => selIds.has(r.id)).map(r => r.id));

  // ---------- 一覧の行の操作 ----------
  $("#pickList").addEventListener("click", async e => { // 和訳を直す(✎)
    const b = e.target.closest("button[data-jedit]"); if (!b) return; e.preventDefault();
    const r = rows.find(x => x.id === b.dataset.jedit); if (!r) return;
    const v = prompt("和訳を直します。空にすると、和訳を消します。", r.ja || ""); if (v === null) return;
    r.ja = Clean.clip(v, 500); await Store.put(r, "sentences"); renderPick(); toast("和訳を保存しました");
  });
  // 行の「訳」を押すと、その行の和訳を出す・隠す
  $("#pickList").addEventListener("click", e => { const b = e.target.closest("button[data-ja]"); if (!b) return; e.preventDefault(); const id = b.dataset.ja, x = b.closest(".row-i").querySelector(".jx"); jaShow.has(id) ? jaShow.delete(id) : jaShow.add(id); if (x) x.hidden = !x.hidden });
  $("#pickList").addEventListener("click", e => { const b = e.target.closest("button[data-els]"); if (!b) return; e.preventDefault(); const id = b.dataset.els; elsShow.has(id) ? elsShow.delete(id) : elsShow.add(id); renderPick() });
  // 英文をなぞって選んだとき、行の操作が起きないようにする
  $("#pickList").addEventListener("click", e => { if (!e.target.closest("button") && window.getSelection().toString().trim()) e.preventDefault() }, true);
  // 行の 1.0 / 0.8 / 0.5 を押すと、その速さで、その行から順に聞く(聞いている間は、もう一度押すと止める)
  $("#pickList").addEventListener("click", e => {
    const b = e.target.closest("button[data-from]"); if (!b) return; e.preventDefault();
    if (b.closest(".row-i.now")) { stopAudio(); document.querySelectorAll("#pickList .row-i.now").forEach(x => x.classList.remove("now")); return }
    if (b.dataset.rate) { prefs.rate = +b.dataset.rate; savePrefs() }
    playPick(b.dataset.from);
  });

  // ---------- 音声(端末の読み上げ) ----------
  let playing = 0; // 世代番号。止める・次へ行くと増やして、前の読み上げを無効にする
  const sleep = (ms, me) => new Promise(res => { const t0 = Date.now(), iv = setInterval(() => { if (me !== playing || Date.now() - t0 >= ms) { clearInterval(iv); res() } }, 80) });
  const sayTimed = async (text, rate) => { const t0 = performance.now(); await say(text, rate); return performance.now() - t0 };
  const pst = msg => { if (!msg) { $("#pickPst").textContent = ""; document.querySelectorAll("#pickList .row-i.now").forEach(x => x.classList.remove("now")) } };
  function stopAudio() { playing++; pst(null); try { speechSynthesis.cancel() } catch {} }
  function say(text, rate = prefs.rate, pitch = 1) {
    return new Promise(res => {
      if (!("speechSynthesis" in window)) return res();
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = rate; u.pitch = pitch;
      const v = speechSynthesis.getVoices().find(x => /^en[-_]US/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }
  $("#pGap").onchange = e => { prefs.sh.gap = +e.target.value; savePrefs() };
  $("#pRep").onchange = e => { prefs.sh.rep = +e.target.value; savePrefs() };
  // 表示中の英文を、上から順に聞く(from: 聞き始める行の id。無ければ、いちばん上から)。繰り返し: 同じ英文を、設定の回数だけ続けて聞く
  const playPick = async from => {
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    const list = filtered(); if (!list.length) return toast("聞く英文がありません");
    stopAudio(); const me = playing, rep = prefs.sh.rep, gap = +prefs.sh.gap || 0;
    for (let n = Math.max(0, list.findIndex(r => r.id === from)); n < list.length; n++) {
      const r = list[n];
      document.querySelectorAll("#pickList .row-i.now").forEach(x => x.classList.remove("now"));
      const row = document.querySelector(`#pickList input[data-id="${r.id}"]`), li = row && row.closest(".row-i");
      if (li) { li.classList.add("now"); li.scrollIntoView({ block: "center", behavior: "smooth" }) }
      for (let k = 1; k <= rep; k++) {
        if (me !== playing) return;
        $("#pickPst").textContent = `${n + 1} / ${list.length}${rep > 1 ? ` ・ ${k}回目` : ""}`;
        const ms = await sayTimed(r.text); if (me !== playing) return;
        if (gap) { const wait = Practice.gap(ms, r.text, gap, prefs.rate); $("#pickPst").textContent = `${n + 1} / ${list.length} ・ まねする(${(wait / 1000).toFixed(1)}秒)`; await sleep(wait, me) }
        else if (k < rep) await sleep(400, me);
      }
      if (me !== playing) return;
      if (n < list.length - 1) await sleep(500, me);
    }
    if (me === playing) { pst(null); toast("最後まで聞きました") }
  };
  // 英文の中の語を、なぞって(長押しして)選ぶと、「▶ 聞く」が出る。選んだ部分だけを、繰り返し・間の設定で聞く
  function disSel() {
    const sel = window.getSelection(), d = $("#pickList");
    if (!sel || sel.isCollapsed || !sel.rangeCount || !d.contains(sel.anchorNode) || !d.contains(sel.focusNode)) return "";
    return sel.toString().replace(/\s+/g, " ").trim();
  }
  let selTimer = 0;
  function selBtnUpdate() {
    const b = $("#selPlay"), t = tab === "pick" ? disSel() : "";
    if (!t) { b.hidden = true; return }
    const rc = window.getSelection().getRangeAt(0).getBoundingClientRect();
    b.hidden = false; b.style.top = Math.max(8, rc.bottom + 6) + "px";
    b.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - b.offsetWidth - 8)) + "px";
  }
  document.addEventListener("selectionchange", () => { clearTimeout(selTimer); selTimer = setTimeout(selBtnUpdate, 150) });
  window.addEventListener("scroll", () => { if (!$("#selPlay").hidden) selBtnUpdate() }, { passive: true });
  $("#selPlay").onpointerdown = e => e.preventDefault(); // 押しても、選択が消えないように
  $("#selPlay").onclick = async () => {
    const text = disSel(); if (!text) return;
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    playing++; try { speechSynthesis.cancel() } catch {} const me = playing; // 表示は作り直さない(選択が消えるため)
    const rep = prefs.sh.rep, gap = +prefs.sh.gap || 0;
    for (let k = 1; k <= rep; k++) {
      if (me !== playing) return;
      $("#pickPst").textContent = rep > 1 ? `${k}回目` : "聞く";
      const ms = await sayTimed(text); if (me !== playing) return;
      if (gap) { const wait = Practice.gap(ms, text, gap, prefs.rate); $("#pickPst").textContent = `まねする(${(wait / 1000).toFixed(1)}秒)`; await sleep(wait, me) }
      else if (k < rep) await sleep(400, me);
    }
    if (me === playing) pst(null);
  };

  // ---------- データの読み込み・バックアップ(同期タブ) ----------
  $("#fileData").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const d = parseFile(f.name, await readFile(f)), json = /\.json$/i.test(f.name);
      const r = await importSentences(d.sentences, { keepState: json }), nn = await importNotes(d.notes);
      renderPick(); renderNotes(); renderInfo();
      toast(`${f.name}: 英文 ${r.n} 件を追加${r.u ? `(${r.u} 件に足りない項目を追加)` : ""}${nn ? `・解説 ${nn} 件を追加` : ""}`);
    } catch (x) { toast("読み込めませんでした: " + x.message) }
  };
  $("#btnExport").onclick = () => download(`eng-note-backup-${ymd()}.json`, JSON.stringify({ sentences: rows, notes }, null, 1), "application/json");
  $("#btnClear").onclick = async () => {
    if (!rows.length || !confirm(`英文 ${rows.length} 文を、すべて削除します(解説は残ります)。同期している場合は、ほかの端末からも消えます。よろしいですか?`)) return;
    await Store.del(rows.map(r => r.id), "sentences"); rows = []; stopAudio(); renderPick(); renderInfo(); toast("削除しました");
  };

  // ---------- 解説(Markdown) ----------
  const groupsOf = n => n.groups || [];
  let editNote = null; const openNotes = new Set();
  const sortedNotes = () => notes.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  function renderNotes() {
    const q = $("#nq").value.trim().toLowerCase();
    const a = sortedNotes().filter(n => !q || n.text.toLowerCase().includes(q) || (n.body || "").toLowerCase().includes(q));
    $("#nInfo").textContent = `${a.length} / ${notes.length} 件`;
    $("#noteList").innerHTML = a.length ? a.map(n => `<div class="note-i" data-id="${n.id}">
      <div class="nt" data-a="toggle"><b>${esc(n.text)}</b>${groupsOf(n).map(g => `<span class="tag">${esc(g)}</span>`).join("")}<button class="sm" data-a="edit">編集</button></div>
      ${openNotes.has(n.id) ? `<div class="body md">${Md.render(n.body)}</div>` : ""}</div>`).join("")
      : '<div class="card sub">解説がありません。「＋ 解説を追加」から、Markdown を貼り付けて追加します。</div>';
  }
  $("#nq").addEventListener("input", renderNotes);
  $("#noteList").addEventListener("click", e => {
    const item = e.target.closest(".note-i"); if (!item || e.target.closest(".body")) return;
    const id = item.dataset.id;
    if (e.target.closest('[data-a="edit"]')) return openNote(notes.find(n => n.id === id));
    openNotes.has(id) ? openNotes.delete(id) : openNotes.add(id); renderNotes();
  });
  const dlg = $("#noteDlg"), prev = () => { $("#nPrev").innerHTML = Md.render($("#nBody").value) };
  $("#nBody").addEventListener("input", prev);
  function openNote(n) {
    editNote = n || null;
    $("#noteDlgTitle").textContent = n ? "解説を編集" : "解説を追加";
    $("#nTitle").value = n ? n.text : ""; $("#nBody").value = n ? n.body || "" : ""; $("#nGroup").value = n ? groupsOf(n).join("、") : "";
    $("#nDel").hidden = !n; prev(); dlg.showModal();
  }
  $("#btnAddNote").onclick = () => openNote(null);
  $("#nCancel").onclick = () => dlg.close();
  $("#nOk").onclick = async () => {
    const body = $("#nBody").value; let title = $("#nTitle").value.trim();
    if (!title) title = (body.match(/^#{1,6}\s+(.+)$/m) || [])[1] || body.trim().split("\n")[0].slice(0, 60);
    if (!title) return toast("タイトルか本文を入力してください");
    const now = Date.now(), groups = splitGroups($("#nGroup").value);
    let n = editNote;
    if (n) Object.assign(n, { text: title.slice(0, 120), body, groups, updated: now });
    else { n = { id: Clean.uid(), text: title.slice(0, 120), body, groups, created: now, updated: now }; notes.push(n); sortAll() }
    await Store.put(n, "notes"); openNotes.add(n.id); dlg.close(); renderNotes(); renderInfo();
  };
  $("#nDel").onclick = async () => {
    if (!editNote || !confirm("この解説を削除しますか?")) return;
    notes.splice(notes.indexOf(editNote), 1); await Store.del([editNote.id], "notes"); dlg.close(); renderNotes(); renderInfo();
  };
  $("#btnMdFile").onclick = () => $("#fileMd").click();
  $("#fileMd").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    openNote(null); $("#nBody").value = await readFile(f); $("#nTitle").value = f.name.replace(/\.(md|markdown|txt)$/i, ""); prev();
  };

  // ---------- 起動 ----------
  // 最初の版(eng-note の初期)で作った、簡単な形の英文を、いまの形に直す(英文・和訳・グループ・状態はそのまま)
  async function upgradeOld() {
    const old = rows.filter(r => r.type !== "sentence"); if (!old.length) return;
    for (const r of old) {
      const s = Clean.sentence({ text: r.text, ja: r.ja, groups: r.groups, status: r.status, review_count: r.count }, { keepState: true });
      if (!s) continue; s.id = r.id; s.added = r.created || s.added; Object.keys(r).forEach(k => delete r[k]); Object.assign(r, s);
    }
    await Store.put(old, "sentences");
  }
  async function init() {
    try { [rows, notes] = await Promise.all([Store.all("sentences"), Store.all("notes")]) }
    catch (e) { toast("保存先(IndexedDB)を開けませんでした: " + e.message) }
    try { const p = await Store.getMeta("prefs", null); if (p) prefs = { ...prefs, ...p, sh: { ...prefs.sh, ...p.sh }, pick: { ...prefs.pick, ...p.pick } } } catch {}
    await upgradeOld().catch(() => {});
    sortAll();
    const refresh = () => { renderPick(); if (tab === "note") renderNotes(); renderInfo() };
    await Sync.init({ table: k => (k === "sentence" ? rows : notes), refresh, sortAll, toast, replace: (k, a) => { k === "sentence" ? (rows = a) : (notes = a) } });
    let t = "pick"; try { t = localStorage.getItem("tab") || "pick" } catch {}
    setTab(Sync.wantsJoin ? "sync" : (["pick", "note", "sync"].includes(t) ? t : "pick"));
  }
  init();
})();
