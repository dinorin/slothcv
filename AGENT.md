# SlothCV — Agent & MCP Automation Guide

This document covers everything needed to automate SlothCV from Claude Code or any MCP-capable agent using the **Tauri MCP Bridge** plugin.

---

## 1. Setup

### Connect to the running app

```js
// Start a driver session (required before any webview_* call)
mcp: driver_session { action: "start" }
```

The app must already be running (`pnpm tauri dev`). The MCP bridge is only active in **dev builds** (`#[cfg(debug_assertions)]`).

### Check connection

```js
mcp: driver_session { action: "status" }
// → { port: 9223, identifier: "..." }
```

---

## 2. `window.__agent__`

Available **only in dev mode**. Exposes the full app API without UI interaction.

> Always access via `webview_execute_js`. For calls that return values, wrap in an IIFE:
> ```js
> (() => { return window.__agent__.getState(); })()
> ```

### 2.1 Sending messages

```js
// Send text (fires after 50ms debounce, non-blocking)
window.__agent__.send("Build me a resume for John Doe, senior engineer")

// Type into input without sending
window.__agent__.setInput("some text")

// Submit current input
window.__agent__.submit()

// Clear input
window.__agent__.clear()
```

> **⚠ `send()` is fire-and-forget.** It does not await the AI response.
> After calling `send()`, poll `getState().isLoading` to know when the AI is done.

### 2.2 Waiting for the AI to finish

`waitForIdle()` uses a DOM event listener and **cannot be awaited via MCP** (the JS executor times out before the AI responds). Use polling instead:

```js
// Correct pattern — poll getState() in a loop
while (true) {
  const state = (() => window.__agent__.getState())()
  if (!state.isLoading) break
  // sleep ~2s between polls
}
```

### 2.3 Reading state

```js
window.__agent__.getState()
// → {
//     isLoading: boolean,
//     hasResume: boolean,
//     isPreviewOpen: boolean,
//     messageCount: number,
//     currentModel: string,   // e.g. "gemini-2.5-flash"
//     language: "en" | "vi"
//   }

window.__agent__.getMessages()        // all messages
window.__agent__.getMessages(5)       // last 5 messages
// → [{ role: "user" | "ai", content: string }, ...]

window.__agent__.getLastAiMessage()   // last AI reply (string | null)
window.__agent__.getResumeHtml()      // raw HTML string | null
```

### 2.4 Session management

```js
window.__agent__.newChat()            // start a fresh session
window.__agent__.getCurrentSessionId() // active session ID (from localStorage)

await window.__agent__.getSessions()
// → [{ id, title, created_at }, ...]

window.__agent__.switchSession("some-session-id")
```

Session ID is persisted in `localStorage['slothcv_current_session']` — survives HMR reloads.

### 2.5 Photo attachment

The photo is **stored locally only** — it is **never sent to the AI**.

The AI receives only `hasPhoto: true` and writes `__PROFILE_PHOTO__` as a placeholder in the HTML. The frontend replaces that placeholder with the actual image at render time.

```js
// Attach photo from URL (downloaded via Rust/reqwest, no CORS issues)
await window.__agent__.attachPhoto("https://example.com/photo.jpg")

// Remove pending photo
window.__agent__.removePhoto()
```

After attaching, call `send()` with any message (e.g. `"Add my photo to the resume"`).
The photo becomes part of the session and persists across reloads.

### 2.6 UI control

```js
window.__agent__.openPreview()
window.__agent__.closePreview()
window.__agent__.openSettings()
window.__agent__.closeSettings()
window.__agent__.setDarkMode(true)       // or false
window.__agent__.setLanguage("vi")       // or "en"
window.__agent__.exportPdf()             // triggers PDF export
window.__agent__.showToast("Done!", "success")  // "info" | "success" | "error"
```

### 2.7 Event system (listen-only)

Three custom DOM events are dispatched automatically:

| Event | When | `detail` payload |
|---|---|---|
| `slothcv:loading` | AI starts processing | `{}` |
| `slothcv:idle` | AI finishes (or error) | `{ hasResume, messageCount, lastMessage }` |
| `slothcv:resume` | Resume HTML updated | `{ length }` |

```js
// One-shot listener
window.__agent__.waitForEvent("slothcv:idle", 60000)

// Persistent listener
const cb = (e) => console.log(e.detail)
window.__agent__.on("slothcv:resume", cb)
window.__agent__.off("slothcv:resume", cb)
```

> **Same timeout caveat as `waitForIdle`** — `waitForEvent` cannot be awaited via MCP executor. Use polling `getState()` instead.

### 2.8 Debug log

```js
window.__agent__.getLog()
// → [{ event, detail, ts }, ...]   (last 200 entries)

window.__agent__.clearLog()
```

---

## 3. Screenshots

```js
mcp: webview_screenshot {
  filePath: "/path/to/output.png",
  format: "png"    // or "jpeg"
}
```

---

## 4. Typical agent workflow

### Build a resume from scratch

```
1. driver_session { action: "start" }

2. execute_js: window.__agent__.newChat()

3. execute_js: window.__agent__.send("I'm Jane Doe, ...")

4. [screenshot for "generating" state]

5. Poll until idle:
   execute_js: (() => window.__agent__.getState())()
   → repeat until isLoading === false

6. [screenshot — preview auto-opens after first build]

7. execute_js: window.__agent__.getLastAiMessage()
   execute_js: window.__agent__.getResumeHtml()
```

### Edit an existing resume

```
1. (resume already built in session)
2. execute_js: window.__agent__.send("Change accent color to teal, two-column layout")
3. Poll getState() until isLoading === false
4. screenshot
```

### Attach a profile photo

```
1. execute_js: await window.__agent__.attachPhoto("https://...")
   // downloads via Rust, compresses, stores locally
   // NOT sent to AI — AI only knows hasPhoto: true
2. execute_js: window.__agent__.send("Add my photo to the resume")
3. Poll getState() until isLoading === false
```

### Switch between saved sessions

```
1. execute_js: await window.__agent__.getSessions()
   → pick an ID

2. execute_js: window.__agent__.switchSession("abc123")

3. Poll getState() until isLoading === false
   (switchSession replays the last user message to regenerate)
```

---

## 5. Known gotchas

| Issue | Cause | Fix |
|---|---|---|
| `waitForIdle()` / `waitForEvent()` never resolves via MCP | MCP JS executor times out (~30s) before AI finishes | Poll `getState().isLoading` instead |
| `send()` fires while previous is still loading | `handleSend` has an `isLoading` guard | Always check `getState().isLoading === false` before calling `send()` |
| `attachPhoto()` fails with CORS error | `fetch()` from Tauri webview blocked for cross-origin URLs | Already handled — `attachPhoto` routes through the Rust `fetch_image_base64` command |
| Preview panel shows resume cut off on first open | Panel animates from width 0; `onInit` fires before animation completes | Fixed — `onInit` uses `setTimeout(280)` to wait for the open animation |
| HMR reload creates a new chat | `sessionStorage` is cleared by Vite HMR | Fixed — session ID is in `localStorage`, restored on mount |
| `MALFORMED_FUNCTION_CALL` from Gemini when photo attached | Some Gemini models mishandle multimodal + tool-call in same turn | Photo is never sent to AI — this error means the AI tried to call a tool in an unexpected way; retry the message |
