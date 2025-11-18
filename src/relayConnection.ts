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

export function debugLog(...args: unknown[]): void {
  const enabled = true;
  if (enabled) {
    // eslint-disable-next-line no-console
    console.log('[Extension]', ...args);
  }
}

type ProtocolCommand = {
  id: number;
  method: string;
  params?: any;
};

type ProtocolResponse = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
};

export class RelayConnection {
  private _debuggee: chrome.debugger.Debuggee;
  private _ws: WebSocket;
  private _eventListener: (source: chrome.debugger.DebuggerSession, method: string, params: any) => void;
  private _detachListener: (source: chrome.debugger.Debuggee, reason: string) => void;
  private _tabCreatedListener: (tab: chrome.tabs.Tab) => void;
  private _tabRemovedListener: (tabId: number) => void;
  private _tabPromise: Promise<void>;
  private _tabPromiseResolve!: () => void;
  private _closed = false;
  private _childTabs = new Set<number>(); // Track child tabs opened from the main tab
  private _tabIdToTargetId = new Map<number, string>(); // Map tab ID to target ID
  private _mainTabTargetId: string | undefined; // Store main tab's targetId for use as openerId

  onclose?: () => void;

  constructor(ws: WebSocket) {
    this._debuggee = { };
    this._tabPromise = new Promise(resolve => this._tabPromiseResolve = resolve);
    this._ws = ws;
    this._ws.onmessage = this._onMessage.bind(this);
    this._ws.onclose = () => this._onClose();
    // Store listeners for cleanup
    this._eventListener = this._onDebuggerEvent.bind(this);
    this._detachListener = this._onDebuggerDetach.bind(this);
    this._tabCreatedListener = this._onTabCreated.bind(this);
    this._tabRemovedListener = this._onTabRemoved.bind(this);
    chrome.debugger.onEvent.addListener(this._eventListener);
    chrome.debugger.onDetach.addListener(this._detachListener);
    chrome.tabs.onCreated.addListener(this._tabCreatedListener);
    chrome.tabs.onRemoved.addListener(this._tabRemovedListener);
  }

  // Either setTabId or close is called after creating the connection.
  setTabId(tabId: number): void {
    this._debuggee = { tabId };
    this._tabPromiseResolve();
    // After setting the main tab, check for any existing child tabs
    void this._checkForExistingChildTabs();
  }

  close(message: string): void {
    this._ws.close(1000, message);
    // ws.onclose is called asynchronously, so we call it here to avoid forwarding
    // CDP events to the closed connection.
    this._onClose();
  }

  private _onClose() {
    if (this._closed)
      return;
    this._closed = true;
    chrome.debugger.onEvent.removeListener(this._eventListener);
    chrome.debugger.onDetach.removeListener(this._detachListener);
    chrome.tabs.onCreated.removeListener(this._tabCreatedListener);
    chrome.tabs.onRemoved.removeListener(this._tabRemovedListener);
    // Detach from all child tabs
    for (const childTabId of this._childTabs) {
      chrome.debugger.detach({ tabId: childTabId }).catch(() => {});
    }
    this._childTabs.clear();
    this._tabIdToTargetId.clear();
    chrome.debugger.detach(this._debuggee).catch(() => {});
    this.onclose?.();
  }

