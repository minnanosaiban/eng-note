// クラウド同期(Cloudflare D1)。英文・解説を、端末側で AES-GCM 暗号化してから送る。鍵はパスフレーズから PBKDF2 で作る。
// サーバー側は暗号文しか持たないので、中身は Cloudflare からも読めない。
// 変更検知: 最後に同期した時点の各行のハッシュと比べ、違うものだけ送る。
// 暗号鍵は、取り出せない形(extractable: false)で、この端末の IndexedDB に置く。
const Sync = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHECK = "eng-note-check";
  const te = new TextEncoder(), td = new TextDecoder();

  // 取り込む側(o)の空の項目を、手元(loc)の値で埋める(英文は、解析など足りない項目だけを足す Clean.fill)
  const fillEmpty = (o, loc) => { for (const k of Object.keys(loc)) if (o[k] == null || o[k] === "" || (Array.isArray(o[k]) && !o[k].length)) o[k] = loc[k] };
  // 行の種類 → 保存先の表、同じものかを見分けるキー
  const KIND = {
    sentence: { store: "sentences", nat: x => x.text.toLowerCase(), fill: (a, b) => Clean.fill(a, b) },
    note: { store: "notes", nat: x => x.id }
  };
  let st = null;                 // { token, key(CryptoKey), since, hashes, last }
  let hooks = null;              // app.js から渡される: table(kind) / refresh() / sortAll() / toast(msg)
  let syncing = false, again = false, timer = null, applying = false;
  let form = null, newToken = null, joinToken = "";

  const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) };
  const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(salt), iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
    return { iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
  }
  const decrypt = async (iv, data, key) => JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(data))));
  async function api(path, opt = {}, token = st && st.token) {
    let r;
    try { r = await fetch("/api/" + path, { ...opt, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }) }
    catch { throw new Error("通信できませんでした(オフラインの可能性)") }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  function hash(s) {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677) }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
  }
  const hashOf = o => hash(JSON.stringify(o));
  const rk = (k, id) => k + ":" + id;
  const saveState = () => Store.setMeta("sync", st).catch(e => hooks && hooks.toast("同期情報を保存できませんでした: " + e.message));

  // ---------- 受け取り ----------
  // 手元の変更を優先する(次の送信で上書きされる)。まだ同期していない同じ英文が手元にあれば、1つにまとめる
  async function applyRemote(rec) {
    const kd = KIND[rec.kind]; if (!kd) return false;
    const arr = hooks.table(rec.kind), kk = rk(rec.kind, rec.id), idx = arr.findIndex(o => o.id === rec.id);
    const dirty = idx >= 0 && st.hashes[kk] !== hashOf(arr[idx]);
    if (rec.deleted) {
      if (idx >= 0 && !dirty) { arr.splice(idx, 1); await Store.del([rec.id], kd.store) }
      delete st.hashes[kk]; return true;
    }
    if (idx < 0 && st.hashes[kk]) return false; // 前回までに同期した行が、手元に無い = この端末で消した。次の送信で「消した」と伝えるので、戻さない
    const o = await decrypt(rec.iv, rec.data, st.key);
    if (!o || typeof o !== "object" || typeof o.text !== "string") return false;
    o.id = rec.id;
    if (dirty) return false;
    const h = hashOf(o);
    if (idx >= 0 && hashOf(arr[idx]) === h) { st.hashes[kk] = h; return false } // 自分が送ったものが戻ってきただけ
    if (idx >= 0) arr[idx] = o;
    else {
      const di = arr.findIndex(x => !st.hashes[rk(rec.kind, x.id)] && kd.nat(x) === kd.nat(o));
      if (di >= 0) { const loc = arr[di]; arr.splice(di, 1); await Store.del([loc.id], kd.store); (kd.fill || fillEmpty)(o, loc) }
      arr.push(o);
    }
    await Store.put(o, kd.store); st.hashes[kk] = h; return true;
  }

  // ---------- 同期 ----------
  function setStatus(text, err) { const b = $("#syncStatus"); b.hidden = !st; b.textContent = text; b.style.color = err ? "var(--danger)" : "" }
  function schedule() { if (!st) return; clearTimeout(timer); setStatus("☁ 未同期の変更あり"); timer = setTimeout(() => syncNow(), 3000) }

  async function syncNow(manual) {
    if (!st) return;
    if (syncing) { again = true; return }
    syncing = true; clearTimeout(timer); setStatus("☁ 同期中…");
    try {
      let got = 0, sent = 0;
      applying = true;
      for (;;) { // 1) 受信
        const r = await api("records?since=" + st.since);
        for (const rec of r.records) { if (await applyRemote(rec)) got++; st.since = Math.max(st.since, rec.seq) }
        if (!r.more) break;
      }
      applying = false;
      if (got) { hooks.sortAll(); hooks.refresh() }
      const present = new Set(), out = []; // 2) 送信(前回の同期から変わったものだけ)
      for (const k of Object.keys(KIND)) for (const o of hooks.table(k)) {
        const kk = rk(k, o.id), h = hashOf(o); present.add(kk);
        if (st.hashes[kk] !== h) out.push({ kk, h, rec: { kind: k, id: o.id, ...await encrypt(o, st.key) } });
      }
      for (const kk of Object.keys(st.hashes)) if (!present.has(kk)) { const i = kk.indexOf(":"); out.push({ kk, h: null, rec: { kind: kk.slice(0, i), id: kk.slice(i + 1), deleted: true } }) }
      for (let i = 0; i < out.length; i += 50) {
        const part = out.slice(i, i + 50);
        await api("records", { method: "POST", body: JSON.stringify({ records: part.map(p => p.rec) }) });
        for (const p of part) p.h ? (st.hashes[p.kk] = p.h) : delete st.hashes[p.kk];
        sent += part.length; await saveState();
      }
      st.last = Date.now(); await saveState();
      setStatus("☁ 同期済み " + new Date(st.last).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
      if (manual) hooks.toast(`同期しました(受信 ${got} 件・送信 ${sent} 件)`);
    } catch (e) { setStatus("☁ 同期エラー", true); if (manual) hooks.toast("同期できませんでした: " + e.message) }
    finally { applying = false; syncing = false; if (again) { again = false; schedule() } }
  }

  // ---------- 保管庫の作成・接続 ----------
  async function create(pass, setup) {
    const salt = toB64(crypto.getRandomValues(new Uint8Array(16))), key = await deriveKey(pass, salt), chk = await encrypt(CHECK, key);
    const { token } = await api("vault", { method: "POST", body: JSON.stringify({ salt, check_iv: chk.iv, check_data: chk.data, setup }) }, null);
    st = { token, key, since: 0, hashes: {}, last: 0 }; await saveState(); newToken = token;
    await syncNow(true);
  }
  async function join(token, pass) {
    const v = await api("vault", {}, token), key = await deriveKey(pass, v.salt);
    let ok = false; try { ok = (await decrypt(v.check_iv, v.check_data, key)) === CHECK } catch {}
    if (!ok) throw new Error("パスフレーズが違います。");
    st = { token, key, since: 0, hashes: {}, last: 0 }; await saveState();
    history.replaceState(null, "", location.pathname + location.search);
    await syncNow(true);
  }

  // ---------- 画面 ----------
  async function copyText(text, el) { try { await navigator.clipboard.writeText(text) } catch { el.select(); document.execCommand("copy") } }

  function render() {
    const box = $("#syncBox"); if (!box) return;
    if (st) {
      box.innerHTML = `<p class="sub">この端末は同期しています(最終同期: ${st.last ? new Date(st.last).toLocaleString("ja-JP") : "まだ"})。データは暗号化して Cloudflare に保存されます。</p>
        ${newToken ? `<div class="card"><b>同期キー(別の端末で接続するときに必要)</b>
          <input type="text" readonly id="tokOut" value="${esc(newToken)}" style="margin-top:6px;width:100%;font-family:monospace;font-size:12px">
          <p class="sub">パスワード管理アプリなど安全な場所に保管してください。パスフレーズとは別に必要です。</p></div>` : ""}
        <div id="qrBox" hidden style="margin-top:8px;text-align:center"></div>
        <div class="row wrap"><button class="pri" id="sNow">今すぐ同期</button><button id="sQr">スマホで接続(QRコード)</button><button id="sKey">同期キーをコピー</button><button id="sOff" class="danger">この端末の同期を解除</button></div>`;
      $("#sNow").onclick = () => syncNow(true).then(render);
      $("#sQr").onclick = () => { // 同期キーを URL の # 以降に入れた QR コード(# 以降はサーバーに送られない)
        const qb = $("#qrBox"); if (!qb.hidden) { qb.hidden = true; qb.innerHTML = ""; return }
        const q = qrcode(0, "M"); q.addData(location.origin + location.pathname + "#sync=" + encodeURIComponent(st.token)); q.make();
        qb.innerHTML = `<div style="display:inline-block;background:#fff;padding:8px;border-radius:10px;width:220px">${q.createSvgTag({ cellSize: 4, margin: 8, scalable: true })}</div>
          <p class="sub">スマホのカメラで読み取ると、同期キーが入力された状態でアプリが開きます。あとはパスフレーズを入れるだけです。人に見られない場所で表示してください。</p>`;
        qb.hidden = false;
      };
      $("#sKey").onclick = () => copyText(st.token, $("#tokOut") || $("#sKey")).then(() => hooks.toast("同期キーをコピーしました。安全な場所に保管してください。"));
      $("#sOff").onclick = async () => {
        if (!confirm("この端末の同期を解除しますか?\n(この端末のデータとクラウドのデータは消えません)")) return;
        st = null; newToken = null; await Store.setMeta("sync", null); setStatus(""); render();
      };
      return;
    }
    box.innerHTML = `<p class="sub">英文・解説を、この端末で暗号化してから Cloudflare に保存し、PC とスマホで共有できます。パスフレーズは送信されないので、Cloudflare 側からも中身は読めません。<b>パスフレーズを忘れると復元できません。</b></p>
      <div class="row"><button class="${form === "new" ? "pri" : ""}" id="sNew">新しく同期を始める</button><button class="${form === "join" ? "pri" : ""}" id="sJoin">同期キーで接続(2台目以降)</button></div>
      ${form === "new" ? `<div class="aiset"><input type="text" id="sSetup" placeholder="セットアップコード(初回のみ)" autocomplete="off" style="font-family:monospace"><input type="password" id="sP1" placeholder="パスフレーズ(12文字以上)" autocomplete="new-password"><input type="password" id="sP2" placeholder="パスフレーズ(確認)" autocomplete="new-password">
        <button class="pri" id="sGo">作成して同期</button></div>` : ""}
      ${form === "join" ? `<div class="aiset"><input type="text" id="sTok" placeholder="同期キー" autocomplete="off" style="font-family:monospace" value="${esc(joinToken)}"><input type="password" id="sP1" placeholder="パスフレーズ" autocomplete="current-password">
        <button class="pri" id="sGo">接続して同期</button></div>` : ""}
      <p class="err" id="sErr"></p>`;
    $("#sNew").onclick = () => { form = "new"; render() };
    $("#sJoin").onclick = () => { form = "join"; render() };
    const go = $("#sGo");
    if (go) go.onclick = async e => {
      const p = $("#sP1").value, err = $("#sErr"); err.textContent = "";
      if (form === "new") { if (p.length < 12) return err.textContent = "パスフレーズは12文字以上にしてください。"; if (p !== $("#sP2").value) return err.textContent = "確認用と一致しません。" }
      const b = e.target; b.disabled = true; b.textContent = "処理中…(数秒かかります)";
      try {
        if (form === "new") await create(p, $("#sSetup").value.trim()); else await join($("#sTok").value.trim(), p);
        form = null; render();
      } catch (x) { err.textContent = x.message; b.disabled = false; b.textContent = form === "new" ? "作成して同期" : "接続して同期" }
    };
  }

  // ---------- 起動 ----------
  return {
    render, syncNow,
    get active() { return !!st },
    get wantsJoin() { return joinToken !== "" },
    async init(h) {
      hooks = h;
      Store.onChange = () => { if (!applying) schedule() };
      try { const s = await Store.getMeta("sync", null); if (s && s.token && s.key) st = s } catch {}
      const m = location.hash.match(/^#sync=([\w.\-%]+)$/); // QR コードで開いたとき: 同期キーを入れた状態にする
      if (m && !st) { joinToken = decodeURIComponent(m[1]); form = "join" }
      setStatus(st ? (st.last ? "☁ 同期済み" : "☁ 未同期") : "");
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st) syncNow() });
      if (st) syncNow();
    }
  };
})();
