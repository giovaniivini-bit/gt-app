# Guia de Deploy do GT App na VPS

Este guia passo a passo ajudará você a configurar e hospedar o **GT App** na sua VPS para que toda a equipe possa usá-lo simultaneamente no computador e no celular.

---

## 👥 Concorrência e Multi-usuário
**Sim, é 100% possível e seguro!**
- O backend do aplicativo foi estruturado em **Node.js**, que lida muito bem com múltiplas requisições simultâneas.
- Como o banco de dados principal é o **Google Sheets**, e a própria Google lida nativamente com edições concorrentes de várias pessoas ao mesmo tempo, não haverá conflitos de dados.
- O mecanismo de **sincronização automática (polling)** que incluímos no frontend garante que se a *Pessoa A* atualizar ou concluir uma tarefa no celular dela, a tela da *Pessoa B* (e de todos os outros) se atualizará sozinha em até 10 segundos, mantendo a equipe em sintonia constante.

---

## 🛠️ Requisitos na VPS
1. **Node.js** (Versão 18 ou superior) instalado.
2. **Git** instalado.
3. **PM2** (gerenciador de processos Node.js para manter o app rodando 24/7).

---

## 🚀 Passo a Passo do Deploy

### Passo 1: Clonar o Código do GitHub
Conecte-se à sua VPS via SSH e clone o repositório na pasta desejada (por exemplo, `/var/www` ou na pasta home do seu usuário):
```bash
# Vá para o diretório de destino
cd /var/www

# Clone o repositório do seu GitHub
git clone https://github.com/giovaniivini-bit/gt-app.git

# Acesse a pasta do projeto
cd gt-app
```

### Passo 2: Instalar as Dependências
Instale os pacotes necessários do Node.js:
```bash
npm install --production
```

### Passo 3: Copiar as Credenciais do Google (Muito Importante!)
Para que o servidor na VPS possa ler e escrever na planilha, você precisa enviar os arquivos de autenticação (`credentials.json` e `token.json`) para a VPS.

Por questões de segurança, **nunca envie esses arquivos para o GitHub público**. Em vez disso, envie-os diretamente do seu computador para a VPS usando SCP, FileZilla ou criando os arquivos manualmente.

No código, o servidor procura por estes arquivos na **pasta pai** do projeto (`../credentials.json` e `../token.json`). 
Se o seu app estiver em `/var/www/gt-app`, os arquivos devem ser colocados em `/var/www/`.

#### Exemplo de comando via SCP (rode no terminal do seu computador local):
```bash
# Copiar as credenciais para a pasta pai na VPS
scp credentials.json token.json usuario_vps@IP_DA_SUA_VPS:/var/www/
```

*(Ou você pode simplesmente abrir o FileZilla, conectar na sua VPS e arrastar os arquivos `credentials.json` e `token.json` para a pasta pai da pasta `gt-app`)*.

---

### Passo 4: Configurar o PM2 (Gerenciamento do Servidor)
Para garantir que o app continue rodando mesmo que você feche o terminal SSH, e que ele reinicie automaticamente se a VPS for reiniciada, use o **PM2**:

```bash
# Instalar o PM2 globalmente (se já não estiver instalado)
sudo npm install -g pm2

# Iniciar o servidor Node.js
pm2 start server.js --name "gt-app"

# Salvar a lista de processos ativa
pm2 save

# Configurar para inicializar junto com o sistema operacional
pm2 startup
```
*(O último comando `pm2 startup` exibirá um comando na tela que você deve copiar e colar no terminal para confirmar a inicialização do sistema).*

---

### Passo 5: Liberar a porta no Firewall da VPS
Certifique-se de que a porta `3020` está aberta para conexões externas na sua VPS. 
Se a sua VPS usar o firewall `ufw` (comum no Ubuntu):
```bash
sudo ufw allow 3020/tcp
sudo ufw reload
```

Pronto! Agora qualquer pessoa na empresa poderá acessar o app digitando:
`http://IP_DA_SUA_VPS:3020`

---

## 🔒 Dica Extra: Configurar Domínio com HTTPS (Nginx & SSL)
Para que os usuários acessem por um domínio bonito (ex: `http://gt.confeccoesoneda.com.br`) e com certificado de segurança SSL (HTTPS):

1. Crie uma entrada de DNS do tipo **A** apontando para o IP da sua VPS.
2. Instale o **Nginx** na VPS:
   ```bash
   sudo apt update
   sudo apt install nginx -y
   ```
3. Crie um arquivo de configuração para o Nginx em `/etc/nginx/sites-available/gt-app`:
   ```nginx
   server {
       listen 80;
       server_name gt.confeccoesoneda.com.br;

       location / {
           proxy_pass http://localhost:3020;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
4. Ative o site e reinicie o Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/gt-app /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```
5. Instale o **Certbot** para gerar o certificado SSL grátis:
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d gt.confeccoesoneda.com.br
   ```
