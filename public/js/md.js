// 小さな Markdown 変換。先に HTML をエスケープするので、貼り付けた内容でスクリプトは動かない。
// 対応: 見出し(#〜######)/ 段落 / 太字・斜体・取り消し線 / `code` / ``` コードブロック / 箇条書き・番号つき(入れ子は2スペース)/
//       引用 / 区切り線 / 表 / リンク [text](http...) / 画像は非対応(リンクとして出す)
const Md = (() => {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000" });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>").replace(/~~([^~]+)~~/g, "<s>$1</s>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + esc(codes[+i]) + "</code>");
  }

  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const listItem = l => l.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);

  function render(src) {
    const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue }
      let m;
      if ((m = l.match(/^```(.*)$/))) { // コードブロック
        const buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); continue;
      }
      if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out.push(`<h${m[1].length}>${inline(m[2].trim())}</h${m[1].length}>`); i++; continue }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue }
      if (/^>/.test(l)) { // 引用
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
        out.push("<blockquote>" + render(buf.join("\n")) + "</blockquote>"); continue;
      }
      if (l.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) { // 表
        const head = cells(l); i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
        out.push("<table><thead><tr>" + head.map(c => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
          rows.map(r => "<tr>" + head.map((_, k) => `<td>${inline(r[k] || "")}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
        continue;
      }
      if (listItem(l)) { // 箇条書き(入れ子は、字下げの深さで)
        const stack = []; // { tag, indent }
        while (i < lines.length && (m = listItem(lines[i]))) {
          const ind = m[1].replace(/\t/g, "  ").length, tag = /\d/.test(m[2]) ? "ol" : "ul";
          while (stack.length && ind < stack[stack.length - 1].indent) out.push("</li></" + stack.pop().tag + ">");
          const top = stack[stack.length - 1];
          if (!top || ind > top.indent) { out.push(`<${tag}>`); stack.push({ tag, indent: ind }) }
          else out.push("</li>");
          out.push("<li>" + inline(m[3])); i++;
        }
        while (stack.length) out.push("</li></" + stack.pop().tag + ">");
        continue;
      }
      const buf = []; // 段落(次の空行や別の記法まで)
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
      if (!buf.length) { buf.push(lines[i++]) }
      out.push("<p>" + buf.map(inline).join("<br>") + "</p>");
    }
    return out.join("\n");
  }
  return { render };
})();
