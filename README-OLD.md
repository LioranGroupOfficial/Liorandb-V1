# LioranDB

**Next‑generation lightweight database ecosystem for modern developers.**

LioranDB is a **modular database platform** built for speed, simplicity, and developer experience. It combines:

* 🧠 **Embedded database engine (Core)**
* 🌐 **Self‑hosted REST database server**
* 🎨 **Professional web‑based Studio UI**
* ⚡ **MongoDB‑style JavaScript / TypeScript Driver**

This repository is the **monorepo** containing all major components of the LioranDB ecosystem.

---

## 🏗 Architecture Overview

```
                 ┌─────────────┐
                 │   Studio    │  (Web UI)
                 └──────┬──────┘
                        │
                        ▼
┌──────────────┐   REST API   ┌──────────────┐
│   Driver     │ ───────────▶ │   Server     │
└──────────────┘               └──────┬───────┘
                                       │
                                       ▼
                                 ┌─────────┐
                                 │  Core   │
                                 └─────────┘
```

Each layer is **fully modular** and can be used independently or together.

---

## 📦 Repository Structure

This monorepo is split into **three main branches**, each representing a major component:

| Branch     | Package            | Description                                                        |
| ---------- | ------------------ | ------------------------------------------------------------------ |
| **main**   | —                  | Meta repository containing full ecosystem overview & orchestration |
| **core**   | `@liorandb/core`   | Embedded encrypted TypeScript-first database engine                |
| **driver** | `@liorandb/driver` | MongoDB‑styled TypeScript SDK for server API                       |
| **studio** | `@liorandb/studio` | Professional Next.js based database management UI                  |

---

## 🧩 Ecosystem Components

### 1️⃣ LioranDB Core — Embedded Engine

> Lightweight encrypted database engine for Node.js

* Embedded
* Encrypted
* Type-safe
* Zero services required

```bash
npm install @liorandb/core
```

📄 Docs → `core` branch

---

### 2️⃣ LioranDB Server — Self-hosted DB Server

> RESTful database server built on top of Core

* JWT Authentication
* Multi-database support
* Collection & document APIs
* CLI support

```bash
npm install -g @liorandb/db
ldb-serve
```

📄 Docs → `server` directory

---

### 3️⃣ LioranDB Driver — Mongo-like SDK

> Official TypeScript SDK with MongoDB-style API

* Promise based
* Fully typed
* Zero config

```bash
npm install @liorandb/driver
```

📄 Docs → `driver` branch

---

### 4️⃣ LioranDB Studio — Professional UI

> MongoDB Compass‑like management UI

* Next.js 14
* Monaco editor
* Realtime metrics
* Light / Dark mode

```bash
npx @liorandb/studio my-studio
cd my-studio
npm run dev
```

📄 Docs → `studio` branch

---

## ⚡ Quick Start (Full Stack)

```bash
# Install server
npm i -g @liorandb/db
ldb-serve

# Create studio
npx @liorandb/studio my-studio
cd my-studio
npm run dev
```

Open:

* Server → [http://localhost:4000](http://localhost:4000)
* Studio → [http://localhost:3000](http://localhost:3000)

---

## 🎯 Design Goals

* ⚡ **Extreme simplicity**
* 🔐 **Security by default**
* 🧠 **TypeScript‑first**
* 🧩 **Fully modular**
* 🏎 **High performance**
* 🪶 **Lightweight & hackable**

---

## 🛠 Technology Stack

### Core

* TypeScript
* LevelDB (`classic-level`)
* AES encryption

### Server

* Node.js
* Express
* JWT

### Driver

* TypeScript
* REST client

### Studio

* Next.js 14
* Tailwind CSS
* Zustand
* Monaco Editor

---

## 🧭 Roadmap

* 🔁 P2P Sync
* 📊 Indexing
* ⚡ WAL
* 🌐 Edge adapters
* 🧾 Schema validation
* 📱 Desktop Studio via Tauri

---

## 🤝 Contributing

Contributions are welcome.

```bash
git clone https://github.com/LioranGroupOfficial/Liorandb
```

Open PRs against relevant branches.

---

## 📄 License

LDEP License

---

## 👨‍💻 Author

Built & maintained by **Swaraj Puppalwar** 🚀

> Building next‑gen developer infrastructure.

---

⭐ If you like LioranDB — star the repo & help us grow!
