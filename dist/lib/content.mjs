const EXTENSION_NAMESPACE = "playwright-mcp-bridge";
window.addEventListener("message", async (event) => {
  var _a;
  if (event.source !== window)
    return;
  if (((_a = event.data) == null ? void 0 : _a.namespace) !== EXTENSION_NAMESPACE)
    return;
  const { type, requestId, payload } = event.data;
  try {
    const response = await chrome.runtime.sendMessage({
      type,
      ...payload
    });
    window.postMessage({
      namespace: EXTENSION_NAMESPACE,
      type: "response",
      requestId,
      success: true,
      payload: response
    }, "*");
  } catch (error) {
    window.postMessage({
      namespace: EXTENSION_NAMESPACE,
      type: "response",
      requestId,
      success: false,
      error: error.message || "Unknown error"
    }, "*");
  }
});
window.postMessage({
  namespace: EXTENSION_NAMESPACE,
  type: "ready"
}, "*");
