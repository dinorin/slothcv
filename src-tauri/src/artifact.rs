// ─── Artifact-specific: system prompt + tool definitions ─────────────────────
// When forking to a new app type, replace this file.
// The rest of llm.rs (API callers, generate_artifact command) stays the same.

use serde_json::{json, Value};

pub fn system_prompt(language: &str, notes_str: &str, photo_instr: &str) -> String {
    format!(
        r#"You are SlothCV, a Senior Resume Designer & Career Architect.
Respond in {language}.

━━━ 🧠 STRATEGY (TOKEN EFFICIENT) ━━━
1. **ACT & ASK**: Call `render_resume` for the **FIRST DRAFT** only.
2. **SURGICAL EDITS (MANDATORY)**: For all subsequent changes (fixing typos, changing colors, adding a skill), you **MUST** use `edit_artifact`. NEVER call `render_resume` twice unless a complete layout overhaul is requested.
3. **READ FIRST**: Use `read_artifact` only when you need to see the current code structure to perform an `edit_artifact`.
4. **SURE-FIRE ACTIONS**: Always call `update_internal_notes` to sync user data.

━━━ 🎨 DESIGN BIBLE (MODERN UI A4) ━━━
- **Constraints**: Standard A4 (210mm x 297mm). Everything must fit in one page.
- **Visual Style**: **MODERN & MINIMALIST**. Use **Card-based layout** with subtle background colors (e.g., `#f8fafc`) or soft shadows (`box-shadow`) instead of borders.
- **Borders**: **ABSOLUTELY NO BORDERS**. Use spacing and background color blocks to separate sections.
- **Icons**: Use **FontAwesome 6** (`<i class="fa-solid fa-...">`). It's already linked. Use icons for contact info, skills, and section headers.
- **Safe Zone**: Wrapper with **20mm padding**. Use `box-sizing: border-box`.
- **Colors**: Use a refined palette (e.g., Slate-900 for text, Indigo-600 for accents, Slate-50 for cards).
- **Typography**: Modern pairing (Montserrat for titles, Inter for body). Use `letter-spacing` for a premium look.
- **HTML Structure**: Wrap content in a `.page` container. Use `.section` and `.card` classes.

━━━ SETUP ━━━
Always include this in your `<head>`:
`<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">`
`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Montserrat:wght@700&display=swap" rel="stylesheet">`

Current context:
- Notes: {notes_str}
- {photo_instr}"#,
        language = language,
        notes_str = notes_str,
        photo_instr = photo_instr,
    )
}

pub fn tools_openai() -> Value {
    json!([
        { "type": "function", "function": { "name": "web_search", "description": "Search the web for info.", "parameters": { "type": "object", "properties": { "query": { "type": "string", "description": "The search query." } }, "required": ["query"] } } },
        { "type": "function", "function": { "name": "fetch_web_content", "description": "Get webpage text.", "parameters": { "type": "object", "properties": { "url": { "type": "string", "description": "The URL to fetch." } }, "required": ["url"] } } },
        { "type": "function", "function": { "name": "read_artifact", "description": "Read the current HTML code of the resume. Use this to see what to change.", "parameters": { "type": "object", "properties": {}, "required": [] } } },
        { "type": "function", "function": { "name": "edit_artifact", "description": "Apply a surgical search-and-replace edit to the current resume HTML.", "parameters": { "type": "object", "properties": { "search": { "type": "string", "description": "Exact text to find in current HTML." }, "replace": { "type": "string", "description": "Text to replace it with." } }, "required": ["search", "replace"] } } },
        { "type": "function", "function": { "name": "render_resume", "description": "Create/update CV HTML (Full re-render). Use this for major layout changes.", "parameters": { "type": "object", "properties": { "html": { "type": "string", "description": "The complete HTML code for the resume." } }, "required": ["html"] } } },
        { "type": "function", "function": { "name": "suggest_options", "description": "Provide a list of suggested options for the user to click.", "parameters": { "type": "object", "properties": { "options": { "type": "array", "items": {"type": "string"}, "description": "List of short option labels." }, "question": {"type": "string", "description": "A follow-up question for the user."} }, "required": ["options", "question"] } } },
        { "type": "function", "function": { "name": "update_internal_notes", "description": "Update internal memory/notes about the user.", "parameters": { "type": "object", "properties": { "notes": {"type": "string", "description": "Consolidated user preferences and data."} }, "required": ["notes"] } } }
    ])
}

pub fn tools_gemini() -> Value {
    json!([{
        "function_declarations": [
            { "name": "web_search", "description": "Search web.", "parameters": { "type": "OBJECT", "properties": { "query": {"type": "STRING", "description": "Search query"} }, "required": ["query"] } },
            { "name": "fetch_web_content", "description": "Get web text.", "parameters": { "type": "OBJECT", "properties": { "url": {"type": "STRING", "description": "URL to read"} }, "required": ["url"] } },
            { "name": "read_artifact", "description": "Read current resume HTML.", "parameters": { "type": "OBJECT", "properties": {} } },
            { "name": "edit_artifact", "description": "Surgical search-and-replace edit.", "parameters": { "type": "OBJECT", "properties": { "search": {"type": "STRING", "description": "Exact text to find"}, "replace": {"type": "STRING", "description": "New text"} }, "required": ["search", "replace"] } },
            { "name": "render_resume", "description": "Update CV HTML.", "parameters": { "type": "OBJECT", "properties": { "html": {"type": "STRING", "description": "Full HTML code"} }, "required": ["html"] } },
            { "name": "suggest_options", "description": "User options.", "parameters": { "type": "OBJECT", "properties": { "options": { "type": "ARRAY", "items": {"type": "STRING"}, "description": "Option labels" }, "question": {"type": "STRING", "description": "Question to user"} }, "required": ["options", "question"] } },
            { "name": "update_internal_notes", "description": "Update notes.", "parameters": { "type": "OBJECT", "properties": { "notes": {"type": "STRING", "description": "Consolidated data"} }, "required": ["notes"] } }
        ]
    }])
}
