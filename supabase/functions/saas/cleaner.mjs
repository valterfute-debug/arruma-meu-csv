import { HttpError } from "./policy.mjs";
export const CLEAN_LIMITS = { bytes:5*1024*1024, rows:50000, columns:2000, cells:1000000 };
export function cleanCSV(input, Papa, prepareTable = data=>({data,notes:[]})) {
  if(input.consent !== true) throw new HttpError(400,"Autorize o processamento deste CSV antes de continuar.");
  if(typeof input.text !== "string" || !input.text.trim()) throw new HttpError(400,"Selecione um CSV com dados.");
  if(new TextEncoder().encode(input.text).length>CLEAN_LIMITS.bytes) throw new HttpError(413,"A limpeza Pro aceita até 5 MiB por arquivo. O diagnóstico local aceita até 50 MiB.");
  if(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(input.text)) throw new HttpError(400,"O arquivo contém caracteres binários.");
  const options=input.options || {};
  for(const key of ["trim","deduplicate","removeEmptyColumns","standardizeHeaders"]) {
    if(typeof options[key] !== "boolean") throw new HttpError(400,"Escolha as opções de limpeza.");
  }
  const delimiter=input.delimiter || "";
  if(!["",",",";","\t","|"].includes(delimiter) || ![",",";"].includes(input.outputDelimiter)) throw new HttpError(400,"Separador inválido.");
  const rows=[]; let cells=0, failure=null;
  const detected=delimiter || (/^"?Tabela \d+ - /.test(input.text) && /";"Finalidade da produção"/.test(input.text) ? ";" : "");
  Papa.parse(input.text.replace(/^\uFEFF/,""), {
    delimiter:detected, delimitersToGuess:[",",";","\t","|"], skipEmptyLines:true,
    step(result,parser) {
      if(result.errors.some(e=>e.code!=="UndetectableDelimiter")) failure="Confira as aspas e a estrutura do CSV.";
      rows.push(result.data); cells+=result.data.length;
      if(rows.length>CLEAN_LIMITS.rows+100 || result.data.length>CLEAN_LIMITS.columns || cells>CLEAN_LIMITS.cells+10000) failure="Limpeza Pro: limite de 50 mil linhas, 2.000 colunas e 1 milhão de células.";
      if(failure) parser.abort();
    }
  });
  if(failure) throw new HttpError(400,failure);
  let prepared;
  try {prepared=prepareTable(rows);} catch {throw new HttpError(400,"Não foi possível organizar os cabeçalhos do relatório.");}
  const [originalHeaders,...body]=prepared.data;
  if(!originalHeaders?.length || !body.length || originalHeaders.every(v=>!v.trim())) throw new HttpError(400,"O CSV precisa de cabeçalho e ao menos uma linha de dados.");
  if(body.length>CLEAN_LIMITS.rows || body.length*originalHeaders.length>CLEAN_LIMITS.cells || body.some(r=>r.length!==originalHeaders.length)) throw new HttpError(400,"Confira a quantidade de campos em cada linha e os limites da limpeza Pro.");
  let trimmed=0, removed=0, renamed=0, duplicates=0;
  const transform=value=>{
    const next=options.trim?value.trim():value;
    if(next!==value) trimmed++;
    return next;
  };
  let headers=originalHeaders.map(transform);
  let data=body.map(row=>row.map(transform));
  if(options.removeEmptyColumns) {
    const keep=headers.map((_,i)=>i).filter(i=>data.some(row=>row[i].trim()!==""));
    if(!keep.length) throw new HttpError(400,"Todas as colunas estão vazias. Desmarque a remoção de colunas vazias para exportar.");
    removed=headers.length-keep.length;
    headers=keep.map(i=>headers[i]); data=data.map(row=>keep.map(i=>row[i]));
  }
  if(options.standardizeHeaders) {
    const used=new Set();
    headers=headers.map((header,index)=>{
      const base=header.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"") || "coluna_"+(index+1);
      let name=base, suffix=2;
      while(used.has(name)) name=base+"_"+suffix++;
      used.add(name);if(name!==header) renamed++;
      return name;
    });
  }
  if(options.deduplicate) {
    const seen=new Set();
    data=data.filter(row=>{const key=JSON.stringify(row);if(seen.has(key)){duplicates++;return false;}seen.add(key);return true;});
  }
  // CSV formula injection defense; values beginning with formula characters are
  // explicitly exported as text by PapaParse (including signed strings).
  const csv="\uFEFF"+Papa.unparse([headers,...data],{delimiter:input.outputDelimiter,newline:"\r\n",escapeFormulae:true});
  return {csv,headers:headers.slice(0,8),preview:data.slice(0,5).map(row=>row.slice(0,8).map(v=>v.slice(0,180))),
    summary:{inputRows:body.length,outputRows:data.length,trimmed,duplicates,removedColumns:removed,renamedHeaders:renamed},
    notes:[...(prepared.notes || []),"A exportação usa UTF-8 com BOM. Valores que começam com =, +, -, @, tabulação ou retorno recebem apóstrofo para reduzir o risco de fórmulas ao abrir em planilhas. Números com sinal podem aparecer como texto.","Revise o resultado antes de substituir sua base. Nenhum valor ausente foi preenchido automaticamente."]};
}
