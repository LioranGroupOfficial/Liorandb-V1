# LioranDB Command-Line Interface (CLI)

The LioranDB CLI provides a set of commands to interact with your LioranDB instance, manage users, and control the server. Below are the available commands and their usage.

## Table of Contents
*   [Getting Started](../getting-started.md)
*   [LioranManager](./LioranManager.md)
*   [LioranConnector](./lioran-connector.md)

## Global Help

To see a list of all available commands, run:

```bash
npx liorandb --help
# or
npx liorandb help
```

## Command-Specific Help

To get detailed help for a specific command, use the `--help` flag with the command name:

```bash
npx liorandb <command> --help
```

## Available Commands

### `serve`

Starts the LioranDB server.

*   **Description**: Starts the LioranDB server. Default = local mode.
*   **Usage**: `npx liorandb serve [--local] [--global]`
*   **Arguments**:
    *   `--local`: Runs DB at `http://localhost:2008` only (default).
    *   `--global`: Starts P2P mode → make device accessible globally via access-key (Coming Soon).

**Examples**:

```bash
npx liorandb serve         # Starts the server in local mode
npx liorandb serve --local # Explicitly starts the server in local mode
npx liorandb serve --global # Attempts to start in global P2P mode (feature under development)
```

### `login`

Log into your LioranDB account.

*   **Description**: Log into your LioranDB account.
*   **Usage**: `npx liorandb login`
*   **Arguments**:
    *   `(no args)`: Opens an interactive login flow.

**Example**:

```bash
npx liorandb login
```

### `logout`

Logs out and clears all credentials.

*   **Description**: Logs out and clears all credentials.
*   **Usage**: `npx liorandb logout`
*   **Arguments**:
    *   `(no args)`: Clears stored API key.

**Example**:

```bash
npx liorandb logout
```

### `manage`

Open the management CLI to manage users and CORS.

*   **Description**: Open the management CLI to manage users and CORS.
*   **Usage**: `npx liorandb manage`
*   **Arguments**:
    *   `(no args)`: Opens an interactive manage flow.
*   **Details**:
    *   **Users**: view, edit, delete, and create new users.
        *   Edit includes username, password, permissions, expiry.
    *   **CORS**: view, add, and delete allowed URLs.

**Example**:

```bash
npx liorandb manage
```