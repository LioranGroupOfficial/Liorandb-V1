# LioranDB Server

A lightweight, self-hosted database server built with Node.js and Express. LioranDB provides a REST API for managing databases, collections, and documents with JWT-based authentication.

## Features

- 🔐 **JWT Authentication** - Secure user authentication and authorization
- 🗄️ **Database Management** - Create, delete, and manage multiple databases
- 📚 **Collections** - Organize documents into logical collections
- 📄 **Document Operations** - CRUD operations with query support
- 💾 **Persistent Storage** - Built-in data persistence
- 🚀 **RESTful API** - Easy-to-use REST endpoints
- 📊 **Statistics** - Database and collection statistics
- 🖥️ **CLI Tool** - Command-line interface for database management
- 🔄 **CORS Support** - Cross-origin resource sharing enabled

## Quick Start

### Prerequisites

- Node.js 16.x or higher
- npm or yarn

### Installation

#### Option 1: Global Installation (Recommended)

Install LioranDB globally to use the CLI and server anywhere:

```bash
npm i -g @liorandb/db
```

Then access the tools via npx:

```bash
# Start the server
npx ldb-serve

# Run the CLI tool
npx ldb-cli
```

#### Option 2: Local Installation

1. Clone the repository:
```bash
git clone https://github.com/LioranGroupOfficial/Liorandb.git
cd server
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm run dev
```

The server will start on `http://localhost:4000`

## Usage

### Server Binaries

Once installed globally or locally, you have access to:

```bash
# Start the server (port 4000)
ldb-serve

# Run the CLI tool for database management
ldb-cli
```

### Using npx

If installed globally, you can also use npx:

```bash
npx ldb-serve
npx ldb-cli
```

## Development

### Available Commands (Local Development)

```bash
# Start development server with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Start production server
npm start

# Run CLI tool
npm run cli
```

### Project Structure

```
src/
├── app.ts                    # Express app configuration
├── server.ts               # Server entry point
├── cli/
│   └── index.ts           # CLI tool implementation
├── config/
│   └── database.ts        # Database configuration
├── controllers/
│   ├── auth.controller.ts
│   ├── collection.controller.ts
│   ├── database.controller.ts
│   └── document.controller.ts
├── middleware/
│   ├── auth.middleware.ts
│   └── requestLogger.middleware.ts
├── routes/
│   ├── auth.routes.ts
│   ├── collection.routes.ts
│   ├── database.routes.ts
│   └── document.routes.ts
├── types/
│   ├── auth-user.ts
│   └── express.d.ts
└── utils/
    ├── hostLogger.ts
    └── token.ts
```

## API Documentation

### Base URL
```
http://<host>:4000
```

### Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <token>
```

### Core Endpoints

#### Health Check
- **GET** `/health` - Server health status
- **GET** `/` - Host information

#### Authentication
- **POST** `/auth/register` - Create new user account
- **POST** `/auth/login` - Login and get JWT token

#### Database Management
- **GET** `/databases` - List all databases
- **POST** `/databases` - Create new database
- **DELETE** `/databases/:db` - Delete database
- **PATCH** `/databases/:db/rename` - Rename database
- **GET** `/databases/:db/stats` - Get database statistics

#### Collections
- **GET** `/db/:db/collections` - List collections
- **POST** `/db/:db/collections` - Create collection
- **DELETE** `/db/:db/collections/:col` - Delete collection
- **PATCH** `/db/:db/collections/:col/rename` - Rename collection
- **GET** `/db/:db/collections/:col/stats` - Get collection statistics

#### Documents
- **POST** `/db/:db/collections/:col` - Insert single document
- **POST** `/db/:db/collections/:col/bulk` - Insert multiple documents
- **POST** `/db/:db/collections/:col/find` - Query documents
- **PATCH** `/db/:db/collections/:col/updateMany` - Update documents
- **POST** `/db/:db/collections/:col/deleteMany` - Delete documents
- **POST** `/db/:db/collections/:col/count` - Count documents

For detailed API documentation, see [API.md](./API.md)

## Example Usage

### Register and Login

```bash
# Register
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}'

# Login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}'
```

### Create Database

```bash
curl -X POST http://localhost:4000/databases \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"mydb"}'
```

### Create Collection

```bash
curl -X POST http://localhost:4000/db/mydb/collections \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"users"}'
```

### Insert Document

```bash
curl -X POST http://localhost:4000/db/mydb/collections/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"John","age":30,"email":"john@example.com"}'
```

### Query Documents

```bash
curl -X POST http://localhost:4000/db/mydb/collections/users/find \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"query":{"age":{"$gt":25}}}'
```

## Configuration

The server uses environment-based configuration:

- **PORT**: Server port (default: 4000)
- **NODE_ENV**: Environment mode (development/production)

### Server Settings

The server runs on `0.0.0.0:4000` to accept connections from all network interfaces.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^5.2.1 | Web framework |
| jsonwebtoken | ^9.0.3 | JWT handling |
| bcryptjs | ^3.0.3 | Password hashing |
| cors | ^2.8.6 | Cross-origin support |
| @liorandb/core | ^1.0.9 | Core database logic |

## Development Dependencies

- TypeScript 5.9.3
- ts-node 10.9.2
- ts-node-dev 2.0.0
- nodemon 3.1.11

## Error Handling

The API returns standard HTTP status codes:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request |
| 401 | Unauthorized |
| 409 | Conflict |
| 500 | Server error |

## CLI Tool

The server includes a command-line interface for database management.

**Global installation:**
```bash
ldb-cli
```

**Via npx:**
```bash
npx ldb-cli
```

**Local development:**
```bash
npm run cli
```

## Security

- Passwords are hashed using bcryptjs
- JWT tokens are used for API authentication
- CORS is enabled for cross-origin requests
- Request logging for monitoring

## Performance

- Request logging middleware for tracking
- CORS enabled for efficient cross-origin communication
- Express.json() middleware for JSON parsing

## Troubleshooting

### Port Already in Use
If port 4000 is already in use, the server will fail to start. Either:
- Stop the service using port 4000
- Modify the PORT environment variable

### Authentication Failed
- Ensure you're including the Authorization header
- Verify the JWT token hasn't expired
- Check that you registered/logged in first

### Database Not Found
- Ensure the database name is correct
- Create the database first with POST /databases

## Related Projects

- **LioranDB Studio** - Web UI for database management
- **LioranDB Core** - Core database engine

## License

LDEP License

## Author

Lioran Group

---

For more detailed information, see [API.md](./API.md) for complete endpoint documentation and [SETUP.md](./SETUP.md) for deployment instructions.
