# ArrumaMeuCSV

Diagnóstico gratuito de CSV no navegador, com cadastro e assinatura **Pro de R$49,99/mês** para limpeza, padronização e exportação. O frontend continua em HTML/CSS/JavaScript puro; Supabase atende autenticação, banco e funções privadas, e Mercado Pago gerencia a recorrência.

**Estado da integração:** código implementado e testado localmente com provedores simulados. As chaves públicas estão vazias e a cobrança começa desabilitada. Cadastro, e-mails e pagamentos reais dependem da configuração descrita em [ATIVACAO.md](ATIVACAO.md). Nenhum pagamento, commit, push ou deploy foi executado automaticamente.

## Funcionalidades

### Gratuito, sem cadastro

Upload e drag and drop, limites claros, progresso por fase, cancelamento, diagnóstico com linhas/colunas/ausências/duplicatas, tipos, inconsistências numéricas, estatísticas, score explicado, sugestões, prévia, busca e páginas de colunas. Reconhece o formato trimestral IBGE presente em tabela7524.csv: 3 linhas de dados e 630 colunas, separando notas e combinando cabeçalhos. A interpretação aparece no diagnóstico.

### Conta

Nome, e-mail, telefone com DDI/DDD e senha; confirmação e reenvio de e-mail; login; mostrar/ocultar senha; recuperação e troca de senha; sessão por aba e logout. Telefone faz parte do perfil e não é verificado por SMS. Nenhuma mensagem de marketing é enviada automaticamente.

### Pro — R$49,99 por mês

- Remover espaços externos.
- Remover linhas idênticas após os ajustes.
- Remover colunas totalmente vazias, se escolhido.
- Padronizar e desambiguar cabeçalhos.
- Revisar contagens e prévia antes do download.
- Exportar CSV UTF-8 com BOM, vírgula ou ponto e vírgula.
- Conferir assinatura e cancelar a renovação pela conta.

Ausências não são preenchidas automaticamente. A limpeza Pro só envia o CSV ao servidor depois de autorização explícita. O serviço humano via WhatsApp, a partir de R$20, é separado e não está incluído na mensalidade.

## Rodar e testar

Na pasta do projeto:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Abra http://localhost:8000. Não use duplo clique em index.html: Web Workers precisam de HTTP/HTTPS. Para sair do servidor, Ctrl+C. As telas de conta podem ser visualizadas sem chaves, mas não simulam cadastro ou pagamento bem-sucedido.

Testes (Node 24 recomendado; PGlite é dependência exclusiva de desenvolvimento):

```powershell
npm ci
npm test
python tests/browser.py
python tests/accounts-browser.py
```

Os testes de navegador requerem Python, Playwright e Chrome. Instalação opcional: `python -m pip install playwright`. Para repetir o cenário do arquivo IBGE local sem incluí-lo no repositório:

```powershell
python tests/browser.py "C:\Users\Inteli\Downloads\tabela7524.csv"
```

O backend pode ser verificado com:

```powershell
npx --yes deno@2.9.6 check --config supabase/functions/saas/deno.json supabase/functions/saas/index.ts
```

A suíte cobre cálculos, limites, arquivos inválidos, HTML malicioso, exportação de fórmulas como texto, autorização de usuário, valor/moeda/recebedor, pagamento pendente, estorno, expiração, repetição de webhook, recorrência, cancelamento, bloqueio de contratação duplicada, RLS e limites de chamadas. Chrome: cadastro, recuperação, checkout, download, cancelamento, logout e telas entre 320 e 1440 px. Integrações externas são simuladas nos testes; SMTP e pagamentos precisam ser homologados na conta real/de teste do provedor.

## Limites e interpretação

- Diagnóstico local: 50 MiB, 250 mil linhas, 2.000 colunas, 5 milhões de células, até 120 segundos.
- Limpeza Pro: 5 MiB em UTF-8, 50 mil linhas, 2.000 colunas, 1 milhão de células, até 6 solicitações por minuto por conta. O limite menor controla CPU/memória das funções gratuitas.
- Cabeçalho na primeira linha, exceto relatórios explicitamente reconhecidos. Linhas irregulares são rejeitadas; não são descartadas silenciosamente.
- Vírgula, ponto e vírgula, tabulação ou barra vertical; UTF-8 e Windows-1252 para importação.
- Ausência significa campo vazio ou só espaços. “NA”, “null” e zero são preenchidos.
- No relatório IBGE reconhecido, “-” é convertido em zero somente quando a própria legenda declara Zero absoluto. Outros símbolos são preservados.
- Numérica: ao menos 80% dos valores preenchidos são números reconhecidos. Ponto ou vírgula decimal; sem moeda ou agrupamento de milhar; códigos com zeros à esquerda são texto.
- Constantes: ao menos dois preenchidos iguais. Estatísticas ignoram ausências e valores não numéricos e seguem a precisão numérica do JavaScript.
- Duplicatas no diagnóstico comparam todas as células sem espaços externos, distinguindo maiúsculas. Na limpeza, a comparação acontece após as opções escolhidas.
- A exportação prefixa apóstrofo em valores que começam com caracteres de fórmula (incluindo + e -). Valores com sinal podem virar texto em planilhas; isso é informado no resultado.
- O original permanece intacto. Revise o resultado antes de substituir sua base. Não há verificação de regras de negócio, datas ou exatidão.

