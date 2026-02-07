# LioranDB Server - Development Guide

This guide covers development setup, architecture, and contribution guidelines for LioranDB Server.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Project Architecture](#project-architecture)
3. [Code Structure](#code-structure)
4. [Key Components](#key-components)
5. [Working with Routes](#working-with-routes)
6. [Authentication System](#authentication-system)
7. [Adding Features](#adding-features)
8. [Testing](#testing)
9. [Debugging](#debugging)
10. [Code Style](#code-style)

## Development Setup

### Prerequisites

- Node.js 16.x or higher
- npm 8.x or yarn 1.22.x
- A code editor (VS Code recommended)
- Git

### For Users

Global installation:
```bash
npm i -g @liorandb/db
ldb-serve   # Start server
ldb-cli     # Run CLI
```

### For Developers

Clone and set up the repository:

```bash
# Clone repository
git clone https://github.com/LioranGroupOfficial/Liorandb.git
cd server

# Install dependencies
npm install

# Verify setup
npm run build
```

### Start Development Server

```bash
npm run dev
```

The server will:
- Start with hot reload on `http://localhost:4000`
- Show all available network interfaces
- Display logs in the console

You can also test the global bin commands locally by using:
```bash
npm run build
node dist/server.js       # Start server directly
node dist/cli/index.js    # Run CLI directly
```

## Project Architecture

### High-Level Architecture

```
┌─────────────────────────────────────┐
│      HTTP Request (Client)          │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│         Express App (app.ts)        │
│  - CORS Configuration               │
│  - Body Parser                      │
│  - Request Logger                   │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│       Middleware Layer              │
│  - Authentication (JWT)             │
│  - Request Logging                  │
│  - Error Handling                   │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│        Route Layer                  │
│  - auth.routes.ts                   │
│  - database.routes.ts               │
│  - collection.routes.ts             │
│  - document.routes.ts               │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│      Controller Layer               │
│  - Business Logic                   │
│  - Request Validation               │
│  - Response Formatting              │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│      Data Access Layer              │
│  - @liorandb/core                   │
│  - Database Operations              │
└─────────────────────────────────────┘
```

### Layered Architecture

The application follows a layered architecture:

1. **Routes Layer** - Define API endpoints and HTTP methods
2. **Controllers Layer** - Handle business logic and validation
3. **Middleware Layer** - Authentication, logging, error handling
4. **Data Layer** - Database operations via @liorandb/core
5. **Types Layer** - TypeScript type definitions

## Code Structure

### Main Files

- **app.ts** - Express application configuration and route mounting
- **server.ts** - Server initialization and startup

### Controllers

Located in `src/controllers/`:

- **auth.controller.ts** - User registration and login
- **database.controller.ts** - Database CRUD operations
- **collection.controller.ts** - Collection management
- **document.controller.ts** - Document operations

### Routes

Located in `src/routes/`:

- **auth.routes.ts** - Authentication endpoints
- **database.routes.ts** - Database API endpoints
- **collection.routes.ts** - Collection API endpoints
- **document.routes.ts** - Document API endpoints

### Middleware

Located in `src/middleware/`:

- **auth.middleware.ts** - JWT verification and user extraction
- **requestLogger.middleware.ts** - Request/response logging

### Utilities

Located in `src/utils/`:

- **token.ts** - JWT generation and verification
- **hostLogger.ts** - Logging utilities

### Types

Located in `src/types/`:

- **auth-user.ts** - User authentication types
- **express.d.ts** - Express type extensions

## Key Components

### Authentication System

The authentication system uses JWT (JSON Web Tokens):

**Flow:**
1. User registers with username/password
2. Password is hashed with bcryptjs
3. On login, password is verified
4. JWT token is generated containing user ID
5. Token is sent to client
6. Client includes token in Authorization header for protected routes
7. Middleware verifies token and extracts user info

**Token Structure:**
```json
{
  "userId": "user-id",
  "iat": 1644312030,
  "exp": 1644398430
}
```

### Database Layer

The database layer is managed by `@liorandb/core`:
- Handles all database operations
- Manages collections and documents
- Provides query interface
- Handles persistence

### Request Flow Example

**POST /auth/login request:**

```
1. Request arrives at Express
2. JSON parser middleware processes body
3. Request logger logs the request
4. Route handler (auth.routes.ts) captures request
5. Controller (auth.controller.ts) validates and processes
6. Token utility generates JWT
7. Response sent to client
8. Request logger logs response
```

## Working with Routes

### Route Definition Example

```typescript
// src/routes/example.routes.ts
import express, { Router } from 'express';
import { exampleController } from '../controllers/example.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Public route
router.get('/public', exampleController.getPublic);

// Protected route
router.post('/protected', authMiddleware, exampleController.postProtected);

export default router;
```

### Using Routes in App

```typescript
// In app.ts
import exampleRoutes from './routes/example.routes';
app.use('/api/example', exampleRoutes);
```

### Parameter Types

```typescript
// Path parameters
router.get('/:id', handler);

// Query parameters
// ?page=1&limit=10 accessed via req.query.page

// Body parameters
router.post('/', handler);
// Accessed via req.body
```

## Authentication System

### Protected Route Setup

```typescript
import { authMiddleware } from '../middleware/auth.middleware';

// Apply middleware to protect route
router.get('/protected', authMiddleware, (req, res) => {
  // req.user contains authenticated user info
  const userId = req.user?.userId;
});
```

### JWT Token Handling

```typescript
// Token generation (in token.ts)
const token = jwt.sign(
  { userId: user.id },
  process.env.JWT_SECRET || 'default-secret',
  { expiresIn: '24h' }
);

// Token verification (in auth.middleware.ts)
const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
```

## Adding Features

### Adding a New Route

1. **Create a new route file** in `src/routes/`:

```typescript
// src/routes/new-feature.routes.ts
import { Router } from 'express';
import { newFeatureController } from '../controllers/new-feature.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authMiddleware, newFeatureController.getAll);
router.post('/', authMiddleware, newFeatureController.create);

export default router;
```

2. **Create a controller** in `src/controllers/`:

```typescript
// src/controllers/new-feature.controller.ts
export const newFeatureController = {
  async getAll(req, res) {
    try {
      // Implementation
      res.json({ data: [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async create(req, res) {
    try {
      // Implementation
      res.status(201).json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};
```

3. **Mount the route** in `app.ts`:

```typescript
import newFeatureRoutes from './routes/new-feature.routes';
app.use('/api/new-feature', newFeatureRoutes);
```

4. **Add TypeScript types** in `src/types/` if needed

### Adding Middleware

```typescript
// src/middleware/custom.middleware.ts
import { Request, Response, NextFunction } from 'express';

export const customMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Do something
  next(); // Call next to continue
};
```

When to use globally (in app.ts):
```typescript
app.use(customMiddleware);
```

When to use for specific routes:
```typescript
router.get('/path', customMiddleware, handler);
```

## Testing

### Manual Testing with cURL

```bash
# Register
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'

# Login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'

# Protected endpoint
curl -X GET http://localhost:4000/databases \
  -H "Authorization: Bearer <token>"
```

### Testing with Postman/Insomnia

1. Use the API.md as reference
2. Create requests with proper headers
3. Test with and without authentication
4. Verify response codes and formats

### Unit Testing Setup

To add unit tests, install testing framework:

```bash
npm install --save-dev jest @types/jest ts-jest
```

Create `jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
};
```

Example test:

```typescript
// src/utils/__tests__/token.test.ts
import { verifyToken, generateToken } from '../token';

describe('Token Utils', () => {
  test('should generate and verify token', () => {
    const token = generateToken('user123');
    const decoded = verifyToken(token);
    expect(decoded.userId).toBe('user123');
  });
});
```

Run tests:

```bash
npm test
```

## Debugging

### VS Code Debugging

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/src/server.ts",
      "preLaunchTask": "tsc: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

### Console Logging

```typescript
console.log('Debug:', variable);
// With colors (optional chalk library)
import chalk from 'chalk';
console.log(chalk.blue('Info:'), message);
```

### Environment Variables for Debugging

```bash
# Enable debug logging
DEBUG=* npm run dev

# Show all network requests
npm run dev 2>&1 | tee debug.log
```

## Code Style

### TypeScript Conventions

```typescript
// Use interfaces for objects
interface User {
  id: string;
  username: string;
  email: string;
}

// Use async/await
async function getUser(id: string): Promise<User> {
  return await database.users.findById(id);
}

// Use arrow functions
const handler = (req, res) => { };

// Proper error handling
try {
  // code
} catch (error) {
  console.error('Error:', error);
  res.status(500).json({ error: 'Server error' });
}
```

### Naming Conventions

- **Variables/Functions**: camelCase
  ```typescript
  const userData = {};
  function getUserData() {}
  ```

- **Classes/Interfaces**: PascalCase
  ```typescript
  class UserController {}
  interface UserData {}
  ```

- **Constants**: UPPER_SNAKE_CASE (for true constants)
  ```typescript
  const MAX_RETRY_ATTEMPTS = 3;
  ```

- **File Names**:
  - Controllers: `name.controller.ts`
  - Routes: `name.routes.ts`
  - Middleware: `name.middleware.ts`
  - Types/Interfaces: `name.ts` in types folder

### Code Quality

```typescript
// Bad
function handle(r, b){ return {ok:true}; }

// Good
function handleRequest(req: Request, res: Response): void {
  try {
    const result = processRequest(req);
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ error: 'Processing failed' });
  }
}
```

### ESLint Configuration

The project includes ESLint configuration. Check for issues:

```bash
npm run lint
```

## Performance Considerations

### Async Operations

Always use async/await for database operations:

```typescript
// Correct
const data = await database.query();

// Avoid blocking operations
// NO: synchronous file reads, database calls without await
```

### Memory Management

- Avoid keeping large objects in memory
- Use streaming for large file operations
- Clear caches periodically

### Database Queries

- Index frequently queried fields
- Use appropriate query filters
- Limit result sets with pagination

## Contributing

1. Create a feature branch
2. Implement changes following code style
3. Test thoroughly
4. Write/update documentation
5. Submit pull request

---

For API documentation, see [API.md](./API.md)
For setup guide, see [SETUP.md](./SETUP.md)
