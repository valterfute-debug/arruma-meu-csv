"use strict";
importScripts("assets/vendor/papaparse.min.js", "analyzer.js");
const progress = (phase, completed, total) => self.postMessage({progress:{phase, completed, total}});
self.onmessage = async ({data: {file, encoding, delimiter}}) => {
  try {
    if (file.size > CSVAnalysis.LIMITS.bytes) throw new Error("O arquivo excede 50 MiB.");
    progress("Lendo arquivo", 0, file.size);
    const buffer = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder(encoding, {fatal:true}).decode(buffer); }
    catch { throw new Error("Não foi possível decodificar o arquivo. Tente Windows-1252 nas opções de importação."); }
    text = text.replace(/^\uFEFF/, "");
    if (!text.trim()) throw new Error("O CSV está vazio.");
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) throw new Error("O arquivo contém caracteres binários. Exporte a planilha como CSV.");
    const rows = [];
    let failure = null, detected = delimiter, cells = 0, lastReport = 0;
    // IBGE reports have prose before the actual table; automatic delimiter guessing
    // on that prose is ambiguous. Use the observed semicolon report signature.
    if (!delimiter && /^"?(?:Tabela \d+ - )/.test(text) && /";"Finalidade da produção"/.test(text)) delimiter = ";";
    progress("Interpretando registros", 0, text.length);
    Papa.parse(text, {
      delimiter, delimitersToGuess: [",",";","\t","|"], skipEmptyLines:true,
      step(result, parser) {
        const fatal = result.errors.find(e=>e.code !== "UndetectableDelimiter");
        if (fatal) { failure = "CSV malformado: " + fatal.code + ". Revise aspas e separadores."; parser.abort(); return; }
        detected = result.meta.delimiter;
        const row = result.data;
        rows.push(row); cells += row.length;
        if (row.length > CSVAnalysis.LIMITS.columns) failure = "Este registro tem " + row.length + " colunas. O limite é 2.000.";
        else if (rows.length > CSVAnalysis.LIMITS.rows + 100) failure = "O arquivo excede o limite de 250 mil linhas de dados.";
        else if (cells > CSVAnalysis.LIMITS.cells + 10000) failure = "O arquivo excede o limite de 5 milhões de células.";
        if (failure) { parser.abort(); return; }
        if (performance.now() - lastReport > 100) {
          progress("Interpretando registros", result.meta.cursor, text.length);
          lastReport = performance.now();
        }
      }
    });
    if (failure) throw new Error(failure);
    progress("Organizando cabeçalhos", 0, 1);
    const prepared = CSVAnalysis.prepareTable(rows);
    const result = CSVAnalysis.analyze(prepared.data, detected, progress);
    result.importNotes = prepared.notes;
    progress("Preparando diagnóstico", 1, 1);
    self.postMessage({result});
  } catch (error) {
    self.postMessage({error: error.message || "Não foi possível analisar o CSV."});
  }
};
