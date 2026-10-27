
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// Allowed frontend origins.
const allowedOrigins = [
  "https://quiz-frontend-rho.vercel.app",
  "http://localhost:5173",
];

// CORS configuration — keep this before the API routes.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Also allow a configured frontend URL from Vercel.
      if (
        process.env.FRONTEND_ORIGIN &&
        origin === process.env.FRONTEND_ORIGIN
      ) {
        return callback(null, true);
      }

      return callback(
        new Error(`Not allowed by CORS: ${origin}`)
      );
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "20kb" }));

const questions = [
  {
    id: "q1",
    question: "What is the best way to celebrate a birthday?",
    options: [
      "With cake and friends",
      "By doing homework all day",
      "By going to sleep early",
      "By cleaning the entire house",
    ],
    correctIndex: 0,
  },
  {
    id: "q2",
    question: "Which item is commonly used at birthday parties?",
    options: [
      "Umbrella",
      "Birthday cake",
      "School bag",
      "Passport",
    ],
    correctIndex: 1,
  },
  {
    id: "q3",
    question: "What do people usually blow out on a birthday cake?",
    options: [
      "Balloons",
      "Flowers",
      "Candles",
      "Ribbons",
    ],
    correctIndex: 2,
  },
  {
    id: "q4",
    question: "What do you usually say to someone on their birthday?",
    options: [
      "Good luck with your exam",
      "Happy birthday!",
      "Good morning!",
      "See you next year!",
    ],
    correctIndex: 1,
  },
  {
    id: "q5",
    question: "Which of these is a common birthday gift?",
    options: [
      "A present",
      "A parking ticket",
      "A bill",
      "A timetable",
    ],
    correctIndex: 0,
  },
];

// Check server-side Supabase configuration.
function checkSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase environment variables are not configured."
    );
  }
}

// Make authenticated requests to the Supabase REST API.
// Safely handles empty response bodies.
async function supabaseRequest(endpoint, options = {}) {
  checkSupabaseConfig();

  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");

  const response = await fetch(
    `${baseUrl}/rest/v1/${endpoint}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase error (${response.status}): ${
        responseText || response.statusText
      }`
    );
  }

  // Supabase may return no body with Prefer: return=minimal.
  if (!responseText.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      "Supabase returned a response that was not valid JSON."
    );
  }
}

// Sort by highest score first, then earliest submission.
function sortScores(scores) {
  return scores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (
      new Date(a.createdAt) - new Date(b.createdAt)
    );
  });
}

// Health check.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Return quiz questions without revealing correct answers.
app.get("/api/questions", (req, res) => {
  res.json(
    questions.map(({ id, question, options }) => ({
      id,
      question,
      options,
    }))
  );
});

// Load the shared leaderboard from Supabase.
app.get("/api/scores", async (req, res) => {
  try {
    const query = new URLSearchParams({
      select: "id,name,score,total,created_at",
      order: "score.desc,created_at.asc",
      limit: "100",
    });

    const rows = await supabaseRequest(
      `scores?${query.toString()}`
    );

    // Protect against an unexpected empty/non-array result.
    if (!Array.isArray(rows)) {
      throw new Error(
        "Supabase did not return a score list."
      );
    }

    const publicScores = rows.map(
      ({ id, name, score, total, created_at }) => ({
        id,
        name,
        score,
        total,
        createdAt: created_at,
      })
    );

    res.json(sortScores(publicScores));
  } catch (error) {
    console.error("Read scores error:", error);

    res.status(500).json({
      error: "Could not load scores.",
    });
  }
});

// Validate answers, calculate the score, and save it.
app.post("/api/scores", async (req, res) => {
  try {
    const name =
      typeof req.body?.name === "string"
        ? req.body.name.trim().replace(/\s+/g, " ")
        : "";

    const answers = req.body?.answers;

    if (!name || name.length > 40) {
      return res.status(400).json({
        error: "Enter a name between 1 and 40 characters.",
      });
    }

    if (
      !answers ||
      typeof answers !== "object" ||
      Array.isArray(answers)
    ) {
      return res.status(400).json({
        error: "Invalid answers.",
      });
    }

    const questionIds = questions.map(
      (question) => question.id
    );

    const submittedIds = Object.keys(answers);

    if (
      submittedIds.length !== questionIds.length ||
      !questionIds.every((id) =>
        Object.prototype.hasOwnProperty.call(answers, id)
      )
    ) {
      return res.status(400).json({
        error: "Please answer every question.",
      });
    }

    // Validate each submitted answer.
    for (const question of questions) {
      const answer = answers[question.id];

      if (
        !Number.isInteger(answer) ||
        answer < 0 ||
        answer >= question.options.length
      ) {
        return res.status(400).json({
          error: "One or more answers are invalid.",
        });
      }
    }

    // Calculate the score on the server.
    const score = questions.reduce(
      (total, question) =>
        total +
        (answers[question.id] === question.correctIndex
          ? 1
          : 0),
      0
    );

    const createdAt = new Date().toISOString();

    const record = {
      id: crypto.randomUUID(),
      name,
      score,
      total: questions.length,
      createdAt,
    };

    // Save the score to Supabase.
    await supabaseRequest("scores", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: record.id,
        name: record.name,
        score: record.score,
        total: record.total,
        created_at: record.createdAt,
      }),
    });

    return res.status(201).json({
      message: "Score saved successfully!",
      result: record,
    });
  } catch (error) {
    console.error("Save score error:", error);

    return res.status(500).json({
      error: "Could not save your score.",
    });
  }
});

// Handle CORS errors with a clear response.
app.use((err, req, res, next) => {
  if (err.message?.startsWith("Not allowed by CORS")) {
    return res.status(403).json({
      error: "This origin is not allowed.",
    });
  }

  console.error("Server error:", err);

  return res.status(500).json({
    error: "Internal server error.",
  });
});

// Local development server.
// Vercel can import the Express app as a serverless function.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Birthday Quiz API running at http://localhost:${PORT}`
    );
  });
}

module.exports = app;
