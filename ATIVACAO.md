# PASSOS QUE VOCÊ PRECISA FAZER

O código está implementado, mas **cadastros, e-mails e cobranças reais ainda não estão ativos**. Não foram criadas contas nos provedores nem usados tokens privados. Faça as configurações abaixo antes de anunciar a assinatura.

## 1. Criar as contas

1. Crie/acesse uma conta em [Supabase](https://supabase.com/dashboard).
2. Crie/acesse sua conta de vendedor no [Mercado Pago Developers](https://www.mercadopago.com.br/developers/pt).
3. Use a conta de hospedagem escolhida (o passo 7 usa Cloudflare Pages).
4. Prepare um serviço de e-mail com SMTP para confirmação e recuperação de senha.

A hospedagem estática e o Supabase podem começar em planos gratuitos, sujeitos aos limites dos provedores. Pagamentos têm taxas. E-mail transacional e domínio/remetente podem exigir configuração ou custo. Não há promessa de operação ilimitada a R$0.

## 2. Criar o projeto Supabase e configurar o cadastro

1. No dashboard, clique em **New project**.
2. Escolha a organização, nomeie o projeto e crie uma senha forte para o banco. Guarde-a no seu gerenciador de senhas.
3. Escolha a região adequada e aguarde o projeto ficar disponível.
4. Em **Project Settings → API / API Keys**, copie a **Project URL** e a **Publishable key**. Se estiver usando as chaves legadas, use somente a chave **anon**.
5. Abra **app-config.js** no editor e preencha:
   - supabaseUrl: a Project URL HTTPS;
   - supabasePublishableKey: a Publishable key ou anon.
6. **Nunca** coloque service_role, Secret key, senha do banco ou token do Mercado Pago nesse arquivo.
7. Em **Authentication → Sign In / Providers → Email**, mantenha cadastro e confirmação de e-mail habilitados.
8. Nas configurações de senha do Auth, exija ao menos **12 caracteres**.
9. Em **Authentication → URL Configuration**, coloque a URL pública final como **Site URL**. Inclua a mesma URL, com caminho e barra final corretos, em **Redirect URLs**. Para desenvolvimento, adicione http://localhost:8000/.
10. Não configure redirecionamentos curinga amplos para domínios que você não controla.

O telefone é coletado como dado de perfil, não como login ou número verificado por SMS.

## 3. Configurar os e-mails

O SMTP padrão do Supabase é para testes: restringe destinatários e não serve como envio de produção. Veja a [documentação oficial](https://supabase.com/docs/guides/auth/auth-smtp).

1. No provedor de e-mail escolhido, configure um remetente autorizado e obtenha host, porta, usuário e senha SMTP.
2. No Supabase, vá a **Authentication → Email → SMTP Settings** (ou **Custom SMTP**, conforme a interface).
3. Ative o SMTP personalizado e preencha esses dados.
4. Defina nome do remetente **ArrumaMeuCSV** e um endereço de remetente autorizado.
5. Nas templates de confirmação e recuperação, preserve o link de confirmação fornecido pelo Supabase.
6. Teste confirmação e recuperação com um e-mail seu que não pertença à equipe do projeto.
7. Configure os limites e a proteção contra abuso do Auth antes de divulgar. Não desabilite a confirmação de e-mail para contornar falhas do SMTP.

## 4. Aplicar o banco e publicar o backend

Abra o PowerShell na pasta do projeto. Os comandos abaixo usam a CLI do Supabase; você fará login e autorizará sua própria conta.

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
npx supabase functions deploy saas --no-verify-jwt
```

- Substitua SEU_PROJECT_REF pelo identificador do projeto mostrado no dashboard.
- Se a CLI pedir a senha do banco, use a senha definida ao criar o projeto.
- O db push aplica a migration de perfis, políticas RLS, assinaturas e limites. Não execute o SQL repetidamente no editor se já aplicou via CLI.
- A função usa verify_jwt=false na entrada para receber webhooks do Mercado Pago. **O código valida o JWT nas rotas privadas e o HMAC no webhook**; não remova essas verificações.
- O endpoint será https://SEU_PROJECT_REF.supabase.co/functions/v1/saas.
- Nunca copie um CSV de cliente para o repositório para testá-lo.

Alternativa para inspecionar o banco: o arquivo está em supabase/migrations/202609090001_accounts.sql. Se optar por aplicar manualmente, registre essa decisão antes de usar db push, para não reaplicar a mesma migration.

## 5. Configurar Mercado Pago e segredos do servidor

1. Entre em **Suas integrações** no Mercado Pago Developers e crie uma aplicação.
2. Configure o uso da API de **Assinaturas**, com checkout hospedado. A implementação cria uma assinatura mensal sem plano associado, com status inicial pending.
3. Prepare comprador e vendedor de teste conforme o ambiente de assinaturas do Mercado Pago. Não use um comprador real para simular teste.
4. Guarde o Access Token da conta recebedora escolhida. Não é uma Public key.
5. Identifique o ID da conta recebedora, usado em collector_id. Você pode obter o campo id de GET /users/me no explorador da API autenticado com esse Access Token. Não confunda com o Client ID da aplicação.
6. Configure os segredos no Supabase em **Edge Functions → Secrets**:
   - **APP_URL**: URL HTTPS final do site, com barra final; por exemplo, a URL pages.dev que você receber. Não use um domínio inventado.
   - **MP_ACCESS_TOKEN**: token privado do vendedor do ambiente escolhido.
   - **MP_COLLECTOR_ID**: ID numérico do recebedor desse token.
   - **MP_LIVE_MODE**: false em teste; true apenas em produção.
   - **BILLING_ENABLED**: false até preparar os demais itens; true para liberar a contratação no ambiente que está sendo testado.
   - **MP_WEBHOOK_SECRET**: segredo da assinatura de webhook, obtido no próximo passo.
7. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pelo ambiente das Edge Functions. Não os coloque no frontend.

Se preferir usar arquivo local: copie supabase/functions/.env.example para supabase/functions/.env, preencha e execute:

```powershell
npx supabase secrets set --env-file supabase/functions/.env
```

O arquivo .env é ignorado pelo Git. Não o publique, não o envie pelo chat e não o inclua em dist/ ou assets/.

O valor e a periodicidade estão fixados no backend: **49.99 BRL, a cada 1 mês**. O cliente não pode escolher um preço menor. Alterar o texto do site não muda contratos já criados.

## 6. Configurar o webhook

1. Na aplicação do Mercado Pago, abra **Webhooks / Notificações**.
2. Cadastre a URL:
   https://SEU_PROJECT_REF.supabase.co/functions/v1/saas?action=webhook
3. Habilite os eventos:
   - subscription_preapproval;
   - subscription_authorized_payment;
   - payment.
4. Copie a chave secreta exibida e salve como MP_WEBHOOK_SECRET no Supabase.
5. O provedor deve enviar data.id na query string, x-request-id e x-signature. A função rejeita chamadas sem assinatura válida.
6. Confira o histórico de entregas no Mercado Pago. Falhas retornam erro para permitir nova tentativa; não ignore notificações rejeitadas.
7. Não use o redirecionamento do checkout como comprovação de pagamento.

Fontes oficiais: [assinatura com pagamento pendente](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments), [webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks).

## 7. Publicar o frontend

No PowerShell:

```powershell
npm ci
npm run build
```

Publique somente dist/. A pasta pública contém as chaves públicas do app-config.js e nunca deve conter .env, backend, banco, testes ou arquivos de clientes.

### Cloudflare Pages com GitHub

1. Depois de revisar as mudanças e configurar a chave pública, salve no GitHub usando os comandos do passo 10.
2. No Cloudflare, vá a **Workers & Pages → Create application → Pages → Connect to Git**.
3. Conecte sua conta GitHub e selecione **arruma-meu-csv**.
4. Branch de produção: **main**.
5. Framework preset: **None**.
6. Build command: **npm run build**.
7. Build output directory: **dist**.
8. Não coloque os segredos do Mercado Pago nas variáveis do frontend; eles pertencem ao Supabase.
9. Clique em **Save and Deploy**.
10. Abra a URL de produção mostrada, terminada em pages.dev.
11. Volte aos passos 2 e 5 e confira Site URL, Redirect URLs e APP_URL usando exatamente essa URL.
12. Se já existia um projeto Pages, atualize suas configurações de build para npm run build e dist.

Guia: [integração Git do Cloudflare Pages](https://developers.cloudflare.com/pages/get-started/git-integration/).

O frontend também é compatível com Netlify e Vercel usando npm run build e saída dist. **Vercel Hobby restringe uso comercial**, então não é a indicação para esta oferta com custo inicial zero. [Regra oficial](https://vercel.com/docs/plans/hobby). GitHub Pages não é recomendado para hospedar este negócio devido às restrições comerciais.

## 8. Homologar o fluxo antes de cobrar pessoas reais

Use ambiente/contas de teste do Mercado Pago:

1. Cadastre-se com nome, e-mail, telefone e senha.
2. Confirme o e-mail e entre.
3. Saia e teste Esqueci minha senha; abra o link recebido e escolha outra senha.
4. Analise um CSV gratuito sem autorizar limpeza: não deve haver envio do CSV.
5. Tente a limpeza sem pagamento: o servidor deve negar Pro.
6. Marque a confirmação de R$49,99/mês e prossiga ao checkout.
7. Confira valor, moeda e recorrência na tela do Mercado Pago.
8. Antes de pagar, a conta deve continuar pendente.
9. Conclua um pagamento de teste e aguarde o webhook ou use Atualizar assinatura.
10. Confira que a conta mostra Pro ativo e a data do período pago.
11. Autorize o envio de um CSV sintético de até 5 MiB, escolha ajustes, gere a prévia e baixe.
12. Abra o resultado no Excel/Python e confira cabeçalhos, duplicatas e proteção de fórmulas.
13. Teste pagamento recusado, estorno, repetição de webhook e cancelamento; não deve liberar período não pago.
14. Cancele a renovação pela conta e confirme também no Mercado Pago. O acesso permanece apenas até o fim do período pago.
15. Teste em Android/iPhone e no navegador interno do TikTok.
16. Não divulgue o checkout enquanto esses testes reais do provedor estiverem pendentes.

Os testes locais automatizados não enviam e-mails e não movimentam dinheiro. Eles verificam lógica e interface com respostas simuladas, além de políticas SQL em PostgreSQL embarcado.

## 9. Ativar produção e operar o serviço

1. Use credenciais e recebedor de produção e configure MP_LIVE_MODE=true.
2. Confira novamente o segredo e a URL de webhook do ambiente de produção.
3. Quando estiver pronto para aceitar contratações, configure BILLING_ENABLED=true.
4. Confirme no Mercado Pago as taxas, disponibilidade dos meios de pagamento e regras comerciais.
5. Defina o atendimento, responsabilidade sobre dados e política comercial/reembolsos aplicável à sua operação. Não prometa revisão humana inclusa no Pro.
6. Configure seu WhatsApp real em CONFIG.whatsappNumber, no início de script.js: DDI + DDD + número, somente dígitos.
7. Acompanhe falhas de webhook, uso das funções, limites de e-mail e disponibilidade do projeto.
8. Para interromper novas vendas, use BILLING_ENABLED=false. Isso não cancela assinaturas existentes. Cancele contratos no Mercado Pago quando necessário.

Se uma criação de checkout perder a resposta, a conta fica creating para evitar duplicar contratos. Atualizar assinatura tenta recuperar pelo checkout_ref. Se continuar pendente, confira no Mercado Pago pelo external_reference antes de criar qualquer outra assinatura; não apague o bloqueio sem verificar o provedor.

## 10. Salvar alterações no GitHub

Nenhum commit/push foi realizado por mim. Na pasta do projeto, revise:

```powershell
git status
git diff
git add index.html style.css script.js analyzer.js csv-worker.js auth.js pro.js app-config.js assets supabase scripts tests package.json package-lock.json README.md ATIVACAO.md .gitignore .nojekyll
git status
git commit -m "Adiciona cadastro e assinatura Pro com limpeza de CSV"
git push origin main
```

Antes do commit, confirme que nenhum .env, token privado, CSV de cliente ou node_modules aparece entre os arquivos preparados. Caso o GitHub peça autenticação, entre com sua própria conta.

## 11. URL final e apresentação

Abra a URL de produção em janela anônima e no celular. Confira HTTPS, cadastro, e-mail, planos e CTA. Se desejar canonical/og:url, use sua URL definitiva no head de index.html; não foi inventado um domínio. A página contém SEO e Open Graph textual.
