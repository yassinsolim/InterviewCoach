const jobDescriptionInput = document.getElementById("jobDescription");
const resumeInput = document.getElementById("resume");
const targetRoleInput = document.getElementById("targetRole");
const experienceLevelSelect = document.getElementById("experienceLevel");
const focusAreasInput = document.getElementById("focusAreas");
const questionCountInput = document.getElementById("questionCount");
const startSessionButton = document.getElementById("startSession");
const resetSessionButton = document.getElementById("resetSession");
const sessionStatus = document.getElementById("sessionStatus");
const chatLog = document.getElementById("chatLog");
const userAnswerInput = document.getElementById("userAnswer");
const sendAnswerButton = document.getElementById("sendAnswer");
const endSessionButton = document.getElementById("endSession");
const modelStatus = document.getElementById("modelStatus");

const keyModal = document.getElementById("keyModal");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyButton = document.getElementById("saveKey");
const keyStatus = document.getElementById("keyStatus");

const modeButtons = Array.from(document.querySelectorAll(".toggle"));

const STORAGE_KEY = "interviewCoachState";
const MAX_UI_MESSAGES = 60;

const session = {
  active: false,
  asked: 0,
  maxQuestions: 5,
  mode: "behavioral",
  jobDescription: "",
  resume: "",
  targetRole: "",
  experienceLevel: "Senior",
  focusAreas: [],
  history: [],
};

let busy = false;
let hasKey = false;
let uiMessages = [];

function setBusy(state) {
  busy = state;
  sendAnswerButton.disabled = state || !session.active;
  startSessionButton.disabled = state;
}

function setStatus(message) {
  sessionStatus.textContent = message;
  persistState();
}

function setKeyStatus(message, isError) {
  keyStatus.textContent = message;
  keyStatus.style.color = isError ? "#b3422c" : "";
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function persistState() {
  const payload = {
    draft: {
      jobDescription: jobDescriptionInput.value,
      resume: resumeInput.value,
      answerDraft: userAnswerInput.value,
      targetRole: targetRoleInput.value,
      experienceLevel: experienceLevelSelect.value,
      focusAreas: focusAreasInput.value,
      questionCount: questionCountInput.value,
      mode: session.mode,
    },
    session: {
      active: session.active,
      asked: session.asked,
      maxQuestions: session.maxQuestions,
      mode: session.mode,
      jobDescription: session.jobDescription,
      resume: session.resume,
      targetRole: session.targetRole,
      experienceLevel: session.experienceLevel,
      focusAreas: session.focusAreas,
      history: session.history.slice(-40),
    },
    ui: {
      messages: uiMessages,
      status: sessionStatus.textContent,
    },
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function renderMessage(role, content) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = content;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderMessages(messages) {
  chatLog.innerHTML = "";
  messages.forEach((item) => {
    renderMessage(item.role, item.content);
  });
}

function clearChat() {
  chatLog.innerHTML = "";
  uiMessages = [];
}

function pushUiMessage(role, content) {
  uiMessages.push({ role, content });
  if (uiMessages.length > MAX_UI_MESSAGES) {
    uiMessages = uiMessages.slice(-MAX_UI_MESSAGES);
  }
}

function addMessage(role, content, store = true) {
  renderMessage(role, content);
  pushUiMessage(role, content);

  if (store && (role === "user" || role === "assistant")) {
    session.history.push({ role, content });
  }

  persistState();
}

function normalizeFocusAreas(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateModeButtons(selected) {
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === selected);
  });
}

function restoreState() {
  let rawState = null;
  try {
    rawState = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return false;
  }

  const stored = safeParseJSON(rawState);
  if (!stored) return false;

  const draft = stored.draft || {};
  jobDescriptionInput.value = draft.jobDescription || "";
  resumeInput.value = draft.resume || "";
  userAnswerInput.value = draft.answerDraft || "";
  targetRoleInput.value = draft.targetRole || "";
  focusAreasInput.value = draft.focusAreas || "";

  if (draft.experienceLevel) {
    experienceLevelSelect.value = draft.experienceLevel;
  }
  if (draft.questionCount) {
    questionCountInput.value = draft.questionCount;
  }
  if (draft.mode) {
    session.mode = draft.mode;
  }

  const storedSession = stored.session || {};
  session.active = Boolean(storedSession.active);
  session.asked = Number.isFinite(storedSession.asked) ? storedSession.asked : 0;
  session.maxQuestions = Number.isFinite(storedSession.maxQuestions)
    ? storedSession.maxQuestions
    : Math.max(1, Math.min(10, Number(questionCountInput.value) || 5));
  session.mode = storedSession.mode || session.mode;
  session.jobDescription =
    storedSession.jobDescription || jobDescriptionInput.value.trim();
  session.resume = storedSession.resume || resumeInput.value.trim();
  session.targetRole = storedSession.targetRole || targetRoleInput.value.trim();
  session.experienceLevel =
    storedSession.experienceLevel || experienceLevelSelect.value;
  session.focusAreas = Array.isArray(storedSession.focusAreas)
    ? storedSession.focusAreas
    : normalizeFocusAreas(focusAreasInput.value);
  session.history = Array.isArray(storedSession.history)
    ? storedSession.history
    : [];

  updateModeButtons(session.mode);

  uiMessages = Array.isArray(stored.ui?.messages) ? stored.ui.messages : [];
  if (uiMessages.length > 0) {
    renderMessages(uiMessages);
  } else {
    clearChat();
    renderMessage("system", "Add your job description to begin.");
    pushUiMessage("system", "Add your job description to begin.");
  }

  if (stored.ui?.status) {
    sessionStatus.textContent = stored.ui.status;
  } else if (session.active) {
    if (session.asked >= session.maxQuestions) {
      sessionStatus.textContent = "Last question asked. Answer it for wrap-up.";
    } else if (session.asked > 0) {
      sessionStatus.textContent = `Question ${session.asked} of ${session.maxQuestions}.`;
    } else {
      sessionStatus.textContent = "Session ready. Answer the first question.";
    }
  } else {
    sessionStatus.textContent = "Waiting for setup.";
  }

  setBusy(false);
  persistState();
  return true;
}

async function checkApiStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    modelStatus.textContent = `Model: ${data.model}`;
    hasKey = Boolean(data.hasKey);
    if (!data.hasKey) {
      openKeyModal();
    }
  } catch (error) {
    modelStatus.textContent = "Model: unavailable";
  }
}

