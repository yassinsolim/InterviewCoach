const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let apiKey = process.env.GEMINI_API_KEY || "";

const API_ADMIN_KEY = process.env.API_ADMIN_KEY || "";

function requireAdminKey(req, res, next) {
  if (!API_ADMIN_KEY) {
    return res.status(503).json({ error: "Server misconfigured: API_ADMIN_KEY not set" });
  }
  const provided = req.headers["x-admin-key"] || (req.body && req.body.adminKey);
  if (!provided || provided !== API_ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
let activeModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
let langchainModulesPromise = null;

const knowledgeBase = require("./data/knowledge_base.json");

async function getLangchainModules() {
  if (!langchainModulesPromise) {
    langchainModulesPromise = Promise.all([
      import("@langchain/google-genai"),
      import("@langchain/core/messages"),
    ]).then(([genai, messages]) => ({
      ChatGoogleGenerativeAI: genai.ChatGoogleGenerativeAI,
      HumanMessage: messages.HumanMessage,
      SystemMessage: messages.SystemMessage,
      AIMessage: messages.AIMessage,
    }));
  }
  return langchainModulesPromise;
}

function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function retrieveContext({ jobDescription, focusAreas, mode, targetRole }) {
  const keywords = new Set(
    tokenize([jobDescription, focusAreas.join(" "), targetRole].join(" "))
  );

  const filtered = knowledgeBase.filter((entry) => {
    if (!entry.modes || entry.modes.length === 0) return true;
    return entry.modes.includes(mode) || entry.modes.includes("both");
  });

  const scored = filtered
    .map((entry) => {
      const score = (entry.keywords || []).reduce((acc, word) => {
        return acc + (keywords.has(word.toLowerCase()) ? 1 : 0);
      }, 0);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.filter((item) => item.score > 0).slice(0, 4);
  if (top.length > 0) return top.map((item) => item.entry);

  return filtered.slice(0, 2);
}

function buildSystemPrompt({
  jobDescription,
  resume,
  mode,
  experienceLevel,
  focusAreas,
  targetRole,
  questionsRemaining,
  retrieved,
}) {
  const focusLine = focusAreas.length
    ? `Focus areas: ${focusAreas.join(", ")}.`
    : "";
  const roleLine = targetRole ? `Target role: ${targetRole}.` : "";
  const remainingLine =
    typeof questionsRemaining === "number"
      ? `Questions remaining in this session: ${questionsRemaining}.`
      : "";

  const reference = retrieved.length
    ? `Reference snippets (use if helpful):\n${retrieved
        .map((item) => `- ${item.snippet}`)
        .join("\n")}`
    : "";

  return [
    "You are an AI interview coach and interviewer.",
    "Ask one clear question at a time and wait for the candidate response.",
    "When the user answers, give brief, constructive feedback and ask the next question unless the session is ending.",
    "Keep tone supportive, specific, and tailored to the job context.",
    "Behavioral mode uses STAR-style prompts and evaluation.",
    "Technical mode focuses on problem solving, tradeoffs, and correctness.",
    "If a resume is provided, weave in questions about specific roles, projects, or achievements.",
    "If questions remaining is 0, provide a concise wrap-up and do not ask another question.",
    `Interview mode: ${mode}.`,
    experienceLevel ? `Experience level: ${experienceLevel}.` : "",
    roleLine,
    focusLine,
    remainingLine,
    jobDescription ? `Job description:\n${jobDescription}` : "",
    resume ? `Resume:\n${resume}` : "",
    reference,
  ]
    .filter(Boolean)
    .join("\n");
}

function clampText(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + "...";
}

async function callGemini({ apiKey: key, systemPrompt, contents }) {
  const { ChatGoogleGenerativeAI, HumanMessage, SystemMessage, AIMessage } =
    await getLangchainModules();

  const modelCandidates = [
    activeModel,
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
  ].filter(Boolean);

  const historyMessages = contents
    .map((message) => {
      const text = (message?.parts || [])
        .map((part) => part.text || "")
        .join("");
      if (!text) return null;
      if (message.role === "model" || message.role === "assistant") {
        return new AIMessage(text);
      }
      return new HumanMessage(text);
    })
    .filter(Boolean);

  const messages = [new SystemMessage(systemPrompt), ...historyMessages];
  let lastError = null;

  for (const model of modelCandidates) {
    const llm = new ChatGoogleGenerativeAI({
      apiKey: key,
      model,
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 800,
    });

    try {
      const response = await llm.invoke(messages);
      activeModel = model;
      const content = Array.isArray(response.content)
        ? response.content.map((part) => part?.text || "").join("")
        : response.content;
      return String(content || "").trim();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      if (
        message.includes("404") ||
        message.includes("NOT_FOUND") ||
        message.toLowerCase().includes("not found")
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Gemini API error: model not available.");
}

app.get("/api/status", (req, res) => {
  res.json({
    hasKey: Boolean(apiKey),
    model: activeModel,
  });
});

app.post("/api/key", requireAdminKey, (req, res) => {
  const submitted = String(req.body?.apiKey || "").trim();
  if (!submitted) {
    return res.status(400).json({ error: "API key is required." });
  }
  apiKey = submitted;
  return res.json({ ok: true });
});

app.delete("/api/key", requireAdminKey, (req, res) => {
  apiKey = "";
  res.json({ ok: true });
});

app.post("/api/interview", async (req, res) => {
  if (!apiKey) {
    return res.status(400).json({ error: "Gemini API key is not set." });
  }

  const {
    jobDescription,
    resume,
    mode,
    focusAreas,
    experienceLevel,
    targetRole,
    questionsRemaining,
    history,
    directive,
  } = req.body || {};

  if (!jobDescription || String(jobDescription).trim().length < 40) {
    return res
      .status(400)
      .json({ error: "Please provide a fuller job description." });
  }

  const normalizedFocus = normalizeList(focusAreas);
  const safeMode = ["behavioral", "technical", "both"].includes(mode)
    ? mode
    : "behavioral";

  const trimmedHistory = Array.isArray(history) ? history.slice(-12) : [];
  const contents = trimmedHistory
    .map((message) => {
      const role = message.role === "assistant" ? "model" : "user";
      const text = clampText(message.content, 2000);
      if (!text) return null;
      return { role, parts: [{ text }] };
    })
    .filter(Boolean);

  if (directive) {
    contents.push({ role: "user", parts: [{ text: clampText(directive, 800) }] });
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Start the session." }] });
  }

  const retrieved = retrieveContext({
    jobDescription: clampText(jobDescription, 3000),
    focusAreas: normalizedFocus,
    mode: safeMode,
    targetRole: String(targetRole || "").trim(),
  });

  const systemPrompt = buildSystemPrompt({
    jobDescription: clampText(jobDescription, 3000),
    resume: clampText(resume, 3000),
    mode: safeMode,
    experienceLevel: String(experienceLevel || "").trim(),
    focusAreas: normalizedFocus,
    targetRole: String(targetRole || "").trim(),
    questionsRemaining:
      typeof questionsRemaining === "number" ? questionsRemaining : undefined,
    retrieved,
  });

  try {
    const text = await callGemini({
      apiKey,
      systemPrompt,
      contents,
    });
    res.json({ text });
  } catch (error) {
    res.status(500).json({ error: error.message || "Gemini request failed." });
  }
});

app.listen(PORT, () => {
  console.log(`InterviewCoach running on http://localhost:${PORT}`);
});
