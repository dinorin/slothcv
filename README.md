# SlothCV

SlothCV is a powerful AI-driven resume builder desktop application, built with Tauri and React. It allows users to chat with an AI career consultant to generate and refine professional resumes in real-time as high-quality HTML/CSS.

## Key Features

- **Multi-Provider AI Support**: Configure and switch between multiple AI providers (Google Gemini, DeepSeek, OpenAI, Groq, OpenRouter, Ollama, etc.) with saved API keys for each.
- **Smart AI Agent**: A pro-active agent that designs, researches, and refines your resume using specialized tools.
- **Real-time Status Tracking**: Detailed monitoring of agent actions (thinking, tool usage, search progress) in a clean, developer-style status bar.
- **Modern UI Artifacts**: High-end resume designs displayed in a dedicated preview panel with Card-based layouts, modern typography, and FontAwesome icons.
- **Interactive Preview (PDF Style)**: Professional zoom, pan, and "Fit to Width" capabilities with bounding constraints for a seamless review experience.
- **Token-Efficient Design**: Optimized agent loops using surgical search-and-replace edits to minimize API costs and maximize response speed.
- **Native PDF Export**: Crystal-clear vector PDFs using the browser's native print engine.
- **Local-First & Secure**: All data stored locally on your machine. API keys are obfuscated and stored securely.
- **UI Integrity**: Built-in protection against Inspect Element and common dev shortcuts to ensure a focused user experience.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Framer Motion.
- **Backend**: Rust, Tauri v2, Reqwest (Native-TLS).
- **Libraries**: `react-zoom-pan-pinch` (navigation), `lucide-react` & `FontAwesome 6` (icons).
- **Fonts**: Inter, Montserrat, Playfair Display (Google Fonts).

## Project Structure

- `/src`: React frontend source code.
- `/src-tauri`: Rust backend source code and desktop configuration.
- `/public/fonts`: Local webfont files for consistent PDF rendering.

## Development Guide

### Requirements
- Node.js >= 18
- Rust toolchain (cargo, rustc)

### Setup & Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run in development mode:
   ```bash
   npm run tauri:dev
   ```

### Build & Bundle
Generate an executable for your current platform:
```bash
npm run tauri:build
```

## API Configuration
Configure your preferred AI providers in the **Settings** menu. You can save multiple API keys and switch models directly from the chat interface.

---
*Developed by [dinorin](https://github.com/dinorin).*
