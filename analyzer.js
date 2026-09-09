/* Pure analysis shared by the browser worker and Node tests. */
(function (root) {
  "use strict";
  const LIMITS = { bytes: 50 * 1024 * 1024, rows: 250000, columns: 2000, cells: 5000000 };
  function numeric(value) {
    const text = value.trim();
    if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    if (/^[+-]?0\d/.test(text)) return null;
    const number = Number(text.replace(",", "."));
    return Number.isFinite(number) ? number : null;
  }
  function analyze(data, delimiter, progress = () => {}) {
    if (!data.length) throw new Error("O CSV está vazio.");
    const headers = data[0];
    if (!headers.length || headers.every(v => !v.trim())) throw new Error("O cabeçalho está vazio. Use nomes de colunas na primeira linha.");
    if (headers.length > LIMITS.columns) throw new Error("Limite de 2.000 colunas excedido.");
    const rows = data.slice(1);
    if (!rows.length) throw new Error("O CSV contém somente o cabeçalho. Inclua ao menos uma linha de dados.");
    if (rows.length > LIMITS.rows || rows.length * headers.length > LIMITS.cells) throw new Error("Limite de 250 mil linhas ou 5 milhões de células excedido.");
    const mismatch = rows.findIndex(row => row.length !== headers.length);
    if (mismatch !== -1) throw new Error("O registro de dados " + (mismatch + 1) + " tem " + rows[mismatch].length + " campos; o cabeçalho tem " + headers.length + ". Confira o separador e a estrutura do arquivo.");
    let missing = 0, duplicates = 0, inconsistent = 0, numericFilled = 0;
    const seen = new Set();
    let checked = 0;
    for (const row of rows) {
      if (checked++ % 2000 === 0) progress('Conferindo duplicatas', checked - 1, rows.length);
      const key = JSON.stringify(row.map(value => value.trim()));
      if (seen.has(key)) duplicates++;
      else seen.add(key);
    }
    seen.clear();
    const columns = headers.map((header, index) => {
      if (index % 10 === 0) progress('Analisando colunas', index, headers.length);
      let absent = 0, filled = 0, first, constant = true;
      const numbers = [];
      for (const row of rows) {
        const value = row[index].trim();
        if (!value) { absent++; continue; }
        filled++;
        if (first === undefined) first = value;
        else if (value !== first) constant = false;
        const number = numeric(value);
        if (number !== null) numbers.push(number);
      }
      missing += absent;
      const isNumeric = filled > 0 && numbers.length / filled >= 0.8;
      const bad = isNumeric ? filled - numbers.length : 0;
      inconsistent += bad;
      if (isNumeric) numericFilled += filled;
      let stats = null;
      if (isNumeric) {
        numbers.sort((a,b) => a-b);
        const middle = Math.floor(numbers.length/2);
        stats = { min: numbers[0], max: numbers[numbers.length-1],
          mean: numbers.reduce((sum,n) => sum + n/numbers.length, 0),
          median: numbers.length % 2 ? numbers[middle] : numbers[middle-1]/2 + numbers[middle]/2 };
      }
      return { name: header.trim() || "(sem nome: coluna " + (index+1) + ")", missing: absent, type: !filled ? "Vazia" : isNumeric ? "Numérica" : "Textual", empty: !filled, constant: filled >= 2 && constant, inconsistent: bad, stats };
    });
    progress('Analisando colunas', headers.length, headers.length);
    const emptyColumns = columns.filter(c => c.empty).length;
    const penalties = { missing: 40*missing/(rows.length*headers.length), duplicates: 25*duplicates/rows.length, empty: 20*emptyColumns/headers.length, inconsistent: numericFilled ? 15*inconsistent/numericFilled : 0 };
    const score = Math.max(0,Math.min(100,Math.round(100-Object.values(penalties).reduce((a,b)=>a+b,0))));
    const problems = [], suggestions = [];
    if (missing) { problems.push(missing + " células ausentes (" + (100*missing/(rows.length*headers.length)).toFixed(2) + "%)."); suggestions.push("Revise o significado das ausências antes de preencher ou excluir dados; não substitua tudo por zero."); }
    if (duplicates) { problems.push(duplicates + " linhas duplicadas além da primeira ocorrência."); suggestions.push("Confirme se as repetições são indevidas antes de remover duplicatas. A comparação ignora espaços nas extremidades e diferencia maiúsculas."); }
    if (emptyColumns) { problems.push(emptyColumns + " colunas totalmente vazias."); suggestions.push("Investigue a origem das colunas vazias e remova somente as que não forem necessárias."); }
    const constants = columns.filter(c=>c.constant).length;
    if (constants) { problems.push(constants + " colunas constantes entre os valores preenchidos."); suggestions.push("Verifique se as colunas constantes fazem sentido no contexto; isso pode ser esperado."); }
    if (inconsistent) { problems.push(inconsistent + " possíveis inconsistências em colunas predominantemente numéricas."); suggestions.push("Confira textos misturados com números. Unidades, códigos e separadores de milhar exigem revisão humana."); }
    if (headers.some(h=>!h.trim()) || new Set(headers.map(h=>h.trim())).size !== headers.length) { problems.push("Há cabeçalhos vazios ou repetidos. As colunas foram preservadas por posição."); suggestions.push("Dê um nome único e descritivo a cada coluna."); }
    if (!problems.length) { problems.push("Bom começo! Nenhum problema básico foi detectado neste arquivo."); suggestions.push("Valide também datas, regras do negócio e a exatidão dos valores antes de usar os dados."); }
    return { rows:rows.length, columnCount:headers.length, missing, missingPercent:100*missing/(rows.length*headers.length), duplicates, inconsistent, columns, penalties, score, problems, suggestions, delimiter, preview: rows.slice(0,10).map(row=>row.slice(0,12).map(v=>v.length>180?v.slice(0,180)+"…":v)) };
  }

  function prepareTable(data) {
    const plain = { data, notes: [] };
    if (!/^Tabela \d+ - /.test(data[0]?.[0] || "") ||
        !/^Variável - /.test(data[1]?.[0] || "")) return plain;
    const source = data.findIndex(row => row.length === 1 && /^Fonte: IBGE/.test(row[0]));
    const headerIndex = data.findIndex(row => row[2] === "Total do trimestre" && row[3] === "No 1º mês");
    if (source < 0 || headerIndex < 1 || source <= headerIndex + 1) return plain;
    const lower = data[headerIndex], upper = data[headerIndex - 1];
    if (!/trimestre \d{4}/.test(upper[2] || "")) return plain;
    const width = lower.length;
    const body = data.slice(headerIndex + 1, source);
    if (body.some(row => row.length !== width)) throw new Error("O relatório IBGE tem registros com larguras diferentes. Confira a exportação.");
    let group = "";
    const headers = lower.map((value, i) => {
      if (i === 0) return value.trim() || "Localidade";
      if (i === 1) return value.trim() || upper[i] || "Categoria";
      if (upper[i]?.trim()) group = upper[i].trim();
      return [group, value.trim()].filter(Boolean).join(" · ");
    });
    const legendStart = data.findIndex(row => row[0] === "Legenda");
    const legend = legendStart >= source ? data.slice(legendStart + 1) : [];
    const dashIsZero = legend.some(row => row[0] === "-" && /^Zero absoluto/.test(row[1] || ""));
    let converted = 0;
    const normalized = body.map(row => row.map((value, i) => {
      if (i > 1 && value === "-" && dashIsZero) { converted++; return "0"; }
      return value;
    }));
    return {
      data: [headers, ...normalized],
      notes: [
        "Relatório IBGE reconhecido: " + body.length + " linhas de dados e " + width + " colunas. Títulos, cabeçalhos auxiliares, fonte, notas e legenda foram separados do diagnóstico.",
        "Os dois níveis do cabeçalho foram combinados (trimestre + referência temporal). O arquivo original não foi alterado.",
        converted + " símbolos “-” interpretados como zero somente porque a legenda deste arquivo declara “Zero absoluto”. Outros símbolos são preservados; não são tratados automaticamente como ausências.",
        "Consulte as notas e a legenda no arquivo original para entender sigilo, revisões e limites de interpretação dos dados."
      ]
    };
  }

  root.CSVAnalysis = { LIMITS, numeric, analyze, prepareTable };
  if (typeof module !== "undefined") module.exports = root.CSVAnalysis;
})(globalThis);
