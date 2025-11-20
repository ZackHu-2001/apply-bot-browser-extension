/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useCallback, useState } from 'react';
import { CopyToClipboard } from './copyToClipboard';
import * as icons from './icons';
import './authToken.css';

export const AuthTokenSection: React.FC<{}> = ({ }) => {
  const [authToken, setAuthToken] = useState<string>(getOrCreateAuthToken);

  const onRegenerateToken = useCallback(() => {
    const newToken = generateAuthToken();
    localStorage.setItem('auth-token', newToken);
    setAuthToken(newToken);
  }, []);

  return (
    <div className='auth-token-section'>
      <div className='auth-token-example-section'>
        <h3 className='auth-token-example-title'>Example MCP server configuration</h3>
        <div className='auth-token-example-content'>
          <div className='auth-token-example-description'>
            Add this configuration to your MCP client (e.g., VS Code) to connect to the Apply Bot MCP extension:
          </div>
          <div className='auth-token-example-config'>
            <code className='auth-token-example-code'>{exampleConfig(authToken)}</code>
            <CopyToClipboard value={exampleConfig(authToken)} />
          </div>
        </div>
      </div>
    </div>
  );
};

function authTokenCode(authToken: string) {
  return `PLAYWRIGHT_MCP_EXTENSION_TOKEN=${authToken}`;
}

function exampleConfig(authToken: string) {
  return `{

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
}`;
}

function generateAuthToken(): string {
  // Generate a cryptographically secure random token
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  // Convert to base64 and make it URL-safe
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/[+/=]/g, match => {
      switch (match) {
        case '+': return '-';
        case '/': return '_';
        case '=': return '';
        default: return match;
      }
    });
}

export const getOrCreateAuthToken = (): string => {
  let token = localStorage.getItem('auth-token');
  if (!token) {
    token = generateAuthToken();
    localStorage.setItem('auth-token', token);
  }
  return token;
}
