
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      if (
        process.env.FRONTEND_ORIGIN &&
        origin === process.env.FRONTEND_ORIGIN
      ) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
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
    options: ["Umbrella", "Birthday cake", "School bag", "Passport"],
    correctIndex: 1,
  },
  {
    id: "q3",
    question: "What do people usually blow out on a birthday cake?",
    options: ["Balloons", "Flowers", "Candles", "Ribbons"],
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
    options: ["A present", "A parking ticket", "A bill", "A timetable"],
    correctIndex: 0,
  },
];

// Check server-side Supabase configuration.
function checkSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are not configured.");
  }
}

// Make authenticated requests to Supabase REST API.
async function supabaseRequest(endpoint, options = {}) {
  checkSupabaseConfig();

  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase error (${response.status}): ${details}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function sortScores(scores) {
  return scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

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

    const rows = await supabaseRequest(`scores?${query.toString()}`);

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
    res.status(500).json({ error: "Could not load scores." });
  }
});

// Validate answers, calculate the score, and save it to Supabase.
app.post("/api/scores", async (req, res) => {
  try {
    const name =
      typeof req.body.name === "string"
        ? req.body.name.trim().replace(/\s+/g, " ")
        : "";

    const answers = req.body.answers;

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

    const questionIds = questions.map((q) => q.id);
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

    const score = questions.reduce(
      (total, question) =>
        total +
        (answers[question.id] === question.correctIndex ? 1 : 0),
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

    res.status(201).json({
      message: "Score saved successfully!",
      result: record,
    });
  } catch (error) {
    console.error("Save score error:", error);
    res.status(500).json({ error: "Could not save your score." });
  }
});

app.listen(PORT, () => {
  console.log(`Birthday Quiz API running at http://localhost:${PORT}`);
});

module.exports = app;
