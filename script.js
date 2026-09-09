const fileInput = document.getElementById("csvFile");
const analyzeBtn = document.getElementById("analyzeBtn");
const results = document.getElementById("results");
const status = document.getElementById("status");

analyzeBtn.addEventListener("click", () => {
  const file = fileInput.files[0];

  if (!file) {
    status.textContent = "Selecione um arquivo CSV primeiro.";
    return;
  }

  status.textContent = "Analisando...";

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,

    complete: function (result) {
      const data = result.data;
      const columns = result.meta.fields || [];

      const rowsCount = data.length;
      const columnsCount = columns.length;

      let missingCount = 0;

      const missingByColumn = {};

      columns.forEach(column => {
        missingByColumn[column] = 0;
      });

      data.forEach(row => {
        columns.forEach(column => {
          const value = row[column];

          if (
            value === null ||
            value === undefined ||
            String(value).trim() === ""
          ) {
            missingCount++;
            missingByColumn[column]++;
          }
        });
      });

      const normalizedRows = data.map(row =>
        JSON.stringify(
          columns.map(column => String(row[column] ?? "").trim())
        )
      );

      const uniqueRows = new Set(normalizedRows);

      const duplicateCount =
        normalizedRows.length - uniqueRows.size;

      document.getElementById("rows").textContent = rowsCount;
      document.getElementById("columns").textContent = columnsCount;
      document.getElementById("missing").textContent = missingCount;
      document.getElementById("duplicates").textContent = duplicateCount;

      const problems = document.getElementById("problems");

      problems.innerHTML = "";

      let foundProblem = false;

      Object.entries(missingByColumn).forEach(([column, count]) => {
        if (count > 0) {
          foundProblem = true;

          problems.innerHTML += `
            <div class="problem">
              <strong>${column}</strong> possui ${count} valor(es) vazio(s).
            </div>
          `;
        }
      });

      if (duplicateCount > 0) {
        foundProblem = true;

        problems.innerHTML += `
          <div class="problem">
            Foram encontradas ${duplicateCount} linha(s) duplicada(s).
          </div>
        `;
      }

      if (!foundProblem) {
        problems.innerHTML = `
          <div class="problem good">
            Nenhum problema básico foi detectado.
          </div>
        `;
      }

      const message =
        `Olá! Usei o ArrumaMeuCSV e gostaria de corrigir meu arquivo por R$20.`;

      document.getElementById("whatsappBtn").href =
        `https://wa.me/5512982965107?text=${encodeURIComponent(message)}`;

      results.classList.remove("hidden");

      status.textContent = "";
    },

    error: function () {
      status.textContent =
        "Não foi possível ler o arquivo.";
    }
  });
});