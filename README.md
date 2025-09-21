# ATARASHI

![NPM Downloads](https://img.shields.io/npm/dm/atarashi)
![NPM Version](https://img.shields.io/npm/v/atarashi)
![NPM Last Update](https://img.shields.io/npm/last-update/atarashi)

**Atarashi** is a collection of pre-made templates for rapid development using various frameworks and technologies. Whether you're starting a new project or need to quickly prototype an idea, Atarashi has got you covered with its easy-to-use, production-ready templates.

---

## 📦 Installation

Install Atarashi globally using `npm`:

```bash
npm install -g atarashi
```

---

## 🚀 Usage

Initialize a new project with Atarashi:

```bash
atarashi
```

Follow the interactive CLI to select a template and generate your project.

---

## 📁 Available Templates

### 🐘 `backend-drizzle-postgres`

A backend boilerplate using **Express**, **Drizzle ORM**, and **PostgreSQL**.

#### 🔧 Features

-   Express.js application structure
-   Drizzle ORM + PostgreSQL for typed SQL operations
-   Zod for schema validation
-   JWT-based Authentication and Cookie Parser
-   Modular Architecture with folders like controllers, routes, middlewares, and utils
-   Dockerfile and .env.sample included for easy deployment
-   TSX + Dotenv for development and start scripts
-   Pre-configured scripts: dev, start, build, and db:push
-   Async wrapper utility for cleaner code

#### 📁 Folder Structure:

```text
📁 backend-drizzle-mysql
├── 📁 public/
├── 📁 src/
│   ├── 📁 config/
│   │   ├── cookies.ts
│   │   └── env.ts
│   ├── 📁 controllers/
│   │   └── index.ts
│   ├── 📁 db/
│   │   ├── index.ts
│   │   └── schema.ts
│   ├── 📁 middlewares/
│   │   ├── auth.ts
│   │   └── error-handler.ts
│   ├── 📁 routes/
│   │   └── index.ts
│   ├── 📁 types/
│   │   ├── types.ts
│   │   └── schema.ts
│   ├── 📁 utils/
│   │   ├── async-handler.ts
│   │   ├── index.ts
│   │   ├── cookie.ts
│   │   ├── response.ts
│   │   └── jwt.ts
│   ├── app.ts
│   ├── index.ts
│
├── .dockerignore
├── .env.sample
├── .gitignore
├── Dockerfile
├── drizzle.config.ts
├── package.json
├── pnpm-lock.yaml
└── tsconfig.json

```

---

### 🆕 `backend-drizzle-mysql`

Same as the Postgres version, but powered by **MySQL** and `mysql2`.

#### 🔧 Features

-   Drizzle ORM with typed MySQL queries
-   Express backend with modular file structure
-   JWT, cookie-parser, dotenv, Zod validation
-   Docker-ready + `.env.sample` + TSX dev scripts

---

### 🍃 `backend-mongoose-mongodb`

A production-ready backend template built with **Express** and **Mongoose** for **MongoDB**.

#### 🔧 Features

-   MongoDB integration with Mongoose
-   Organized folder structure with support for future models
-   JWT-based authentication
-   Cookie handling with `cookie-parser`
-   Environment variable management with `dotenv`
-   Error handling middleware and async utilities
-   Dev-ready with TSX and TypeScript setup
-   Docker-ready

#### 🗂 Folder Structure

```text
📁 backend-mongoose-mongodb
├── 📁 public/
│   └── .gitkeep
├── 📁 src/
│   ├── app.ts
│   ├── index.ts
│   ├── 📁 config/
│   │   ├── cookies.ts
│   │   └── env.ts
│   ├── 📁 controllers/
│   │   └── index.ts
│   ├── 📁 db/
│   │   └── index.ts
│   ├── 📁 middlewares/
│   │   └── errorHandler.ts
│   ├── 📁 models/
│   │   └── .gitkeep
│   ├── 📁 routes/
│   │   └── index.routes.ts
│   └── 📁 utils/
│       ├── asyncHandler.ts
│       ├── index.ts
│       └── jwt.ts
├── .dockerignore
├── .env.sample
├── .gitignore
├── Dockerfile
├── drizzle.config.ts
├── package.json
├── pnpm-lock.yaml
└── tsconfig.json
```

---

## 🌟 Features

-   ⚡ **Rapid Development**: Start coding instantly
-   📦 **Modular Structure**: Easily maintain and scale
-   🧑‍💻 **DX Focused**: Type-safe, hot-reloading, dev-friendly
-   🌍 **Open Source**: Built to be extended by the community

---

## 🤝 Contributing

Pull requests and contributions are **super welcome**!
If you find a bug, have ideas for improvements, or want to squash bugs — go for it! 🧠

### How to contribute

1.  Fork this repo.
2.  Create a new branch (`git checkout -b feature/my-new-template`).
3.  Commit your changes (`git commit -m 'feat: Add my new template'`).
4.  Push your branch (`git push origin feature/my-new-template`).
5.  Open a Pull Request 🚀.

---

## 💬 Let’s Connect

-   🧑‍💻 **GitHub:** [callmegautam](https://github.com/callmegautam)
-   🐦 **X (Twitter):** [@iamgautamsuthar](https://x.com/iamgautamsuthar)
-   📧 **Email:** [iamgautamsuthar@gmail.com](mailto:iamgautamsuthar@gmail.com)

Made with ❤️ by [Gautam Suthar](https://github.com/callmegautam).

---

⭐ If you like this project, **please star it** — it helps more developers discover **atarashi**!