## Score

`arredondar(100 - 40*A - 25*D - 20*V - 15*I)`, limitado a 0–100.

A = ausências/células; D = duplicatas excedentes/linhas; V = colunas vazias/colunas; I = não numéricos/preenchidos nas colunas classificadas como numéricas. Colunas vazias também contribuem para ausências: peso adicional explícito. Constantes e cabeçalhos geram avisos sem desconto. Indicador heurístico, não certificação.

## Privacidade e segurança

- Diagnóstico gratuito: CSV fica na memória do navegador/worker, sem upload.
- Limpeza Pro: envio consentido por HTTPS à função Supabase; processamento em memória e resposta com CSV. Não grava arquivo/conteúdo no banco, Storage ou logs da aplicação. Provedores podem registrar metadados técnicos; não prometa ausência de qualquer log da infraestrutura.
- Supabase Auth recebe as senhas; o frontend não persiste senhas. Nome/telefone ficam no perfil; e-mail pertence ao Auth.
- localStorage: só contagem de análises e tamanho do último arquivo. sessionStorage: tokens de autenticação da aba; não contém CSV. Logout remove a sessão local e solicita encerramento no Auth.
- Perfis usam RLS: cada usuário consulta/atualiza somente o próprio nome/telefone. Tabelas de assinatura não têm acesso de escrita pelo cliente.
- Backend autentica JWT no Supabase, confere e-mail confirmado e busca a assinatura da identidade validada. Não aceita preço, plano ou identidade fornecidos pelo cliente como autorização.
- Pro exige pagamento aprovado de R$49,99 em BRL, do recebedor correto, no ambiente configurado e no período vigente. Contrato autorizado sozinho e URL de retorno não liberam Pro.
- Webhook valida HMAC, consulta novamente o provedor e calcula o período pela data da fatura; notificações repetidas não adicionam meses. Estornos removem a elegibilidade do pagamento. Cancelamento mantém apenas o período pago.
- A API usa limites por conta; o Supabase Auth deve manter confirmação, limites e proteção contra abuso configurados.
- Conteúdo de CSV e perfis é exibido com textContent; a exportação trata risco de fórmulas.
- Segredos ficam nas Edge Functions. app-config.js contém apenas URL e chave pública. Nunca inclua service_role ou token do Mercado Pago no frontend.
- WhatsApp só abre uma mensagem genérica e não anexa o arquivo. Configure seu número no início de script.js.

## Publicar

```powershell
npm run build
```

Publique **dist/**, não a pasta inteira do repositório. O build copia apenas o frontend e os assets; as funções devem ser implantadas separadamente no Supabase. Não coloque segredos ou CSVs de clientes dentro de dist/ ou assets/.

[ATIVACAO.md](ATIVACAO.md) contém todos os passos: contas, configuração pública, SMTP, banco, segredos, webhook, testes reais, Git e Cloudflare Pages.

## Estrutura

```text
index.html, style.css       Landing page, cadastro, conta e ferramentas
script.js                  Diagnóstico e seleção do arquivo
analyzer.js, csv-worker.js  Análise local e normalização de relatórios
app-config.js              URL e chave pública do Supabase
auth.js                    Cadastro, login, recuperação e assinatura
pro.js                     Consentimento, limpeza e download
assets/                    Favicon e PapaParse local com licença MIT
supabase/config.toml       Configuração do projeto/função
supabase/migrations/       Perfis, RLS, assinaturas e limites
supabase/functions/saas/   Backend, política de cobrança e limpeza
supabase/functions/.env.example  Modelo dos segredos
scripts/build.cjs          Publicação por lista de arquivos permitidos
tests/                     Cálculos, banco, APIs e navegador
package.json, package-lock.json  Comandos e dependência de testes
ATIVACAO.md                 Operação e publicação passo a passo
```

PapaParse 5.4.1 foi mantido. O backend usa a mesma versão, fixada no lock do Deno. Não há framework no frontend nem biblioteca de cartão: o pagamento acontece no Mercado Pago.
