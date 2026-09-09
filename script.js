"use strict";
// Configure aqui: DDI + DDD + número, somente dígitos. Não inclua + ou espaços.
const CONFIG = {
  whatsappNumber: "COLOQUE_SEU_NUMERO_AQUI",
  maxFileBytes: 50 * 1024 * 1024
};
const $ = id => document.getElementById(id);
const storageKey = "arrumameucsv:usage:v1";
let selectedFile = null, worker = null, timeout = null;
let resultColumns = [], columnPage = 0;
const format = new Intl.NumberFormat("pt-BR", {maximumFractionDigits:4});
function size(bytes) { return bytes < 1024*1024 ? format.format(bytes/1024)+" KiB" : format.format(bytes/(1024*1024))+" MiB"; }
function statusMessage(message, kind = "") { $("status").textContent = message; $("status").dataset.kind = kind; }
function setStep(step) {
  [1,2,3].forEach(n => {
    const item = $("step"+n);
    item.classList.toggle("complete",n<step);
    if(n===step) item.setAttribute("aria-current","step");
    else item.removeAttribute("aria-current");
  });
}
function updateProgress({phase, completed, total}) {
  $("progressPanel").hidden=false;
  $("progressPhase").textContent=phase;
  const percent=total ? Math.min(100,Math.round(100*completed/total)) : 0;
  $("analysisProgress").value=percent;
  $("progressValue").textContent=percent+"%";
}
function renderColumns() {
  const query=$("columnSearch").value.trim().toLocaleLowerCase("pt-BR");
  const filtered=resultColumns.filter(c=>c.name.toLocaleLowerCase("pt-BR").includes(query));
  const pages=Math.max(1,Math.ceil(filtered.length/25));
  columnPage=Math.min(columnPage,pages-1);
  $("columnPage").textContent=filtered.length ? (columnPage*25+1)+"–"+Math.min((columnPage+1)*25,filtered.length)+" de "+filtered.length+" colunas" : "Nenhuma coluna encontrada";
  $("prevColumns").disabled=columnPage===0;
  $("nextColumns").disabled=columnPage>=pages-1;
  table("columnTable",["Coluna","Tipo","Ausentes","Observação","Mínimo","Máximo","Média","Mediana"],filtered.slice(columnPage*25,(columnPage+1)*25).map(c=>[c.name,c.type,c.missing,c.empty?"Totalmente vazia":c.inconsistent?c.inconsistent+" inconsistência(s)":c.constant?"Constante":"—",...["min","max","mean","median"].map(k=>c.stats ? format.format(c.stats[k]):"—")]));
}
function stopWorker() {
  if (worker) worker.terminate();
  worker = null; clearTimeout(timeout);
  $("progressPanel").hidden=true;
  $("selectFileBtn").disabled=false;
  $("analyzeBtn").disabled = !selectedFile;
  $("analyzeBtn").textContent = "Analisar CSV →";
  $("cancelBtn").hidden = true;
  $("csvFile").disabled = false; $("encoding").disabled = false; $("delimiter").disabled = false;
  $("analisar").setAttribute("aria-busy", "false");
}
function chooseFile(file) {
  document.dispatchEvent(new Event("csv:changed"));
  stopWorker(); $("results").hidden = true; selectedFile = null;
  setStep(1); resultColumns=[]; $("columnSearch").value="";
  $("dropZone").classList.remove("selected");
  $("uploadTitle").textContent="Arraste seu CSV para cá";
  $("selectFileBtn").textContent="Selecionar arquivo";
  $("nextAction").textContent="Comece escolhendo seu arquivo CSV abaixo.";
  $("fileInfo").textContent = "Nenhum arquivo selecionado";
  $("analyzeBtn").disabled = true;
  if (!file) return;
  const types = ["", "text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "text/comma-separated-values", "application/octet-stream"];
  if (!/\.csv$/i.test(file.name) || !types.includes(file.type.toLowerCase())) { statusMessage("Arquivo inválido. Selecione um arquivo .csv, não uma planilha .xlsx.", "error"); return; }
  if (!file.size) { statusMessage("O arquivo está vazio. Selecione um CSV com dados.", "error"); return; }
  if (file.size > CONFIG.maxFileBytes) { statusMessage("O arquivo excede o limite de 50 MiB. Divida a base e tente novamente.", "error"); return; }
  selectedFile = file;
  setStep(2);
  $("dropZone").classList.add("selected");
  $("uploadTitle").textContent="Arquivo pronto para analisar";
  $("selectFileBtn").textContent="Trocar arquivo";
  $("nextAction").textContent="Agora toque em Analisar CSV. Nenhum arquivo será enviado.";
  $("analyzeBtn").focus({preventScroll:true});
  $("fileInfo").textContent = file.name + " · " + size(file.size);
  $("analyzeBtn").disabled = false;
  statusMessage("Arquivo selecionado. Tudo pronto para analisar.");
}
function recordUsage(bytes) {
  try {
    let previous;
    try { previous = JSON.parse(localStorage.getItem(storageKey)); } catch { previous = null; }
    const count = Number.isSafeInteger(previous?.analyses) && previous.analyses >= 0 && previous.analyses < Number.MAX_SAFE_INTEGER ? previous.analyses : 0;
    localStorage.setItem(storageKey, JSON.stringify({analyses:count+1,lastFileBytes:bytes}));
  } catch { /* Storage is optional; private browsing must still work. */ }
}
function list(id, items) {
  $(id).replaceChildren(...items.map(value => { const li = document.createElement("li"); li.textContent = value; return li; }));
}
function table(id, headers, rows) {
  const head = document.createElement("thead"), body = document.createElement("tbody"), tr = document.createElement("tr");
  headers.forEach(value => { const th = document.createElement("th"); th.scope = "col"; th.textContent = value; tr.append(th); });
  head.append(tr);
  rows.forEach(row => {
    const line = document.createElement("tr");
    row.forEach(value => { const cell = document.createElement("td"); cell.textContent = value === "" ? "(vazio)" : String(value); if(value==="") cell.className="empty"; line.append(cell); });
    body.append(line);
  });
  $(id).replaceChildren(head,body);
}
function render(result, file) {
  $("resultFile").textContent = file.name + " · " + size(file.size);
  $("score").textContent = result.score + " / 100";
  $("scoreLabel").textContent = result.score >= 90 ? "Bom ponto de partida" : result.score >= 70 ? "Vale revisar os dados" : "Precisa de atenção";
  const metrics = [["Linhas de dados",result.rows],["Colunas",result.columnCount],["Valores ausentes",result.missing],["Ausentes (%)",result.missingPercent],["Linhas duplicadas",result.duplicates],["Inconsistências",result.inconsistent]];
  $("metrics").replaceChildren(...metrics.map(([label,value])=>{ const box=document.createElement("div");box.className="metric";const title=document.createElement("span"),number=document.createElement("strong");title.textContent=label;number.textContent=format.format(value);box.append(title,number);return box; }));
  const p=result.penalties;
  $("scoreFormula").textContent = "Neste arquivo: 100 − " + [p.missing,p.duplicates,p.empty,p.inconsistent].map(n=>format.format(n)).join(" − ") + " = " + result.score + " (arredondado). Taxas: ausências / todas as células; duplicatas excedentes / linhas; colunas vazias / colunas; inconsistências / valores preenchidos nas colunas numéricas.";
  list("problems",result.problems);list("suggestions",result.suggestions);
  resultColumns=result.columns; columnPage=0; $("columnSearch").value=""; renderColumns();
  list("importNotes",result.importNotes || []);
  $("importSummary").hidden=!result.importNotes?.length;
  setStep(3);
  $("nextAction").textContent="Pronto! Seu diagnóstico está abaixo. Explore as colunas ou analise outro arquivo.";

  table("previewTable",result.columns.slice(0,12).map(c=>c.name),result.preview);
  $("results").hidden=false;
  $("whatsappNotice").textContent = validWhatsApp() ? "" : "Atendimento ainda não configurado. Desenvolvedor: defina CONFIG.whatsappNumber no início de script.js (DDI + DDD + número, somente dígitos).";
  $("resultTitle").focus({preventScroll:true});
  $("results").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"});
}
function validWhatsApp() { return /^[1-9]\d{7,14}$/.test(CONFIG.whatsappNumber); }
$("whatsappBtn").addEventListener("click",()=>{
  if (!validWhatsApp()) {
    $("whatsappNotice").textContent="Atendimento ainda não configurado. Desenvolvedor: defina CONFIG.whatsappNumber no início de script.js (DDI + DDD + número, somente dígitos).";
    return;
  }
  const message="Olá! Usei o ArrumaMeuCSV e gostaria de combinar a limpeza de um CSV, a partir de R$20. Podemos definir o escopo e o prazo?";
  window.open("https://wa.me/"+CONFIG.whatsappNumber+"?text="+encodeURIComponent(message),"_blank","noopener,noreferrer");
});
$("selectFileBtn").addEventListener("click",()=>{ $("csvFile").value=""; $("csvFile").click(); });
$("csvFile").addEventListener("change",event=>{ if(event.target.files[0]) chooseFile(event.target.files[0]); });
$("columnSearch").addEventListener("input",()=>{columnPage=0;renderColumns();});
$("prevColumns").addEventListener("click",()=>{columnPage--;renderColumns();});
$("nextColumns").addEventListener("click",()=>{columnPage++;renderColumns();});
$("newAnalysisBtn").addEventListener("click",()=>{
  chooseFile(null); $("csvFile").value=""; statusMessage("Escolha o próximo CSV para começar.");
  $("analisar").scrollIntoView({behavior:"instant"}); $("selectFileBtn").focus();
});
const drop=$("dropZone");
["dragenter","dragover"].forEach(name=>drop.addEventListener(name,event=>{event.preventDefault();drop.classList.add("dragging");}));
["dragleave","drop"].forEach(name=>drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove("dragging");}));
drop.addEventListener("drop",event=>{
  if (worker) { statusMessage("Aguarde a análise ou clique em Cancelar antes de trocar de arquivo.","loading");return; }
  if (event.dataTransfer.files.length!==1) { chooseFile(null);statusMessage("Envie um arquivo CSV por vez.","error");return; }
  $("csvFile").value="";chooseFile(event.dataTransfer.files[0]);
});
window.addEventListener("dragover",e=>e.preventDefault());
window.addEventListener("drop",e=>e.preventDefault());
$("cancelBtn").addEventListener("click",()=>{stopWorker();setStep(2);$("nextAction").textContent="Análise cancelada. Toque em Analisar CSV para tentar novamente.";statusMessage("Análise cancelada. Você pode tentar novamente.");});
$("analyzeBtn").addEventListener("click",()=>{
  if (!selectedFile || worker) return;
  $("results").hidden=true;
  setStep(2);
  $("nextAction").textContent="Estamos analisando seu arquivo. Acompanhe as fases abaixo.";
  const file=selectedFile;
  try { worker=new Worker("csv-worker.js"); }
  catch { statusMessage("Não foi possível iniciar a análise local. Abra o site via HTTP (veja o README) e use um navegador atualizado.","error");return; }
  $("analisar").setAttribute("aria-busy","true");
  $("analyzeBtn").disabled=true;$("analyzeBtn").textContent="Analisando…";$("cancelBtn").hidden=false;
  $("selectFileBtn").disabled=true;
  updateProgress({phase:"Lendo arquivo",completed:0,total:1});
  $("csvFile").disabled=true;$("encoding").disabled=true;$("delimiter").disabled=true;
  statusMessage("Analisando localmente. Seu arquivo permanece neste navegador…","loading");
  worker.onmessage=({data})=>{
    if(data.progress) { updateProgress(data.progress); return; }
    stopWorker();
    if (data.error) {setStep(2);$("nextAction").textContent="Não foi possível concluir. Confira o aviso e tente novamente.";statusMessage(data.error,"error");return;}
    try { render(data.result,file);recordUsage(file.size);statusMessage("Análise concluída. O arquivo original não foi alterado.","success");}
    catch { $("results").hidden=true;statusMessage("Não foi possível exibir o diagnóstico. Tente novamente.","error"); }
  };
  worker.onerror=()=>{stopWorker();statusMessage("Não foi possível carregar o analisador. Verifique se todos os arquivos do site foram publicados e abra via HTTP.","error");};
  timeout=setTimeout(()=>{stopWorker();statusMessage("A análise excedeu 120 segundos. Divida o arquivo em partes menores.","error");},120000);
  worker.postMessage({file,encoding:$("encoding").value,delimiter:$("delimiter").value});
});
$("clearStats").addEventListener("click",()=>{
  try {localStorage.removeItem(storageKey);$("statsStatus").textContent=" Contadores apagados.";}
  catch {$("statsStatus").textContent=" O armazenamento está indisponível neste navegador.";}
});

// Only selected-file access; account and billing never auto-upload a CSV.
window.CSVApp = { getSelection: () => selectedFile ? {file:selectedFile,encoding:$("encoding").value,delimiter:$("delimiter").value} : null };