function openKeyModal() {
  keyModal.classList.add("open");
  keyModal.setAttribute("aria-hidden", "false");
  apiKeyInput.focus();
}

function closeKeyModal() {
  keyModal.classList.remove("open");
  keyModal.setAttribute("aria-hidden", "true");
  apiKeyInput.value = "";
}

async function saveApiKey() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setKeyStatus("Enter a valid API key.", true);
    return;
  }

  setKeyStatus("Saving key...");
  try {
    const response = await fetch("/api/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to save key.");
    }

    setKeyStatus("Key saved.");
    hasKey = true;
    closeKeyModal();
  } catch (error) {
    setKeyStatus(error.message, true);
  }
}

async function callInterviewApi(directive, questionsRemaining) {
  const response = await fetch("/api/interview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobDescription: session.jobDescription,
      resume: session.resume,
      mode: session.mode,
      focusAreas: session.focusAreas,
      experienceLevel: session.experienceLevel,
      targetRole: session.targetRole,
      questionsRemaining,
      history: session.history,
      directive,
    }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Interview request failed.");
  }

  const data = await response.json();
  return data.text || "";
}

async function askAssistant({ directive, countQuestion }) {
  setBusy(true);
  try {
    const remaining = session.maxQuestions - session.asked;
    const text = await callInterviewApi(directive, remaining);
    if (countQuestion) {
      session.asked += 1;
    }
    addMessage("assistant", text, true);

    if (session.asked >= session.maxQuestions) {
      setStatus("Last question asked. Answer it for wrap-up.");
    } else {
      setStatus(`Question ${session.asked} of ${session.maxQuestions}.`);
    }
  } catch (error) {
    addMessage("system", error.message, false);
    setStatus("Error talking to Gemini.");
  } finally {
    setBusy(false);
  }
}

function resetSession() {
  session.active = false;
  session.asked = 0;
  session.history = [];
  clearChat();
  addMessage("system", "Add your job description to begin.", false);
  setStatus("Waiting for setup.");
  userAnswerInput.value = "";
  setBusy(false);
}

async function startSession() {
  if (!hasKey) {
    setStatus("Add your Gemini API key to start.");
    openKeyModal();
    return;
  }
  const jobDescription = jobDescriptionInput.value.trim();
  if (jobDescription.length < 40) {
    setStatus("Please add a fuller job description.");
    return;
  }

  session.active = true;
  session.asked = 0;
  session.history = [];
  session.jobDescription = jobDescription;
  session.resume = resumeInput.value.trim();
  session.targetRole = targetRoleInput.value.trim();
  session.experienceLevel = experienceLevelSelect.value;
  session.focusAreas = normalizeFocusAreas(focusAreasInput.value);
  session.maxQuestions = Math.max(
    1,
    Math.min(10, Number(questionCountInput.value) || 5)
  );

  clearChat();
  addMessage("system", "Session started. The interviewer is preparing.", false);
  setStatus("Starting session...");

  await askAssistant({
    directive:
      "Start the interview with the first question. Keep it concise and role-specific.",
    countQuestion: true,
  });
}

async function sendAnswer() {
  if (!session.active || busy) return;

  const answer = userAnswerInput.value.trim();
  if (!answer) return;

  addMessage("user", answer, true);
  userAnswerInput.value = "";
  persistState();

  const remaining = session.maxQuestions - session.asked;
  if (remaining <= 0) {
    await askAssistant({
      directive:
        "Provide a concise wrap-up with strengths, risks, and one next step. Do not ask a new question.",
      countQuestion: false,
    });
    return;
  }

  await askAssistant({
    directive:
      "Give brief feedback and ask the next question. Keep it concise.",
    countQuestion: true,
  });
}

function endSession() {
  session.active = false;
  setStatus("Session ended.");
  addMessage("system", "Session ended. You can start a new one.", false);
  setBusy(false);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    session.mode = button.dataset.mode;
    updateModeButtons(session.mode);
    persistState();
  });
});

startSessionButton.addEventListener("click", startSession);
resetSessionButton.addEventListener("click", resetSession);
sendAnswerButton.addEventListener("click", sendAnswer);
endSessionButton.addEventListener("click", endSession);

[jobDescriptionInput, resumeInput, targetRoleInput, focusAreasInput, questionCountInput, userAnswerInput].forEach(
  (input) => {
    input.addEventListener("input", persistState);
  }
);
experienceLevelSelect.addEventListener("change", persistState);

userAnswerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendAnswer();
  }
});

saveKeyButton.addEventListener("click", saveApiKey);

window.addEventListener("load", () => {
  const restored = restoreState();
  if (!restored) {
    updateModeButtons(session.mode);
    resetSession();
  }
  checkApiStatus();

  const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));
  revealItems.forEach((item, index) => {
    setTimeout(() => item.classList.add("is-visible"), 150 * index);
  });
});
