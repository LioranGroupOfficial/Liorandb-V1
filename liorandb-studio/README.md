# @liorandb/studio

A powerful CLI tool to instantly scaffold and launch a LioranDB Studio application. Get a professional MongoDB Compass-like interface for managing your LioranDB databases.

## Features

- 🚀 **One-Command Setup** - Create a fully configured studio in seconds
- 🎨 **Professional UI** - MongoDB Compass-like query interface
- 🌓 **Light/Dark Mode** - Built-in theme switching
- 📊 **Real-time Monitoring** - Live metrics and query execution tracking
- 🔍 **Advanced Query Editor** - Monaco editor with syntax highlighting
- 📈 **Rich Results Viewer** - Dual-mode table and JSON visualization
- ⚡ **Production Ready** - Next.js + TypeScript + Tailwind CSS

## Quick Start

### Using npx (Recommended)

Create a studio in the **current directory**:
```bash
npx @liorandb/studio .
```

Create a studio in a **new folder**:
```bash
npx @liorandb/studio my-studio
```

Create a studio with the **default folder name** (`liorandb-studio`):
```bash
npx @liorandb/studio
```

## What Gets Created

The CLI automatically:
1. ✅ Scaffolds a complete Next.js application
2. ✅ Installs all dependencies
3. ✅ Builds the project
4. ✅ Starts the development server at `http://localhost:3000`

## Usage

After the CLI finishes, your studio is ready to use:

```bash
# The studio starts automatically at http://localhost:3000
```

You can also manually control the studio:

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## Project Structure

```
liorandb-studio/
├── app/                    # Next.js app router
│   ├── page.tsx           # Home page
│   ├── dashboard/         # Dashboard page
│   └── login/             # Login page
├── src/
│   ├── components/        # React components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions
│   ├── store/             # Zustand stores
│   └── types/             # TypeScript types
├── public/                # Static assets
└── src-tauri/             # Tauri desktop app support
```

## Key Components

- **QueryListPanel** - Manage multiple queries with CRUD operations
- **EnhancedQueryEditor** - Monaco-based editor with full code intelligence
- **QueryResultsPanel** - View results in table or JSON format
- **TopMenu** - Professional menu bar with file operations
- **RealtimeMonitor** - Real-time database metrics and status
- **ThemeProvider** - Light/dark mode support

## Technologies

- **Next.js 14** - React framework
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Zustand** - State management
- **Monaco Editor** - Code editor
- **Tauri** - Desktop app framework (optional)

## Requirements

- Node.js 16+ 
- npm or yarn

## Support

For issues and feature requests, visit: [LioranDB GitHub](https://github.com/lioran/liorandb)

## License

See LICENSE.md in the root LioranDB repository.
