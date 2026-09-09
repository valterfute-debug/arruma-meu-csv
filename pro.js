"use strict";
(() => {
  const el=id=>document.getElementById(id);
  let url=null,busy=false,revision=0;
  const message=(text,kind="")=>{el("proStatus").textContent=text;el("proStatus").dataset.kind=kind;};
  function clear() {
    revision++;
    if(url) URL.revokeObjectURL(url);url=null;
    el("cleanResult").hidden=true;el("downloadCleanBtn").removeAttribute("href");
    el("cleanConsent").checked=false;message("");
  }
  document.addEventListener("csv:changed",clear);
  document.addEventListener("account:signedout",clear);
  el("proForm").addEventListener("submit",async event=>{
    event.preventDefault();if(busy) return;
    if(!window.Account?.isSignedIn()) {window.Account?.open("signup");message("Entre na sua conta para usar a limpeza Pro.");return;}
    const source=window.CSVApp?.getSelection();
    if(!source?.file) {message("Selecione e analise um CSV primeiro.","error");return;}
    if(source.file.size>5*1024*1024) {message("A limpeza Pro aceita até 5 MiB por arquivo. Divida a base; o diagnóstico local continua aceitando até 50 MiB.","error");return;}
    const consent=el("cleanConsent").checked;
    if(!consent) return;
    const options={trim:el("cleanTrim").checked,deduplicate:el("cleanDuplicates").checked,removeEmptyColumns:el("cleanEmptyColumns").checked,standardizeHeaders:el("cleanHeaders").checked};
    const outputDelimiter=el("exportDelimiter").value;
    busy=true;el("cleanBtn").disabled=true;el("cleanBtn").textContent="Conferindo plano e limpando…";
    if(url) URL.revokeObjectURL(url);url=null;el("cleanResult").hidden=true;
    const current=revision;
    message("Seu CSV será enviado ao servidor para os ajustes autorizados. Aguarde…","loading");
    try {
      let text;
      try {text=new TextDecoder(source.encoding,{fatal:true}).decode(await source.file.arrayBuffer());}
      catch {throw new Error("Não foi possível ler a codificação. Confira as opções de importação.");}
      // The server authenticates and checks paid entitlement again on every request.
      const result=await window.Account.api("clean",{text,delimiter:source.delimiter,outputDelimiter,options,consent});
      if(current!==revision) return;
      const s=result.summary;
      list("cleanSummary",[
        "Linhas: "+s.inputRows+" → "+s.outputRows,
        s.duplicates+" linhas duplicadas removidas.",
        s.trimmed+" valores ou cabeçalhos com espaços ajustados.",
        s.removedColumns+" colunas vazias removidas; "+s.renamedHeaders+" cabeçalhos padronizados."
      ]);
      table("cleanPreview",result.headers,result.preview);
      list("cleanNotes",result.notes);
      url=URL.createObjectURL(new Blob([result.csv],{type:"text/csv;charset=utf-8"}));
      el("downloadCleanBtn").href=url;
      el("downloadCleanBtn").download=source.file.name.replace(/\.csv$/i,"")+"-limpo.csv";
      el("cleanResult").hidden=false;
      message("Limpeza concluída. Revise o resumo e baixe o arquivo quando estiver pronto.","success");
    } catch(error) {if(current===revision) message(error.message,"error");}
    finally {busy=false;el("cleanBtn").disabled=false;el("cleanBtn").textContent="Gerar prévia da limpeza Pro →";}
  });
})();
