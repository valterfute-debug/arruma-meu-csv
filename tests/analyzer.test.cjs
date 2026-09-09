const {test}=require("node:test");
const assert=require("node:assert/strict");
const {analyze,numeric}=require("../analyzer.js");
test("healthy CSV and numerical statistics",()=>{
 const r=analyze([["name","value"],["Ana","1"],["Bia","3"],["Caio","8"]],",");
 assert.equal(r.score,100);assert.equal(r.columns[1].stats.mean,4);assert.equal(r.columns[1].stats.median,3);
});
test("missing, duplicates, empty columns and score",()=>{
 const r=analyze([["a","b"],["1",""],["1",""],["2",""]],",");
 assert.equal(r.missing,3);assert.equal(r.duplicates,1);assert.equal(r.columns[1].empty,true);assert.equal(r.score,62);
});
test("mixed numerical column threshold",()=>{
 const r=analyze([["n"],["1"],["2"],["3"],["4"],["oops"]],",");
 assert.equal(r.inconsistent,1);assert.equal(r.score,97);
});
test("invalid structures",()=>{
 for(const rows of [[],[["a"]],[[""]],[["a","b"],["1"]]]) assert.throws(()=>analyze(rows,","));
});
test("headers preserved including dangerous property names",()=>{
 const r=analyze([["__proto__","x","x",""],["a","b","c","d"]],",");
 assert.equal(r.columns.length,4);assert.ok(r.problems.some(p=>p.includes("cabeçalhos")));
});
test("number conventions preserve identifiers",()=>{
 assert.equal(numeric("0012"),null);assert.equal(numeric("1,25"),1.25);assert.equal(numeric("1.234,50"),null);assert.equal(numeric("1e309"),null);
});
test("even median and whitespace missing",()=>{
 const r=analyze([["n","text"],["-2"," "],["4","x"]],",");
 assert.equal(r.columns[0].stats.median,1);assert.equal(r.missing,1);
});
test("width and cell limits",()=>assert.throws(()=>analyze([Array(2001).fill("a"),Array(2001).fill("1")],",")));

test("wide CSV accepted and progress emitted",()=>{
 const events=[];
 const r=analyze([Array.from({length:630},(_,i)=>"c"+i),Array(630).fill("1")],";",(...e)=>events.push(e));
 assert.equal(r.columnCount,630);assert.ok(events.length>10);
});
test("IBGE report preserves data and combines headers",()=>{
 const {prepareTable}=require("../analyzer.js");
 const rows=[["Tabela 1 - Teste"],["Variável - Teste"],["","Categoria","1º trimestre 2020"],["","Categoria","Total do trimestre","No 1º mês"],["Brasil","Total","-","2"],["Fonte: IBGE"],["Legenda"],["-","Zero absoluto"]];
 const p=prepareTable(rows);
 assert.equal(p.data[0][3],"1º trimestre 2020 · No 1º mês");
 assert.equal(p.data[1][2],"0");assert.equal(p.notes.length,4);
 rows.pop();assert.equal(prepareTable(rows).data[1][2],"-");
});
test("generic irregular CSV is never silently filtered",()=>{
 const {prepareTable}=require("../analyzer.js");
 const data=[["title"],["a","b"],["1","2"]];
 assert.equal(prepareTable(data).data,data);
 assert.throws(()=>analyze(data,","));
});
