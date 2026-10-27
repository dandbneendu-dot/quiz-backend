const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3001;
const SCORES_FILE = path.join(__dirname, "scores.json");

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      // Allow any localhost origin for development
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // Allow configured production origin
      if (process.env.FRONTEND_ORIGIN && origin === process.env.FRONTEND_ORIGIN) {
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

let writeQueue = Promise.resolve();

async function readScores() {
  try {
    const content = await fs.readFile(SCORES_FILE, "utf8");
    const data = JSON.parse(content);

    if (!Array.isArray(data)) {
      throw new Error("scores.json must contain an array.");
    }

    return data;
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(SCORES_FILE, "[]", "utf8");
      return [];
    }
    throw error;
  }
}

function saveScore(record) {
  const operation = writeQueue.then(async () => {
    const scores = await readScores();
    scores.push(record);

    const tempFile = `${SCORES_FILE}.tmp`;

    await fs.writeFile(
      tempFile,
      JSON.stringify(scores, null, 2),
      "utf8"
    );

    await fs.rename(tempFile, SCORES_FILE);
  });

  writeQueue = operation.catch(() => {});
  return operation;
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

app.get("/api/scores", async (req, res) => {
  try {
    await writeQueue;
    const scores = await readScores();

    const publicScores = scores.map(
      ({ id, name, score, total, createdAt }) => ({
        id,
        name,
        score,
        total,
        createdAt,
      })
    );

    res.json(sortScores(publicScores).slice(0, 100));
  } catch (error) {
    console.error("Read scores error:", error);
    res.status(500).json({ error: "Could not load scores." });
  }
});

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

    const record = {
      id: crypto.randomUUID(),
      name,
      score,
      total: questions.length,
      createdAt: new Date().toISOString(),
    };

    await saveScore(record);

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