  private _onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: any): void {
    // Forward events from the main tab or any child tabs
    if (source.tabId !== this._debuggee.tabId && !this._childTabs.has(source.tabId!))
      return;
    debugLog('Forwarding CDP event:', method, params);
    
    // Determine the sessionId to use
    let sessionId: string | undefined;
    if (source.tabId === this._debuggee.tabId) {
      // Main tab - use the sessionId from source, or undefined for backward compatibility
      sessionId = source.sessionId;
    } else if (source.tabId && this._childTabs.has(source.tabId)) {
      // Child tab - use the tab-{tabId} format that we used when sending Target.attachedToTarget
      sessionId = `tab-${source.tabId}`;
    }
    
    this._sendMessage({
      method: 'forwardCDPEvent',
      params: {
        sessionId,
        method,
        params,
      },
    });
  }

  private _onDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): void {
    if (source.tabId === this._debuggee.tabId) {
      this.close(`Debugger detached: ${reason}`);
      this._debuggee = { };
      return;
    }
    // Handle child tab detach
    if (source.tabId && this._childTabs.has(source.tabId)) {
      this._childTabs.delete(source.tabId);
      const targetId = this._tabIdToTargetId.get(source.tabId) || `tab-${source.tabId}`;
      this._tabIdToTargetId.delete(source.tabId);
      debugLog(`Child tab ${source.tabId} detached: ${reason}`);
      // Forward Target.detachedFromTarget event
      this._sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: {
            targetId: targetId,
          },
        },
      });
    }
  }

  private _onMessage(event: MessageEvent): void {
    this._onMessageAsync(event).catch(e => debugLog('Error handling message:', e));
  }

  private async _onMessageAsync(event: MessageEvent): Promise<void> {
    let message: ProtocolCommand;
    try {
      message = JSON.parse(event.data);
    } catch (error: any) {
      debugLog('Error parsing message:', error);
      this._sendError(-32700, `Error parsing message: ${error.message}`);
      return;
    }

    debugLog('Received message:', message);

    const response: ProtocolResponse = {
      id: message.id,
    };
    try {
      response.result = await this._handleCommand(message);
    } catch (error: any) {
      debugLog('Error handling command:', error);
      response.error = error.message;
    }
    debugLog('Sending response:', response);
    this._sendMessage(response);
  }

  private async _handleCommand(message: ProtocolCommand): Promise<any> {
    if (message.method === 'attachToTab') {
      await this._tabPromise;
      debugLog('Attaching debugger to tab:', this._debuggee);
      await chrome.debugger.attach(this._debuggee, '1.3');
      const result: any = await chrome.debugger.sendCommand(this._debuggee, 'Target.getTargetInfo');
      const targetInfo = result?.targetInfo;
      // Store main tab's targetId for use as openerId in child tabs
      if (targetInfo?.targetId) {
        this._mainTabTargetId = targetInfo.targetId;
        this._tabIdToTargetId.set(this._debuggee.tabId!, targetInfo.targetId);
      }
      return {
        targetInfo: targetInfo,
      };
    }
    if (!this._debuggee.tabId)
      throw new Error('No tab is connected. Please go to the Playwright MCP extension and select the tab you want to connect to.');
    if (message.method === 'forwardCDPCommand') {
      const { sessionId, method, params } = message.params;
      debugLog('CDP command:', method, params);
      
      // Special handling for Target.detachFromTarget
      // In extension mode, we need to detach from the child tab directly
      if (method === 'Target.detachFromTarget') {
        const { sessionId: targetSessionId } = params || {};
        // If the sessionId is for a child tab (tab-{tabId} format), detach from that tab
        if (targetSessionId && targetSessionId.startsWith('tab-')) {
          const childTabId = parseInt(targetSessionId.substring(4), 10);
          if (this._childTabs.has(childTabId)) {
            // Detach from the child tab directly
            await chrome.debugger.detach({ tabId: childTabId });
            this._childTabs.delete(childTabId);
            const targetId = this._tabIdToTargetId.get(childTabId);
            this._tabIdToTargetId.delete(childTabId);
            debugLog(`Detached from child tab: ${childTabId}`);
            // Return success (Chrome's detach doesn't return a value)
            return {};
          }
        }
        // For main tab or unknown sessions, try to detach from main tab
        // Note: This might not work for child tabs, but we try anyway
        const debuggerSession: chrome.debugger.DebuggerSession = {
          ...this._debuggee,
        };
        return await chrome.debugger.sendCommand(debuggerSession, method, params);
      }
      
      // Check if sessionId corresponds to a child tab
      let debuggerSession: chrome.debugger.DebuggerSession;
      if (sessionId && sessionId.startsWith('tab-')) {
        const childTabId = parseInt(sessionId.substring(4), 10);
        if (this._childTabs.has(childTabId)) {
          // For child tabs, only use tabId - Chrome will use the default session
          // Don't pass sessionId as it's not recognized by Chrome's debugger API
          debuggerSession = {
            tabId: childTabId,
          };
        } else {
          // Fallback to main tab if child tab not found
          debuggerSession = {
            ...this._debuggee,
            sessionId,
          };
        }
      } else if (sessionId) {
        // IMPORTANT: Chrome Extension API does not support sessionIds for iframes/workers
        // that are auto-attached via Target.setAutoAttach. These sessionIds are generated
        // by Chrome but cannot be used with chrome.debugger.sendCommand().
        // We need to send the command without sessionId (to the main frame) or skip it.
        debuggerSession = {
          ...this._debuggee,
          // Don't pass the sessionId - Chrome extension API doesn't support it
        };
        debugLog(`Warning: Ignoring unsupported sessionId ${sessionId} for command ${method}`);
      } else {
        // Main tab session (no sessionId)
        debuggerSession = {
          ...this._debuggee,
        };
      }

      // Forward CDP command to chrome.debugger
      return await chrome.debugger.sendCommand(
          debuggerSession,
          method,
          params
      );
    }
  }

  private _sendError(code: number, message: string): void {
    this._sendMessage({
      error: {
        code,
        message,
      },
    });
  }

  private _sendMessage(message: any): void {
    if (this._ws.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(message));
  }

  private _onTabCreated(tab: chrome.tabs.Tab): void {
    // Check if this tab was opened from the main connected tab
    if (!this._debuggee.tabId || !tab.openerTabId || tab.openerTabId !== this._debuggee.tabId || !tab.id) {
      return;
    }
    debugLog('New tab opened from current tab:', tab.id, tab.url);
    // Wait a bit for the tab to be fully initialized, then attach
    // We use a small delay to ensure the tab is ready for debugger attachment
    setTimeout(() => {
      void this._attachToNewTab(tab.id!);
    }, 200);
  }

  private _onTabRemoved(tabId: number): void {
    if (this._childTabs.has(tabId)) {
      this._childTabs.delete(tabId);
      const targetId = this._tabIdToTargetId.get(tabId) || `tab-${tabId}`;
      this._tabIdToTargetId.delete(tabId);
      debugLog(`Child tab ${tabId} removed`);
      // Forward Target.detachedFromTarget event
      this._sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.detachedFromTarget',
          params: {
            targetId: targetId,
          },
        },
      });
    }
  }

  private async _checkForExistingChildTabs(): Promise<void> {
    if (!this._debuggee.tabId)
      return;
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.openerTabId === this._debuggee.tabId) {
          debugLog('Found existing child tab:', tab.id);
          await this._attachToNewTab(tab.id);
        }
      }
    } catch (e) {
      debugLog('Error checking for existing child tabs:', e);
    }
  }

  private async _attachToNewTab(tabId: number): Promise<void> {
    if (this._closed || this._childTabs.has(tabId))
      return;
    
    try {
      const newDebuggee = { tabId };
      await chrome.debugger.attach(newDebuggee, '1.3');
      this._childTabs.add(tabId);
      
      // Get target info
      const targetInfoResult: any = await chrome.debugger.sendCommand(newDebuggee, 'Target.getTargetInfo');
      const targetInfo = targetInfoResult?.targetInfo;
      
      if (!targetInfo) {
        debugLog('Failed to get target info for new tab:', tabId);
        return;
      }

      // Get tab info for URL
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !this._debuggee.tabId) {
        debugLog('Tab not found or debuggee not set:', tabId);
        return;
      }
      const sessionId = `tab-${tabId}`;
      const actualTargetId = targetInfo.targetId || `tab-${tabId}`;
      
      // Store the mapping
      this._tabIdToTargetId.set(tabId, actualTargetId);
      
      // Get the main tab's target info to copy browserContextId and get openerId
      const mainTabTargetInfoResult: any = await chrome.debugger.sendCommand(this._debuggee, 'Target.getTargetInfo');
      const mainTabTargetInfo = mainTabTargetInfoResult?.targetInfo;
      
      // Use main tab's targetId as openerId (not tabId)
      const openerId = this._mainTabTargetId || mainTabTargetInfo?.targetId;
      
      // Forward Target.attachedToTarget event to MCP relay
      this._sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: sessionId,
            targetInfo: {
              ...targetInfo,
              targetId: actualTargetId,
              type: 'page',
              url: tab.url || targetInfo.url || '',
              title: tab.title || targetInfo.title || '',
              openerId: openerId, // Use main tab's targetId, not tabId
              // Copy browserContextId from main tab if available, otherwise use the one from targetInfo
              browserContextId: mainTabTargetInfo?.browserContextId || targetInfo.browserContextId,
            },
            waitingForDebugger: false,
          },
        },
      });
      
      debugLog('Successfully attached to new tab and forwarded Target.attachedToTarget event:', tabId, 'targetId:', actualTargetId);
    } catch (e: any) {
      debugLog('Failed to attach to new tab:', tabId, e.message);
      // If attachment fails, the tab might not be ready yet, or it might have been closed
      // We'll try again if Page.windowOpen event is received
    }
  }
}
