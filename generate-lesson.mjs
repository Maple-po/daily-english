import fs from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-5-mini";
const root = process.cwd();
const lessonsDir = path.join(root, "lessons");

if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY. Add it in GitHub Settings > Secrets and variables > Actions.");
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function lessonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["date", "title", "description", "items"],
    properties: {
      date: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      items: {
        type: "array",
        minItems: 5,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "phrase", "tone", "tags", "cn", "examples", "dialogue"],
          properties: {
            id: { type: "string" },
            phrase: { type: "string" },
            tone: { type: "string" },
            tags: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "string",
                enum: ["daily", "work", "meetings", "friends", "texting", "feedback", "networking", "travel", "food"]
              }
            },
            cn: { type: "string" },
            examples: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string" }
            },
            dialogue: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: { type: "string" }
              }
            }
          }
        }
      }
    }
  };
}

function outputText(response) {
  if (response.output_text) return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function normalizeLesson(lesson, date) {
  lesson.date = date;
  lesson.items = lesson.items.map((item, index) => ({
    ...item,
    id: `${date}-${slug(item.phrase) || `item-${index + 1}`}`,
    tags: [...new Set(item.tags)]
  }));
  return lesson;
}

async function readIndex() {
  try {
    const raw = await fs.readFile(path.join(lessonsDir, "index.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { lessons: [] };
  }
}

async function writeIndex(index) {
  index.lessons = index.lessons.sort((a, b) => b.date.localeCompare(a.date));
  await fs.writeFile(path.join(lessonsDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

async function main() {
  const date = process.env.LESSON_DATE || todayInShanghai();
  const file = `${date}.json`;
  const lessonPath = path.join(lessonsDir, file);

  try {
    await fs.access(lessonPath);
    console.log(`Lesson already exists for ${date}.`);
    return;
  } catch {
    // Continue and create today's lesson.
  }

  await fs.mkdir(lessonsDir, { recursive: true });

  const prompt = `
Create one daily spoken English practice lesson for ${date}.

Audience:
- Strong Chinese-speaking English learner.
- Good academic English, wants current natural spoken English.
- Avoid old-fashioned movie English.
- Avoid default dating/flirting/romance.

Topic mix:
- Business/workplace communication and everyday communication.
- Meetings, feedback, networking, making plans, catching up, reacting naturally, sharing opinions, mild disagreement, small talk, texting, errands, travel, food, mood, and social situations.

Style:
- 5-8 useful expressions.
- Current and natural, but not overly meme-ish.
- Each item must include Chinese explanation, several shadowing examples, mini dialogue, tone/usage note.
- Dialogue lines should be plain lines; the website already positions speakers visually.
- Use concise Chinese explanations.
- Tags should be selected from the enum only.
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "daily_english_lesson",
          strict: true,
          schema: lessonSchema()
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const lesson = normalizeLesson(JSON.parse(outputText(data)), date);
  await fs.writeFile(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`);

  const index = await readIndex();
  index.lessons = index.lessons.filter((entry) => entry.date !== date);
  index.lessons.unshift({ date, file, title: lesson.title });
  await writeIndex(index);

  console.log(`Generated lesson for ${date}: ${lesson.title}`);
}

await main();
