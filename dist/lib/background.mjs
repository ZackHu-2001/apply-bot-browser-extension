var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
function debugLog(...args) {
  {
    console.log("[Extension]", ...args);
  }
}
class RelayConnection {
  constructor(ws) {
    __publicField(this, "_debuggee");
    __publicField(this, "_ws");
    __publicField(this, "_eventListener");
    __publicField(this, "_detachListener");
    __publicField(this, "_tabCreatedListener");
    __publicField(this, "_tabRemovedListener");
    __publicField(this, "_tabPromise");
    __publicField(this, "_tabPromiseResolve");
    __publicField(this, "_closed", false);
    __publicField(this, "_childTabs", /* @__PURE__ */ new Set());
    // Track child tabs opened from the main tab
    __publicField(this, "_tabIdToTargetId", /* @__PURE__ */ new Map());
    // Map tab ID to target ID
    __publicField(this, "_mainTabTargetId");
    // Store main tab's targetId for use as openerId
    __publicField(this, "onclose");
    this._debuggee = {};
    this._tabPromise = new Promise((resolve) => this._tabPromiseResolve = resolve);
    this._ws = ws;
    this._ws.onmessage = this._onMessage.bind(this);
    this._ws.onclose = () => this._onClose();
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
  setTabId(tabId) {
    this._debuggee = { tabId };
    this._tabPromiseResolve();
    void this._checkForExistingChildTabs();
  }
  close(message) {
    this._ws.close(1e3, message);
    this._onClose();
  }
  _onClose() {
    var _a;
    if (this._closed)
      return;
    this._closed = true;
    chrome.debugger.onEvent.removeListener(this._eventListener);
    chrome.debugger.onDetach.removeListener(this._detachListener);
    chrome.tabs.onCreated.removeListener(this._tabCreatedListener);
    chrome.tabs.onRemoved.removeListener(this._tabRemovedListener);
    for (const childTabId of this._childTabs) {
      chrome.debugger.detach({ tabId: childTabId }).catch(() => {
      });
    }
    this._childTabs.clear();
    this._tabIdToTargetId.clear();
    chrome.debugger.detach(this._debuggee).catch(() => {
    });
    (_a = this.onclose) == null ? void 0 : _a.call(this);
  }
  _onDebuggerEvent(source, method, params) {
    if (source.tabId !== this._debuggee.tabId && !this._childTabs.has(source.tabId))
      return;
    debugLog("Forwarding CDP event:", method, params);
    let sessionId;
    if (source.tabId === this._debuggee.tabId) {
      sessionId = source.sessionId;
    } else if (source.tabId && this._childTabs.has(source.tabId)) {
      sessionId = `tab-${source.tabId}`;
    }
    this._sendMessage({
      method: "forwardCDPEvent",
      params: {
        sessionId,
        method,
        params
      }
    });
  }
  _onDebuggerDetach(source, reason) {
    if (source.tabId === this._debuggee.tabId) {
      this.close(`Debugger detached: ${reason}`);
      this._debuggee = {};
      return;
    }
    if (source.tabId && this._childTabs.has(source.tabId)) {
      this._childTabs.delete(source.tabId);
      const targetId = this._tabIdToTargetId.get(source.tabId) || `tab-${source.tabId}`;
      this._tabIdToTargetId.delete(source.tabId);
      debugLog(`Child tab ${source.tabId} detached: ${reason}`);
      this._sendMessage({
        method: "forwardCDPEvent",
        params: {
          method: "Target.detachedFromTarget",
          params: {
            targetId
          }
        }
      });
    }
  }
  _onMessage(event) {
    this._onMessageAsync(event).catch((e) => debugLog("Error handling message:", e));
  }
  async _onMessageAsync(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      debugLog("Error parsing message:", error);
      this._sendError(-32700, `Error parsing message: ${error.message}`);
      return;
    }
    debugLog("Received message:", message);
    const response = {
      id: message.id
    };
    try {
      response.result = await this._handleCommand(message);
    } catch (error) {
      debugLog("Error handling command:", error);
      response.error = error.message;
    }
    debugLog("Sending response:", response);
    this._sendMessage(response);
  }
  async _handleCommand(message) {
    if (message.method === "attachToTab") {
      await this._tabPromise;
      debugLog("Attaching debugger to tab:", this._debuggee);
      await chrome.debugger.attach(this._debuggee, "1.3");
      const result = await chrome.debugger.sendCommand(this._debuggee, "Target.getTargetInfo");
      const targetInfo = result == null ? void 0 : result.targetInfo;
      if (targetInfo == null ? void 0 : targetInfo.targetId) {
        this._mainTabTargetId = targetInfo.targetId;
        this._tabIdToTargetId.set(this._debuggee.tabId, targetInfo.targetId);
      }
      return {
        targetInfo
      };
    }
    if (!this._debuggee.tabId)
      throw new Error("No tab is connected. Please go to the Playwright MCP extension and select the tab you want to connect to.");
    if (message.method === "forwardCDPCommand") {
      const { sessionId, method, params } = message.params;
      debugLog("CDP command:", method, params);
      if (method === "Target.detachFromTarget") {
        const { sessionId: targetSessionId } = params || {};
        if (targetSessionId && targetSessionId.startsWith("tab-")) {
          const childTabId = parseInt(targetSessionId.substring(4), 10);
          if (this._childTabs.has(childTabId)) {
            await chrome.debugger.detach({ tabId: childTabId });
            this._childTabs.delete(childTabId);
            this._tabIdToTargetId.get(childTabId);
            this._tabIdToTargetId.delete(childTabId);
            debugLog(`Detached from child tab: ${childTabId}`);
            return {};
          }
        }
        const debuggerSession2 = {
          ...this._debuggee
        };
        return await chrome.debugger.sendCommand(debuggerSession2, method, params);
      }
      let debuggerSession;
      if (sessionId && sessionId.startsWith("tab-")) {
        const childTabId = parseInt(sessionId.substring(4), 10);
        if (this._childTabs.has(childTabId)) {
          debuggerSession = {
            tabId: childTabId
          };
        } else {
          debuggerSession = {
            ...this._debuggee,
            sessionId
          };
        }
      } else if (sessionId) {
        debuggerSession = {
          ...this._debuggee
          // Don't pass the sessionId - Chrome extension API doesn't support it
        };
        debugLog(`Warning: Ignoring unsupported sessionId ${sessionId} for command ${method}`);
      } else {
        debuggerSession = {
          ...this._debuggee
        };
      }
      return await chrome.debugger.sendCommand(
        debuggerSession,
        method,
        params
      );
    }
  }
  _sendError(code, message) {
    this._sendMessage({
      error: {
        code,
        message
      }
    });
  }
  _sendMessage(message) {
    if (this._ws.readyState === WebSocket.OPEN)
      this._ws.send(JSON.stringify(message));
  }
  _onTabCreated(tab) {
    if (!this._debuggee.tabId || !tab.openerTabId || tab.openerTabId !== this._debuggee.tabId || !tab.id) {
      return;
    }
    debugLog("New tab opened from current tab:", tab.id, tab.url);
    setTimeout(() => {
      void this._attachToNewTab(tab.id);
    }, 200);
  }
  _onTabRemoved(tabId) {
    if (this._childTabs.has(tabId)) {
      this._childTabs.delete(tabId);
      const targetId = this._tabIdToTargetId.get(tabId) || `tab-${tabId}`;
      this._tabIdToTargetId.delete(tabId);
      debugLog(`Child tab ${tabId} removed`);
      this._sendMessage({
        method: "forwardCDPEvent",
        params: {
          method: "Target.detachedFromTarget",
          params: {
            targetId
          }
        }
      });
    }
  }
  async _checkForExistingChildTabs() {
    if (!this._debuggee.tabId)
      return;
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.openerTabId === this._debuggee.tabId) {
          debugLog("Found existing child tab:", tab.id);
          await this._attachToNewTab(tab.id);
        }
      }
    } catch (e) {
      debugLog("Error checking for existing child tabs:", e);
    }
  }
  async _attachToNewTab(tabId) {
    if (this._closed || this._childTabs.has(tabId))
      return;
    try {
      const newDebuggee = { tabId };
      await chrome.debugger.attach(newDebuggee, "1.3");
      this._childTabs.add(tabId);
      const targetInfoResult = await chrome.debugger.sendCommand(newDebuggee, "Target.getTargetInfo");
      const targetInfo = targetInfoResult == null ? void 0 : targetInfoResult.targetInfo;
      if (!targetInfo) {
        debugLog("Failed to get target info for new tab:", tabId);
        return;
      }
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !this._debuggee.tabId) {
        debugLog("Tab not found or debuggee not set:", tabId);
        return;
      }
      const sessionId = `tab-${tabId}`;
      const actualTargetId = targetInfo.targetId || `tab-${tabId}`;
      this._tabIdToTargetId.set(tabId, actualTargetId);
      const mainTabTargetInfoResult = await chrome.debugger.sendCommand(this._debuggee, "Target.getTargetInfo");
      const mainTabTargetInfo = mainTabTargetInfoResult == null ? void 0 : mainTabTargetInfoResult.targetInfo;
      const openerId = this._mainTabTargetId || (mainTabTargetInfo == null ? void 0 : mainTabTargetInfo.targetId);
      this._sendMessage({
        method: "forwardCDPEvent",
        params: {
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: {
              ...targetInfo,
              targetId: actualTargetId,
              type: "page",
              url: tab.url || targetInfo.url || "",
              title: tab.title || targetInfo.title || "",
              openerId,
              // Use main tab's targetId, not tabId
              // Copy browserContextId from main tab if available, otherwise use the one from targetInfo
              browserContextId: (mainTabTargetInfo == null ? void 0 : mainTabTargetInfo.browserContextId) || targetInfo.browserContextId
            },
            waitingForDebugger: false
          }
        }
      });
      debugLog("Successfully attached to new tab and forwarded Target.attachedToTarget event:", tabId, "targetId:", actualTargetId);
    } catch (e) {
      debugLog("Failed to attach to new tab:", tabId, e.message);
    }
  }
}
class TabShareExtension {
  constructor() {
    __publicField(this, "_activeConnection");
    __publicField(this, "_connectedTabId", null);
    __publicField(this, "_pendingTabSelection", /* @__PURE__ */ new Map());
    chrome.tabs.onRemoved.addListener(this._onTabRemoved.bind(this));
    chrome.tabs.onUpdated.addListener(this._onTabUpdated.bind(this));
    chrome.tabs.onActivated.addListener(this._onTabActivated.bind(this));
    chrome.runtime.onMessage.addListener(this._onMessage.bind(this));
    chrome.runtime.onMessageExternal.addListener(this._onExternalMessage.bind(this));
    chrome.action.onClicked.addListener(this._onActionClicked.bind(this));
  }
  // Promise-based message handling is not supported in Chrome: https://issues.chromium.org/issues/40753031
  _onMessage(message, sender, sendResponse) {
    var _a, _b;
    switch (message.type) {
      case "connectToMCPRelay":
        this._connectToRelay(sender.tab.id, message.mcpRelayUrl).then(
          () => sendResponse({ success: true }),
          (error) => sendResponse({ success: false, error: error.message })
        );
        return true;
      case "getTabs":
        this._getTabs().then(
          (tabs) => {
            var _a2;
            return sendResponse({ success: true, tabs, currentTabId: (_a2 = sender.tab) == null ? void 0 : _a2.id });
          },
          (error) => sendResponse({ success: false, error: error.message })
        );
        return true;
      case "connectToTab":
        const tabId = message.tabId || ((_a = sender.tab) == null ? void 0 : _a.id);
        const windowId = message.windowId || ((_b = sender.tab) == null ? void 0 : _b.windowId);
        this._connectTab(sender.tab.id, tabId, windowId, message.mcpRelayUrl).then(
          () => sendResponse({ success: true }),
          (error) => sendResponse({ success: false, error: error.message })
        );
        return true;
      case "getConnectionStatus":
        sendResponse({
          connected: this._connectedTabId !== null,
          connectedTabId: this._connectedTabId
        });
        return false;
      case "disconnect":
        this._disconnect().then(
          () => sendResponse({ success: true }),
          (error) => sendResponse({ success: false, error: error.message })
        );
        return true;
      case "connectToCurrentTab":
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
          var _a2;
          if (!((_a2 = tabs[0]) == null ? void 0 : _a2.id)) {
            sendResponse({ success: false, error: "No active tab found" });
            return;
          }
          const currentTab = tabs[0];
          this._connectToRelay(-1, message.mcpRelayUrl).then(() => {
            var _a3, _b2;
            const connection = (_a3 = this._pendingTabSelection.get(-1)) == null ? void 0 : _a3.connection;
            if (!connection) {
              sendResponse({ success: false, error: "Failed to establish relay connection" });
              return;
            }
            (_b2 = this._activeConnection) == null ? void 0 : _b2.close("Another connection is requested");
            this._activeConnection = connection;
            this._pendingTabSelection.delete(-1);
            this._activeConnection.setTabId(currentTab.id);
            this._activeConnection.onclose = () => {
              debugLog("MCP connection closed");
              this._activeConnection = void 0;
              void this._setConnectedTabId(null);
            };
            Promise.all([
              this._setConnectedTabId(currentTab.id),
              chrome.tabs.update(currentTab.id, { active: true }),
              chrome.windows.update(currentTab.windowId, { focused: true })
            ]).then(() => {
              debugLog(`Connected to MCP bridge from Dashboard`);
              sendResponse({
                success: true,
                connectedTabId: currentTab.id,
                tabTitle: currentTab.title,
                tabUrl: currentTab.url
              });
            }).catch((error) => {
              sendResponse({ success: false, error: error.message });
            });
          }).catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        }).catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    return false;
  }
  async _connectToRelay(selectorTabId, mcpRelayUrl) {
    try {
      debugLog(`Connecting to relay at ${mcpRelayUrl}`);
      const socket = new WebSocket(mcpRelayUrl);
      await new Promise((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("WebSocket error"));
        setTimeout(() => reject(new Error("Connection timeout")), 5e3);
      });
      const connection = new RelayConnection(socket);
      connection.onclose = () => {
        debugLog("Connection closed");
        this._pendingTabSelection.delete(selectorTabId);
      };
      this._pendingTabSelection.set(selectorTabId, { connection });
      debugLog(`Connected to MCP relay`);
    } catch (error) {
      const message = `Failed to connect to MCP relay: ${error.message}`;
      debugLog(message);
      throw new Error(message);
    }
  }
  async _connectTab(selectorTabId, tabId, windowId, mcpRelayUrl) {
    var _a, _b;
    try {
      debugLog(`Connecting tab ${tabId} to relay at ${mcpRelayUrl}`);
      try {
        (_a = this._activeConnection) == null ? void 0 : _a.close("Another connection is requested");
      } catch (error) {
        debugLog(`Error closing active connection:`, error);
      }
      await this._setConnectedTabId(null);
      this._activeConnection = (_b = this._pendingTabSelection.get(selectorTabId)) == null ? void 0 : _b.connection;
      if (!this._activeConnection)
        throw new Error("No active MCP relay connection");
      this._pendingTabSelection.delete(selectorTabId);
      this._activeConnection.setTabId(tabId);
      this._activeConnection.onclose = () => {
        debugLog("MCP connection closed");
        this._activeConnection = void 0;
        void this._setConnectedTabId(null);
      };
      await Promise.all([
        this._setConnectedTabId(tabId),
        chrome.tabs.update(tabId, { active: true }),
        chrome.windows.update(windowId, { focused: true })
      ]);
      debugLog(`Connected to MCP bridge`);
    } catch (error) {
      await this._setConnectedTabId(null);
      debugLog(`Failed to connect tab ${tabId}:`, error.message);
      throw error;
    }
  }
  async _setConnectedTabId(tabId) {
    const oldTabId = this._connectedTabId;
    this._connectedTabId = tabId;
    if (oldTabId && oldTabId !== tabId)
      await this._updateBadge(oldTabId, { text: "" });
    if (tabId)
      await this._updateBadge(tabId, { text: "✓", color: "#4CAF50", title: "Connected to MCP client" });
  }
  async _updateBadge(tabId, { text, color, title }) {
    try {
      await chrome.action.setBadgeText({ tabId, text });
      await chrome.action.setTitle({ tabId, title: title || "" });
      if (color)
        await chrome.action.setBadgeBackgroundColor({ tabId, color });
    } catch (error) {
    }
  }
  async _onTabRemoved(tabId) {
    var _a, _b;
    const pendingConnection = (_a = this._pendingTabSelection.get(tabId)) == null ? void 0 : _a.connection;
    if (pendingConnection) {
      this._pendingTabSelection.delete(tabId);
      pendingConnection.close("Browser tab closed");
      return;
    }
    if (this._connectedTabId !== tabId)
      return;
    (_b = this._activeConnection) == null ? void 0 : _b.close("Browser tab closed");
    this._activeConnection = void 0;
    this._connectedTabId = null;
  }
  _onTabActivated(activeInfo) {
    for (const [tabId, pending] of this._pendingTabSelection) {
      if (tabId === activeInfo.tabId) {
        if (pending.timerId) {
          clearTimeout(pending.timerId);
          pending.timerId = void 0;
        }
        continue;
      }
      if (!pending.timerId) {
        pending.timerId = setTimeout(() => {
          const existed = this._pendingTabSelection.delete(tabId);
          if (existed) {
            pending.connection.close("Tab has been inactive for 5 seconds");
            chrome.tabs.sendMessage(tabId, { type: "connectionTimeout" });
          }
        }, 5e3);
        return;
      }
    }
  }
  _onTabUpdated(tabId, changeInfo, tab) {
    if (this._connectedTabId === tabId)
      void this._setConnectedTabId(tabId);
  }
  async _getTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => tab.url && !["chrome:", "edge:", "devtools:"].some((scheme) => tab.url.startsWith(scheme)));
  }
  async _onActionClicked() {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("status.html"),
      active: true
    });
  }
  async _disconnect() {
    var _a;
    (_a = this._activeConnection) == null ? void 0 : _a.close("User disconnected");
    this._activeConnection = void 0;
    await this._setConnectedTabId(null);
  }
  // Handle messages from external webpages (e.g., local dashboard)
  _onExternalMessage(message, sender, sendResponse) {
    debugLog("Received external message:", message, "from:", sender.origin);
    if (!sender.origin || !sender.origin.startsWith("http://localhost:") && !sender.origin.startsWith("http://127.0.0.1:")) {
      debugLog("Rejecting message from unauthorized origin:", sender.origin);
      sendResponse({ success: false, error: "Unauthorized origin" });
      return false;
    }
    switch (message.type) {
      case "getExtensionId":
        sendResponse({ success: true, extensionId: chrome.runtime.id });
        return false;
      case "getConnectionStatus":
        sendResponse({
          success: true,
          connected: this._connectedTabId !== null,
          connectedTabId: this._connectedTabId
        });
        return false;
      case "connectToCurrentTab":
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
          var _a;
          if (!((_a = tabs[0]) == null ? void 0 : _a.id)) {
            sendResponse({ success: false, error: "No active tab found" });
            return;
          }
          const currentTab = tabs[0];
          this._connectToRelay(-1, message.mcpRelayUrl).then(() => {
            var _a2, _b;
            const connection = (_a2 = this._pendingTabSelection.get(-1)) == null ? void 0 : _a2.connection;
            if (!connection) {
              sendResponse({ success: false, error: "Failed to establish relay connection" });
              return;
            }
            (_b = this._activeConnection) == null ? void 0 : _b.close("Another connection is requested");
            this._activeConnection = connection;
            this._pendingTabSelection.delete(-1);
            this._activeConnection.setTabId(currentTab.id);
            this._activeConnection.onclose = () => {
              debugLog("MCP connection closed");
              this._activeConnection = void 0;
              void this._setConnectedTabId(null);
            };
            Promise.all([
              this._setConnectedTabId(currentTab.id),
              chrome.tabs.update(currentTab.id, { active: true }),
              chrome.windows.update(currentTab.windowId, { focused: true })
            ]).then(() => {
              debugLog(`Connected to MCP bridge via external message`);
              sendResponse({
                success: true,
                connectedTabId: currentTab.id,
                tabTitle: currentTab.title,
                tabUrl: currentTab.url
              });
            }).catch((error) => {
              sendResponse({ success: false, error: error.message });
            });
          }).catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        }).catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
        return true;
      case "disconnect":
        this._disconnect().then(
          () => sendResponse({ success: true }),
          (error) => sendResponse({ success: false, error: error.message })
        );
        return true;
      default:
        sendResponse({ success: false, error: "Unknown message type" });
        return false;
    }
  }
}
new TabShareExtension();
