# SlothCV

SlothCV is a powerful AI-driven resume builder desktop application, built with Tauri and React. It allows users to chat with an AI career consultant to generate and refine professional resumes in real-time as high-quality HTML/CSS.

## Key Features

- **AI-Driven Resume Generation**: Integrated with major LLMs (Gemini, OpenAI, Anthropic via API, or Local LLMs via Ollama) to consult and design your resume.
- **Claude-style Artifacts**: Resume designs are displayed in a dedicated, sleek preview panel (artifact) that can be opened or closed seamlessly.
- **Interactive Preview**: Full support for zooming and panning the resume design for pixel-perfect inspection.
- **Native PDF Export**: Uses the browser's native print engine to export vector-quality PDFs, ensuring crisp text and full text-selection support.
- **Local-First Storage**: Chat history and resume data are stored locally on your machine using Rust-powered backend (JSON/SQLite).
- **Minimalist UI**: A clean, Linear/Notion-inspired interface featuring Dark Mode and resizable panels.
- **Developer Protection**: Built-in protection against Inspect Element and common dev shortcuts to protect UI integrity.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Framer Motion.
- **Backend**: Rust, Tauri v2.
- **Libraries**: `react-zoom-pan-pinch` (navigation), `lucide-react` (icons).
- **Fonts**: Inter (Self-hosted).

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
Users need to provide an API Key from a supported provider (e.g., Google AI Studio for Gemini) in the **Settings** menu to enable AI features.

---
*Developed by [dinorin](https://github.com/dinorin) and the Sloth Team.*
