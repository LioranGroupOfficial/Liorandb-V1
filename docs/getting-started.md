# Getting Started with LioranDB

Welcome to LioranDB! This guide will help you get up and running with LioranDB quickly.

## Table of Contents
*   [CLI Commands](https://github.com/YouthVibe/LioranDB/blob/main/docs/cli.md)
*   [LioranConnector](https://github.com/YouthVibe/LioranDB/blob/main/docs/lioran-connector.md)
*   [LioranManager](https://github.com/YouthVibe/LioranDB/blob/main/docs/LioranManager.md)

## 1. Installation

To use LioranDB, you first need to install it via npm. Open your terminal and run the following command:

```bash
npm i liorandb
```

## 2. Starting the LioranDB Server

LioranDB can be run in a local mode, which is perfect for development and testing.

### Local Mode

To start the LioranDB server locally, which will be accessible at `http://localhost:2008`, use the `serve` command:

```bash
npx liorandb serve
```

Once the server is running, you will see a message indicating that LioranDB is operating locally.

### Global P2P Mode (Coming Soon)

LioranDB is actively developing a global P2P mode. This feature will allow your LioranDB instance to be accessible globally via an access-key, enabling distributed and peer-to-peer database operations. Stay tuned for updates!

```bash
npx liorandb serve --global # This feature is under development
```

## 3. Next Steps

Now that you have LioranDB installed and running, you can explore:

*   [**CLI Commands**](./cli.md): Learn about other command-line tools.
*   [**LioranConnector**](./lioran-connector.md): Understand how to interact with LioranDB programmatically.
*   [**LioranManager**](./LioranManager.md): Manage your LioranDB instance.

*   [**CLI Commands**](./cli.md): Learn about other command-line tools.
*   [**LioranConnector**](./lioran-connector.md): Understand how to interact with LioranDB programmatically.
*   [**LioranManager**](./LioranManager.md): Manage your LioranDB instance.