# apply bot

## Introduction

apply bot is a browser extension that allows you to share browser tabs with applybot MCP server. This extension is based on [Playwright MCP Bridge](https://github.com/microsoft/playwright-mcp) by Microsoft Corporation.

The extension allows you to connect to pages in your existing browser and leverage the state of your default user profile. This means the AI assistant can interact with websites where you're already logged in, using your existing cookies, sessions, and browser state, providing a seamless experience without requiring separate authentication or setup.

## License and Attribution

This project is based on Playwright MCP Bridge, which is:
- Copyright (c) Microsoft Corporation
- Licensed under the Apache License, Version 2.0
- Original source: https://github.com/microsoft/playwright-mcp

This project is also licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for details.

## Prerequisites

- Chrome/Edge/Chromium browser

## Installation Steps

### Download the Extension

Download the latest Chrome extension from GitHub:
- **Download link**: [https://github.com/microsoft/playwright-mcp/releases](https://github.com/ZackHu-2001/apply-bot-extension/releases/tag/release)

### Load Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right corner)
3. Click "Load unpacked" and select the extension directory

### Configure applybot MCP server

Configure applybot MCP server to connect to the browser using the extension by passing the `--extension` option when running the MCP server:

```json

    
{
  "mcpServers": {
    "apply-bot-mcp": {
      "command": "npx",
      "args": [
          "apply-bot-mcp",
          "run-mcp-server",
          "--extension"
      ]
    }
  }
}
```

## Usage

### Browser Tab Selection

When the LLM interacts with the browser for the first time, it will load a page where you can select which browser tab the LLM will connect to. This allows you to control which specific page the AI assistant will interact with during the session.


