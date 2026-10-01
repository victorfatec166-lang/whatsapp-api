# 📱 WhatsApp API

API para automação e integração com o WhatsApp, desenvolvida com **Node.js e TypeScript**, utilizando a biblioteca **Baileys** para comunicação com o WhatsApp.

> 🚧 **Projeto em desenvolvimento**
>
> Este projeto está sendo desenvolvido para fins de estudo, aprendizado e experimentação com APIs, automação e integração com o WhatsApp.

---

## ✨ Sobre o projeto

O **WhatsApp API** é uma aplicação backend criada para explorar a integração entre sistemas e o WhatsApp.

O projeto utiliza uma arquitetura baseada em API e possui recursos voltados para gerenciamento da conexão com o WhatsApp, autenticação através de QR Code e persistência de dados.

A aplicação foi desenvolvida como um projeto de aprendizado, com foco na prática de conceitos como:

* Desenvolvimento de APIs REST
* TypeScript
* Node.js
* Integração com serviços externos
* Autenticação e gerenciamento de sessão
* Banco de dados com Prisma
* Geração de QR Code
* Organização de projetos backend
* Testes automatizados

---

## 🛠️ Tecnologias utilizadas

| Tecnologia         | Utilização                     |
| ------------------ | ------------------------------ |
| **Node.js**        | Ambiente de execução           |
| **TypeScript**     | Desenvolvimento da aplicação   |
| **Express**        | Criação da API                 |
| **Baileys**        | Integração com o WhatsApp      |
| **Prisma**         | ORM e acesso ao banco de dados |
| **Pino**           | Sistema de logs                |
| **Zod**            | Validação de dados             |
| **QRCode**         | Geração de QR Codes            |
| **Tailwind CSS**   | Estilização da interface       |
| **tsx**            | Execução de TypeScript         |
| **Jest/Node Test** | Testes automatizados           |

As principais dependências podem ser consultadas no `package.json` do projeto.

---

## 📂 Estrutura do projeto

```text
whatsapp-api/
│
├── prisma/
│   └── Banco de dados e configurações do Prisma
│
├── scripts/
│   └── Scripts auxiliares de verificação
│
├── src/
│   └── Código-fonte da aplicação
│
├── tests/
│   └── Testes automatizados
│
├── .gitignore
├── package.json
├── package-lock.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

## 🚀 Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/victorfatec166-lang/whatsapp-api.git
```

### 2. Entre na pasta

```bash
cd whatsapp-api
```

### 3. Instale as dependências

```bash
npm install
```

---

## ⚙️ Configuração

Antes de executar o projeto, configure as variáveis de ambiente necessárias para a aplicação.

Crie um arquivo:

```text
.env
```

e adicione as configurações necessárias para o ambiente de desenvolvimento.

> ⚠️ Nunca envie senhas, tokens, chaves privadas ou outras informações sensíveis para o GitHub.

---

## 🗄️ Banco de dados

O projeto utiliza **Prisma** para gerenciamento da camada de banco de dados.

Após configurar o ambiente, execute os comandos necessários do Prisma para preparar o banco:

```bash
npx prisma generate
```

Caso o projeto utilize migrations:

```bash
npx prisma migrate dev
```

---

## ▶️ Executando o projeto

Para gerar a versão de produção:

```bash
npm run build
```

Depois, execute:

```bash
npm start
```

O projeto também possui comandos auxiliares definidos no `package.json`, incluindo compilação de TypeScript, compilação de CSS, testes e verificações de código.

---

## 📦 Instalador para Windows

