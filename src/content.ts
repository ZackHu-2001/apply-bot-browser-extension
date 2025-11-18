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

// Content script that bridges between the webpage and the extension background

const EXTENSION_NAMESPACE = 'playwright-mcp-bridge';

// Listen for messages from the webpage
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window
  if (event.source !== window)
    return;

  // Check if this is a message for our extension
  if (event.data?.namespace !== EXTENSION_NAMESPACE)
    return;

  const { type, requestId, payload } = event.data;

  try {
    // Forward the message to the background script
    const response = await chrome.runtime.sendMessage({
      type,
      ...payload,
    });

    // Send the response back to the webpage
    window.postMessage({
      namespace: EXTENSION_NAMESPACE,
      type: 'response',
      requestId,
      success: true,
      payload: response,
    }, '*');
  } catch (error: any) {
    // Send error back to the webpage
    window.postMessage({
      namespace: EXTENSION_NAMESPACE,
      type: 'response',
      requestId,
      success: false,
      error: error.message || 'Unknown error',
    }, '*');
  }
});

// Notify the webpage that the extension is ready
window.postMessage({
  namespace: EXTENSION_NAMESPACE,
  type: 'ready',
}, '*');
