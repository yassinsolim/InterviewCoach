# InterviewCoach

Practice behavioral and technical interviews with a Gemini-powered interviewer tailored to a job description.

## Quickstart

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

Node 18+ is required for the built-in `fetch` API.

You can either:
- Paste the Gemini API key into the in-app modal, or
- Set it in the environment: `GEMINI_API_KEY=... npm start`

Optional: override the default model with `GEMINI_MODEL=gemini-2.0-flash npm start`.

Paste the job description and resume in the setup panel to personalize the interview flow.

## How it works (LangChain, LLM, RAG, memory)

- **LangChain:** The server builds structured chat messages (system + history) and invokes Gemini through LangChain's `ChatGoogleGenerativeAI` client.
- **LLM:** Gemini 2.0 Flash generates interviewer questions and feedback using the job description, resume, and chat history.
- **RAG:** A lightweight local knowledge base (`data/knowledge_base.json`) is searched via keyword matching from the job description and focus areas. Matching snippets are injected into the system prompt to guide the interviewer.
- **Memory:** The last 12 turns plus the job description are sent on each request to keep the interview coherent without excessive token use.

## Tech stack and flow

- **Backend:** Node.js + Express (`server.js`)
- **LLM layer:** LangChain (`@langchain/core`, `@langchain/google-genai`) with Gemini 2.0 Flash
- **Frontend:** Vanilla HTML/CSS/JS (`public/`)
- **Retrieval data:** Local JSON knowledge base (`data/knowledge_base.json`)
- **Persistence:** Browser `localStorage` for drafts/session UI state; API key held in server memory

Flow overview:
- UI collects job description, resume, mode, and answers.
- Client sends inputs + recent history to `POST /api/interview`.
- Server retrieves keyword-matched snippets, builds a system prompt, and sends messages via LangChain.
- Gemini returns the next interviewer response; UI appends it and persists state locally.

## Project layout

- `server.js`: Express server, Gemini calls, and retrieval logic
- `public/`: Frontend UI (HTML, CSS, JS)
- `data/knowledge_base.json`: Prompt snippets for lightweight retrieval

## API

- `GET /api/status`: returns model name and whether a key is set
- `POST /api/key`: save API key for the running session
- `POST /api/interview`: generate the next interviewer response