O sistema é distribuído como um instalador de arquivo único, gerado com o [Inno Setup](https://jrsoftware.org/isinfo.php). Quem instala não precisa de Node, nem de qualquer outro pré-requisito: o runtime viaja dentro do instalador.

A única dependência externa da montagem é o próprio Inno Setup:

```bash
winget install JRSoftware.InnoSetup
```

Para gerar o instalador:

```bash
npm run installer
```

O comando faz a montagem inteira — compila o sistema, baixa as dependências só de produção, gera o cliente do Prisma, monta o payload e chama o Inno Setup. Leva alguns minutos, e a maior parte do tempo é a compactação.

O instalador sai em:

```
release\Instalar DeliveryAdmin.exe
```

Para recompilar **sem** refazer a montagem (útil quando só o `.iss` ou o ícone mudaram):

```bash
npm run installer:rapido
```

Esse caminho rápido é recusado se o payload estiver mais velho que o `dist\` do projeto — o mesmo defeito que faria o instalador levar o servidor de ontem, sem nenhum aviso. Nesse caso, rode `npm run installer`.

Depois de instalar, o programa fica em `C:\Program Files\DeliveryAdmin`, e os dados do dono (banco, sessão do WhatsApp, backups e logs) em `%APPDATA%\DeliveryAdmin`. São separados de propósito: trocar o programa nunca toca no banco, e desinstalar não apaga o histórico de pedidos.

O instalador é **Windows x64**. O runtime e os motores nativos do Prisma são binários dessa plataforma; não há artefato para macOS ou Linux.

---

## 🧪 Testes

Para executar os testes automatizados:

```bash
npm test
```

Para executar as verificações do projeto:

```bash
npm run check
```

Também existem verificações específicas para:

```bash
npm run check:ui
```

```bash
npm run check:js
```

```bash
npm run check:contrast
```

---

## 🔧 Scripts disponíveis

| Comando                  | Descrição                          |
| ------------------------ | ---------------------------------- |
| `npm run build`          | Compila o projeto                  |
| `npm run build:ts`       | Compila o TypeScript               |
| `npm run build:css`      | Compila o CSS                      |
| `npm run clean`          | Remove os arquivos de build        |
| `npm run start`          | Inicia a aplicação compilada       |
| `npm run test`           | Executa os testes                  |
| `npm run check`          | Executa as verificações do projeto |
| `npm run check:ui`       | Verifica a interface               |
| `npm run check:js`       | Verifica o JavaScript              |
| `npm run check:ps1`      | Verifica a sintaxe dos scripts do instalador |
| `npm run check:contrast` | Verifica contraste da interface    |
| `npm run installer`      | Monta o instalador do Windows      |
| `npm run installer:rapido` | Recompila o instalador sem refazer a montagem |
| `npm run watch:css`      | Observa alterações no CSS          |

Os scripts acima são definidos atualmente no `package.json` do repositório.

---

## 📡 Integração com WhatsApp

A comunicação com o WhatsApp é realizada utilizando a biblioteca **Baileys**.

A autenticação da sessão utiliza QR Code, permitindo estabelecer a conexão entre a aplicação e uma conta do WhatsApp.

> **Importante:** este projeto é experimental e está sujeito a alterações conforme o desenvolvimento da aplicação e mudanças nas tecnologias utilizadas.

---

## 🔐 Segurança

Ao utilizar uma API de automação do WhatsApp, tenha cuidado com:

* Credenciais de acesso
* Arquivos de sessão
* Tokens
* Variáveis de ambiente
* Dados armazenados no banco
* Logs contendo informações sensíveis

Nunca publique informações privadas no repositório.

Recomenda-se utilizar um arquivo `.env` para configurações sensíveis e adicioná-lo ao `.gitignore`.

---

## 📚 Objetivos de aprendizado

Este projeto faz parte do processo de aprendizado e prática em desenvolvimento de software.

Entre os principais objetivos estão:

```text
TypeScript
    ↓
Node.js
    ↓
Express
    ↓
API REST
    ↓
Baileys
    ↓
WhatsApp
    ↓
Prisma
    ↓
Banco de Dados
```

---

## 🔮 Próximos passos

Algumas funcionalidades que podem ser exploradas durante a evolução do projeto:

* [ ] Melhorar documentação da API
* [ ] Documentar endpoints
* [ ] Implementar gerenciamento de múltiplas sessões
* [ ] Melhorar gerenciamento de autenticação
* [ ] Criar painel administrativo
* [ ] Adicionar documentação Swagger/OpenAPI
* [ ] Melhorar sistema de logs
* [ ] Adicionar mais testes automatizados
* [ ] Implementar gerenciamento de contatos
* [ ] Implementar envio de mensagens
* [ ] Implementar recebimento e processamento de mensagens
* [ ] Melhorar tratamento de erros
* [ ] Containerização com Docker

---

## 👨‍💻 Autor

Desenvolvido por **Victor Fatec** como projeto de estudo e desenvolvimento de conhecimentos em programação e backend.

GitHub:

[victorfatec166-lang](https://github.com/victorfatec166-lang?utm_source=chatgpt.com)

---

## 📄 Licença

Este projeto está em desenvolvimento.

Consulte o repositório para obter informações sobre a licença e as condições de utilização.

---

⭐ Se este projeto estiver sendo útil para seus estudos, considere acompanhar sua evolução através do GitHub.
