# LioranDB Server

LioranDB Server is a Node.js + TypeScript REST API server built on top of **LioranDB Core**, designed to manage databases, collections, and documents, while providing user authentication. It is intended as the backend for applications using the LioranDB database engine.

---

## Table of Contents

* [Features](#features)
* [Tech Stack](#tech-stack)
* [Setup](#setup)
* [Environment Variables](#environment-variables)
* [Scripts](#scripts)
* [API Endpoints](#api-endpoints)
* [Project Structure](#project-structure)
* [License](#license)

---

## Features

* User authentication (register/login) with JWT tokens
* CRUD operations for databases, collections, and documents
* Health check endpoint
* TypeScript support with strict typing
* Middleware for authentication

---

## Tech Stack

* Node.js
* TypeScript
* Express.js
* LioranDB Core
* bcryptjs
* jsonwebtoken
* dotenv

---

## Setup

1. Clone the repository

```bash
git clone <repo_url>
cd server
```

2. Install dependencies

```bash
npm install
```

3. Create a `.env` file at the root:

```env
PORT=4000
JWT_SECRET=<your_jwt_secret>
JWT_EXPIRES_IN=7d
```

4. Run the development server

```bash
npm run dev
```

The server will start on `http://localhost:4000` (or your configured PORT).

---

## Environment Variables

* `PORT` – Port number for the server (default: 4000)
* `JWT_SECRET` – Secret key used for signing JWT tokens **(required)**
* `JWT_EXPIRES_IN` – JWT expiration time (default: `7d`)

---

## Scripts

* `npm run dev` – Start the development server with hot reload
* `npm run build` – Compile TypeScript to JavaScript (`dist/` folder)
* `npm start` – Run the compiled server

---

## API Endpoints

### Health Check

* `GET /health` – Returns server status

### Authentication

* `POST /auth/register` – Register a new user
* `POST /auth/login` – Login and receive JWT token

### Databases

* `GET /databases` – List all databases
* `POST /databases` – Create a new database
* `DELETE /databases/:db` – Delete a database

### Collections

* `GET /db/:db/collections` – List all collections in a database
* `POST /db/:db/collections` – Create a new collection

### Documents

* `POST /db/:db/collections/:col` – Insert a document
* `POST /db/:db/collections/:col/find` – Find documents by query
* `GET /db/:db/collections/:col/:id` – Get a single document by ID
* `PATCH /db/:db/collections/:col/:id` – Update a document by ID
* `DELETE /db/:db/collections/:col/:id` – Delete a document by ID

> All database, collection, and document endpoints require **Bearer JWT authentication**

---

## Project Structure

```
server/
├─ src/
│  ├─ config/
│  │  └─ database.ts        # LioranDB manager and auth collection
│  ├─ controllers/
│  │  ├─ auth.controller.ts
│  │  ├─ collection.controller.ts
│  │  ├─ database.controller.ts
│  │  └─ document.controller.ts
│  ├─ middleware/
│  │  └─ auth.middleware.ts
│  ├─ routes/
│  │  ├─ auth.routes.ts
│  │  ├─ collection.routes.ts
│  │  ├─ database.routes.ts
│  │  └─ document.routes.ts
│  ├─ types/
│  │  ├─ auth-user.ts
│  │  └─ express.d.ts
│  ├─ utils/
│  │  └─ token.ts
│  ├─ app.ts
│  └─ server.ts
├─ package.json
├─ tsconfig.json
└─ .env
```

---

## License

This project is licensed under the **ISC License**.

---

## Notes

* Make sure to set a strong `JWT_SECRET` in `.env`
* The server is designed to work with **LioranDB Core**, which is a peer-to-peer database engine.
* TypeScript strict mode is enabled for safer coding.

---

For further documentation on **LioranDB Core**, refer to its repository: [LioranDB Core](https://www.npmjs.com/package/@liorandb/core)
