# LioranManager

The `LioranManager` provides an interactive command-line interface for managing your LioranDB instance. It allows you to perform administrative tasks such as user management and Cross-Origin Resource Sharing (CORS) configuration.

## Table of Contents
*   [Getting Started](../getting-started.md)
*   [CLI Commands](./cli.md)
*   [LioranConnector](./lioran-connector.md)

## Accessing the LioranManager

To access the LioranManager, use the `manage` command in your terminal:

```bash
npx liorandb manage
```

Upon running this command, an interactive prompt will guide you through the available management options.

## Key Features

### User Management

The LioranManager allows you to perform comprehensive user management operations:

*   **View Users**: List all existing users in your LioranDB instance.
*   **Edit Users**: Modify user details such as username, password, permissions, and account expiry.
*   **Delete Users**: Remove existing user accounts.
*   **Create New Users**: Add new users to your LioranDB instance.

### CORS Configuration

Manage Cross-Origin Resource Sharing (CORS) settings to control which external domains can access your LioranDB instance:

*   **View Allowed URLs**: See the list of URLs currently permitted to access your database.
*   **Add Allowed URLs**: Grant access to new domains.
*   **Delete Allowed URLs**: Revoke access from specific domains.

## Usage Example

When you run `npx liorandb manage`, you will be presented with a menu similar to this:

```
LioranDB Management CLI

1. Manage Users
2. Manage CORS
3. Exit

Enter your choice: _
```

Follow the on-screen prompts to navigate through the management options and perform the desired administrative tasks.