const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const output=path.join(root,"dist");
fs.mkdirSync(output,{recursive:true});
const files=["index.html","style.css","script.js","analyzer.js","csv-worker.js","auth.js","pro.js","app-config.js",".nojekyll"];
for(const file of files) fs.copyFileSync(path.join(root,file),path.join(output,file));
function copyAssets(relative) {
  const source=path.join(root,relative), target=path.join(output,relative);
  fs.mkdirSync(target,{recursive:true});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})) {
    const child=path.join(relative,entry.name);
    if(entry.isDirectory()) copyAssets(child);
    else if(/\.(svg|png|jpg|webp|js)$/.test(entry.name) || entry.name==="LICENSE") fs.copyFileSync(path.join(root,child),path.join(output,child));
  }
}
copyAssets("assets");
console.log("Site estático gerado em dist/. Backend e segredos ficam fora da publicação.");
