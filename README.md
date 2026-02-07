# LioranDB

A lightweight, self-hosted database solution with a professional web-based management interface. LioranDB combines a powerful REST API server with a MongoDB Compass-like Studio for an intuitive database experience.

## Overview

LioranDB consists of two main components:

- **[LioranDB Server](./server/README.md)** - RESTful API server for database operations
- **[LioranDB Studio](./liorandb-studio/README.md)** - Professional web UI for managing databases

Together, they provide a complete database management platform with authentication, real-time monitoring, and advanced query capabilities.

## Key Features

### Server
- 🔐 **JWT Authentication** - Secure user authentication and authorization
- 🗄️ **Database Management** - Create, delete, and manage multiple databases
- 📚 **Collections** - Organize documents into logical collections
- 📄 **Document Operations** - Full CRUD operations with query support
- 💾 **Persistent Storage** - Built-in data persistence
- 🚀 **RESTful API** - Easy-to-use REST endpoints
- 📊 **Statistics** - Database and collection statistics
- 🖥️ **CLI Tool** - Command-line interface for database management
- 🔄 **CORS Support** - Cross-origin resource sharing enabled

### Studio
- 🎨 **Professional UI** - MongoDB Compass-like interface
- 🌓 **Light/Dark Mode** - Built-in theme switching
- 📊 **Real-time Monitoring** - Live metrics and query execution tracking
- 🔍 **Advanced Query Editor** - Monaco editor with syntax highlighting
- 📈 **Rich Results Viewer** - Dual-mode table and JSON visualization
- ⚡ **Production Ready** - Next.js + TypeScript + Tailwind CSS

## Quick Start

### Option 1: Using npx (Recommended)

The easiest way to get started is using the npm packages:

```bash
# Install and start the server globally
npm i -g @liorandb/db
ldb-serve

# In another terminal, create a studio
npx @liorandb/studio my-studio
cd my-studio
npm run dev
```

### Option 2: Local Development

1. **Start the Server**
   ```bash
   cd server
   npm install
   npm run dev
   ```
   Server runs on `http://localhost:4000`

2. **Start the Studio** (in another terminal)
   ```bash
   cd liorandb-studio/template
   npm install
   npm run dev
   ```
   Studio runs on `http://localhost:3000`

## Project Structure

```
liorandb/
├── server/                    # Database server (REST API)
│   ├── src/
│   │   ├── app.ts            # Express app configuration
│   │   ├── server.ts         # Server entry point
│   │   ├── controllers/      # Route controllers
│   │   ├── routes/           # API routes
│   │   ├── middleware/       # Express middleware
│   │   ├── config/           # Configuration files
│   │   ├── types/            # TypeScript types
│   │   ├── utils/            # Utility functions
│   │   └── cli/              # CLI tool
│   ├── API.md                # API documentation
│   ├── DEVELOPMENT.md        # Development guide
│   └── package.json
│
├── liorandb-studio/           # Studio CLI and template
│   ├── bin/
│   │   └── index.js          # CLI entry point
│   ├── template/             # Next.js template
│   │   ├── src/
│   │   │   ├── app/          # Page components
│   │   │   ├── components/   # React components
│   │   │   ├── hooks/        # Custom hooks
│   │   │   ├── lib/          # Utilities
│   │   │   ├── store/        # State management
│   │   │   └── types/        # TypeScript types
│   │   └── package.json
│   └── package.json
│
├── test/                      # Test suite
├── dtest/                     # Database tests
├── stest/                     # Studio tests
└── logs/                      # Application logs
```

## Documentation

- **[Server README](./server/README.md)** - Server setup and usage
- **[Server API Documentation](./server/API.md)** - Complete API reference
- **[Server Development Guide](./server/DEVELOPMENT.md)** - Server development instructions
- **[Server Setup Guide](./server/SETUP.md)** - Detailed setup instructions
- **[Studio README](./liorandb-studio/README.md)** - Studio CLI and features

## Technology Stack

### Server
- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **TypeScript** - Type safety
- **JWT** - Authentication

### Studio
- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **Monaco Editor** - Code editor
- **Tauri** - Desktop support (optional)

## Getting Help

1. Check the [API Documentation](./server/API.md) for endpoint details
2. Review the [Development Guide](./server/DEVELOPMENT.md) for development instructions
3. See [Setup Guide](./server/SETUP.md) for detailed configuration

## License

See [LICENSE.md](./LICENSE.md) for license information.

---

**Get started now:** `npm i -g @liorandb/db && ldb-serve`
