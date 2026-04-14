import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';
import dotenv from 'dotenv';
import type { Strategy } from './types.ts';

dotenv.config({ path: ['.env.local', '.env'] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'polybot.db');
const ENABLE_STRATEGY_IMPORT = process.env.ENABLE_STRATEGY_IMPORT === 'true';
const ENABLE_STRATEGY_GENERATION = process.env.ENABLE_STRATEGY_GENERATION === 'true';
const ENABLE_ANALYST_CHAT = process.env.ENABLE_ANALYST_CHAT === 'true';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_GENERATION_MODEL = process.env.OPENAI_GENERATION_MODEL || OPENAI_MODEL;
const OPENAI_DEEP_DIVE_MODEL = process.env.OPENAI_DEEP_DIVE_MODEL || OPENAI_MODEL;
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || OPENAI_MODEL;
const OPENAI_GENERATION_REASONING = process.env.OPENAI_GENERATION_REASONING || 'medium';
const OPENAI_DEEP_DIVE_REASONING = process.env.OPENAI_DEEP_DIVE_REASONING || 'medium';
const OPENAI_CHAT_REASONING = process.env.OPENAI_CHAT_REASONING || 'medium';
const DEFAULT_SEED_COUNT = Number(process.env.DEFAULT_SEED_COUNT || 100);

const SYSTEM_INSTRUCTION = `
You are an expert quantitative researcher and algorithmic trader specializing in prediction markets like Polymarket.
Your goal is to devise profitable trading strategies that DO NOT rely on sports knowledge or insider info.
Focus on:
1. Math/Stats based approaches (Arbitrage, Correlation).
2. Sentiment Analysis (News API, Social Volume).
3. Market Microstructure (Liquidity Provision, Spread capture).
4. Blockchain/On-chain data (Whale tracking).
`;

const FALLBACK_STRATEGIES: Strategy[] = [
  {
    id: 'arb-fallback-1',
    title: 'Cross-Market Arbitrage',
    category: 'Arbitrage',
    difficulty: 'Medium',
    profitPotential: 'Steady',
    description: 'Monitor price discrepancies between Polymarket and other prediction markets for the same event and act when the spread clears fees and slippage.',
    implementationHint: 'Requires fast polling, normalized probability math, and execution guards for market depth.'
  },
  {
    id: 'mm-fallback-1',
    title: 'Mean Reversion Market Making',
    category: 'Market Making',
    difficulty: 'High',
    profitPotential: 'Steady',
    description: 'Place resting orders around a fair-value estimate in liquid markets and harvest the spread while avoiding adverse selection.',
    implementationHint: 'Use volatility-aware spreads and cancel aggressively when the market regime changes.'
  },
  {
    id: 'corr-fallback-1',
    title: 'Cross-Asset Correlation Drift',
    category: 'Correlation',
    difficulty: 'Medium',
    profitPotential: 'High',
    description: 'Track prediction market prices against correlated macro or crypto signals and trade temporary dislocations.',
    implementationHint: 'Model rolling correlation and set entry thresholds that account for lag and transaction costs.'
  },
  {
    id: 'sentiment-fallback-1',
    title: 'News Sentiment Momentum',
    category: 'Sentiment',
    difficulty: 'Low',
    profitPotential: 'Volatile',
    description: 'Monitor high-signal news and social feeds, score the directional impulse, and trade short windows where market repricing lags.',
    implementationHint: 'Use source weighting, timestamp normalization, and post-event cool-down windows.'
  }
];

type ChatHistoryEntry = {
  role: 'user' | 'model';
  parts: { text: string }[];
};

type StrategyRow = Strategy & {
  deepDiveAnalysis?: string;
  analysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  isFavorite?: number | boolean;
  createdAt?: number;
};

type StrategyExportPayload = {
  version: 1;
  exportedAt: string;
  strategyCount: number;
  strategies: Array<Strategy & {
    deepDiveAnalysis?: string;
    analysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
    isFavorite?: boolean;
    createdAt?: number;
  }>;
};

type RuntimeConfigPayload = {
  demoMode: boolean;
  features: {
    strategyImport: boolean;
    strategyGeneration: boolean;
    analystChat: boolean;
  };
};

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  return apiKey;
}

function formatStrategyRow(row: StrategyRow) {
  return {
    ...row,
    isFavorite: !!row.isFavorite
  };
}

function getAllStrategiesForExport() {
  const rows = db.prepare('SELECT * FROM strategies ORDER BY createdAt DESC').all() as StrategyRow[];
  return rows.map(formatStrategyRow);
}

function normalizeImportedStrategy(input: Record<string, unknown>, index: number) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const difficulty = typeof input.difficulty === 'string' ? input.difficulty.trim() : '';
  const profitPotential = typeof input.profitPotential === 'string' ? input.profitPotential.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const implementationHint = typeof input.implementationHint === 'string' ? input.implementationHint.trim() : '';
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `import-${Date.now()}-${index}`;
  const deepDiveAnalysis = typeof input.deepDiveAnalysis === 'string' ? input.deepDiveAnalysis : '';
  const analysisStatus = input.analysisStatus === 'pending' || input.analysisStatus === 'analyzing' || input.analysisStatus === 'completed' || input.analysisStatus === 'failed'
    ? input.analysisStatus
    : (deepDiveAnalysis ? 'completed' : 'pending');
  const createdAt = typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : Date.now() + index;

  if (!title || !category || !difficulty || !profitPotential || !description || !implementationHint) {
    throw new Error(`Imported strategy at index ${index} is missing required fields.`);
  }

  return {
    id,
    title,
    category,
    difficulty,
    profitPotential,
    description,
    implementationHint,
    deepDiveAnalysis,
    analysisStatus,
    isFavorite: input.isFavorite ? 1 : 0,
    createdAt
  };
}

async function createChatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  extras: Record<string, unknown> = {},
  model = OPENAI_MODEL,
  reasoningEffort?: string
) {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    ...extras
  };

  if (reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getOpenAiApiKey()}`
        },
        body: JSON.stringify(requestBody)
      });

      const rawText = await response.text();
      let payload: any = null;

      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (!response.ok) {
          throw new Error(rawText || 'OpenAI request failed.');
        }
        throw new Error('OpenAI returned a non-JSON response.');
      }

      if (!response.ok) {
        const message = payload?.error?.message || rawText || 'OpenAI request failed.';
        throw new Error(message);
      }

      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OpenAI request failed.');
      const message = lastError.message.toLowerCase();
      const isRetriable = message.includes('timeout') || message.includes('fetch failed') || message.includes('internal');

      if (attempt === 3 || !isRetriable) {
        throw lastError;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  throw lastError || new Error('OpenAI request failed.');
}

async function createResponseText(
  instructions: string,
  input: string,
  extras: Record<string, unknown> = {},
  model = OPENAI_MODEL,
  reasoningEffort?: string
) {
  const requestBody: Record<string, unknown> = {
    model,
    instructions,
    input,
    ...extras
  };

  if (reasoningEffort) {
    requestBody.reasoning = {
      effort: reasoningEffort,
      summary: 'auto'
    };
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getOpenAiApiKey()}`
        },
        body: JSON.stringify(requestBody)
      });

      const rawText = await response.text();
      let payload: any = null;

      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (!response.ok) {
          throw new Error(rawText || 'OpenAI Responses API request failed.');
        }
        throw new Error('OpenAI Responses API returned a non-JSON response.');
      }

      if (!response.ok) {
        const message = payload?.error?.message || rawText || 'OpenAI Responses API request failed.';
        throw new Error(message);
      }

      const directText = typeof payload?.output_text === 'string' ? payload.output_text.trim() : '';
      if (directText) {
        return directText;
      }

      const outputText = Array.isArray(payload?.output)
        ? payload.output
            .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
            .filter((content: any) => content?.type === 'output_text' && typeof content?.text === 'string')
            .map((content: any) => content.text)
            .join('\n')
            .trim()
        : '';

      if (!outputText) {
        throw new Error('OpenAI returned an empty deep-dive response.');
      }

      return outputText;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OpenAI Responses API request failed.');
      const message = lastError.message.toLowerCase();
      const isRetriable = message.includes('timeout') || message.includes('fetch failed') || message.includes('internal') || message.includes('empty deep-dive response');

      if (attempt === 3 || !isRetriable) {
        throw lastError;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  throw lastError || new Error('OpenAI Responses API request failed.');
}

async function fetchStrategyBatch(prompt: string): Promise<Strategy[]> {
  const payload = await createChatCompletion(
    [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: prompt }
    ],
    {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'strategy_batch',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              strategies: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    category: { type: 'string', enum: ['Arbitrage', 'Sentiment', 'Market Making', 'Correlation', 'Technical', 'Whale Tracking'] },
                    difficulty: { type: 'string', enum: ['Low', 'Medium', 'High'] },
                    profitPotential: { type: 'string', enum: ['Steady', 'High', 'Volatile'] },
                    description: { type: 'string' },
                    implementationHint: { type: 'string' }
                  },
                  required: ['id', 'title', 'category', 'difficulty', 'profitPotential', 'description', 'implementationHint']
                }
              }
            },
            required: ['strategies']
          }
        }
      }
    },
    OPENAI_GENERATION_MODEL,
    OPENAI_GENERATION_REASONING
  );

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    return [];
  }

  const parsed = JSON.parse(content) as { strategies: Strategy[] };
  return parsed.strategies;
}

async function generateStrategiesWithOpenAi(userInstruction?: string, count = 5): Promise<Strategy[]> {
  const safeCount = Math.min(Math.max(Math.floor(count), 1), 50);
  const firstBatchCount = Math.ceil(safeCount / 2);
  const secondBatchCount = Math.floor(safeCount / 2);

  let prompt1 = `Generate ${firstBatchCount} distinct, profitable automated trading strategies for Polymarket. Focus on arbitrage and market microstructure. Return JSON only.`;
  let prompt2 = `Generate ${Math.max(secondBatchCount, 1)} distinct, profitable automated trading strategies for Polymarket. Focus on sentiment analysis, correlation, technical patterns, and whale tracking. Return JSON only.`;

  if (userInstruction && userInstruction.trim() !== '') {
    const constraint = ` The user specifically wants strategies related to: "${userInstruction}". Ensure every strategy strictly follows that focus.`;
    prompt1 += constraint;
    prompt2 += constraint;
  }

  try {
    const [batch1, batch2] = await Promise.all([
      fetchStrategyBatch(prompt1),
      fetchStrategyBatch(prompt2)
    ]);

    const uniqueByTitle = new Map<string, Strategy>();
    [...batch1, ...batch2].forEach((strategy) => {
      if (!uniqueByTitle.has(strategy.title.toLowerCase())) {
        uniqueByTitle.set(strategy.title.toLowerCase(), strategy);
      }
    });

    const strategies = Array.from(uniqueByTitle.values()).slice(0, safeCount);
    return strategies.length > 0 ? strategies : FALLBACK_STRATEGIES;
  } catch (error) {
    console.warn('Strategy generation failed, returning fallback strategies.', error);
    return FALLBACK_STRATEGIES.slice(0, safeCount);
  }
}

async function generateDefaultSeedStrategies(targetCount: number): Promise<Strategy[]> {
  const themedPrompts = [
    `Generate 20 high-quality automated trading strategies for Polymarket focused on arbitrage, cross-venue pricing, and market structure inefficiencies. Avoid filler ideas and avoid sports-specific angles. Return JSON only.`,
    `Generate 20 high-quality automated trading strategies for Polymarket focused on political, macro, and event-driven prediction markets. Prioritize execution details, information edge timing, and measurable signals. Return JSON only.`,
    `Generate 20 high-quality automated trading strategies for Polymarket focused on sentiment, news velocity, and narrative propagation across social and media channels. Avoid generic "use sentiment" ideas and make each one operationally distinct. Return JSON only.`,
    `Generate 20 high-quality automated trading strategies for Polymarket focused on technical structure, volatility, market making, and order book behavior. Make them practical for a real bot builder. Return JSON only.`,
    `Generate 20 high-quality automated trading strategies for Polymarket focused on on-chain data, whale tracking, related market correlations, and basket trading. Avoid duplication and keep each strategy implementation-ready. Return JSON only.`
  ];

  const batches = await Promise.all(
    themedPrompts.map((prompt) => fetchStrategyBatch(prompt))
  );

  const uniqueByTitle = new Map<string, Strategy>();
  batches.flat().forEach((strategy) => {
    const key = strategy.title.toLowerCase();
    if (!uniqueByTitle.has(key)) {
      uniqueByTitle.set(key, strategy);
    }
  });

  return Array.from(uniqueByTitle.values()).slice(0, targetCount);
}

async function generateDeepDiveWithOpenAi(strategy: Strategy): Promise<string> {
  const content = await createResponseText(
    SYSTEM_INSTRUCTION,
    `Provide a detailed but bounded implementation-ready technical research memo for this strategy.

Title: ${strategy.title}
Category: ${strategy.category}
Difficulty: ${strategy.difficulty}
Profit Potential: ${strategy.profitPotential}
Description: ${strategy.description}
Implementation Hint: ${strategy.implementationHint}

Requirements:
- Write for an experienced quantitative engineer building a real system.
- Be specific, operational, and detailed rather than high-level or motivational.
- Use Markdown with clear section headings.
- Keep the writeup substantial but bounded. Target roughly 1,200 to 2,000 words.
- Include practical examples, assumptions, and trade-offs where helpful.
- If the strategy depends on non-Polymarket data, explain how to map that data back to market decisions.

Use exactly this structure:

## Core idea
Explain the edge, why it may exist, and what specific inefficiency is being exploited.

## 1) Technical architecture, APIs, and polling frequency
Describe system components, data flows, storage, normalization, and execution pathways.
Include:
- required APIs and data sources
- what each source is used for
- suggested polling frequency or streaming approach
- entity mapping / market mapping considerations

## 2) Signal design
Define the primary signals, secondary confirmation signals, thresholds, scoring logic, and regime filters.
Explain what distinguishes a strong setup from a weak one.

## 3) Step-by-step bot logic
Provide explicit numbered logic from ingest to signal generation to order placement to exit handling.
Be concrete about decision order and state transitions.

## 4) Data sources and implementation notes
List relevant Polymarket, adjacent market, social, news, on-chain, or computer-vision sources as applicable.
Include implementation details, caveats, and integration notes.

## 5) Failure modes and risk analysis
Cover false positives, stale data, latency risk, liquidity risk, regime change, model drift, adversarial conditions, and operational failure modes.

## 6) Backtesting and validation plan
Explain how to test the idea, what historical proxies to use, what metrics matter, and what would invalidate the strategy.

## 7) Deployment and monitoring
Explain what should be monitored in production, what alerts to set, and when the strategy should automatically stand down.

## Practical assessment
Close with:
- expected strengths
- expected weaknesses
- best market conditions
- worst market conditions
- whether the strategy is more likely to be steady, opportunistic, or fragile

The output should feel like a serious internal research memo, not a short summary.`,
    {
      max_output_tokens: 4000
    },
    OPENAI_DEEP_DIVE_MODEL,
    OPENAI_DEEP_DIVE_REASONING
  );

  return content;
}

async function chatWithResearcher(history: ChatHistoryEntry[], message: string): Promise<string> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SYSTEM_INSTRUCTION }
  ];

  history.forEach((entry) => {
    const text = entry.parts.map((part) => part.text).join('\n').trim();
    if (!text) {
      return;
    }

    messages.push({
      role: entry.role === 'model' ? 'assistant' : 'user',
      content: text
    });
  });

  messages.push({ role: 'user', content: message });

  const payload = await createChatCompletion(messages, {}, OPENAI_CHAT_MODEL, OPENAI_CHAT_REASONING);
  return payload?.choices?.[0]?.message?.content || 'I encountered an error trying to process that request.';
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    profitPotential TEXT NOT NULL,
    description TEXT NOT NULL,
    implementationHint TEXT NOT NULL,
    deepDiveAnalysis TEXT,
    analysisStatus TEXT DEFAULT 'pending',
    isFavorite INTEGER DEFAULT 0,
    createdAt INTEGER NOT NULL
  )
`);

const seedStrategies = async () => {
  const count = db.prepare('SELECT COUNT(*) as count FROM strategies').get() as { count: number };
  if (count.count === 0) {
    console.log(`Seeding database with ${DEFAULT_SEED_COUNT} strategies...`);
    const baseStrategies = JSON.parse(fs.readFileSync(path.join(__dirname, 'strategies_seed.json'), 'utf-8'));

    const insert = db.prepare(`
      INSERT INTO strategies (id, title, category, difficulty, profitPotential, description, implementationHint, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let strategiesToSeed: Strategy[] = [];

    if (process.env.VITE_DEMO_MODE !== 'true' && process.env.OPENAI_API_KEY) {
      try {
        strategiesToSeed = await generateDefaultSeedStrategies(DEFAULT_SEED_COUNT);
      } catch (error) {
        console.warn('OpenAI seed generation failed, falling back to local seed file.', error);
      }
    }

    const uniqueByTitle = new Map<string, Strategy>();
    [...strategiesToSeed, ...baseStrategies].forEach((strategy: Strategy) => {
      const key = strategy.title.toLowerCase();
      if (!uniqueByTitle.has(key)) {
        uniqueByTitle.set(key, strategy);
      }
    });

    const finalStrategies = Array.from(uniqueByTitle.values()).slice(0, DEFAULT_SEED_COUNT);

    finalStrategies.forEach((s: any, i: number) => {
      insert.run(
        `seed-${i}`,
        s.title,
        s.category,
        s.difficulty,
        s.profitPotential,
        s.description,
        s.implementationHint,
        Date.now() - (DEFAULT_SEED_COUNT - i) * 1000 * 60 * 60
      );
    });
    console.log('Seeding complete.');
  }
};

async function startServer() {
  await seedStrategies();
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/strategies', (req, res) => {
    res.json(getAllStrategiesForExport());
  });

  app.get('/api/config', (_req, res) => {
    const payload: RuntimeConfigPayload = {
      demoMode: process.env.VITE_DEMO_MODE === 'true',
      features: {
        strategyImport: ENABLE_STRATEGY_IMPORT,
        strategyGeneration: ENABLE_STRATEGY_GENERATION,
        analystChat: ENABLE_ANALYST_CHAT
      }
    };

    res.json(payload);
  });

  app.get('/api/strategies/export', (req, res) => {
    const strategies = getAllStrategiesForExport();
    const payload: StrategyExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      strategyCount: strategies.length,
      strategies
    };

    const timestamp = payload.exportedAt.replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="polybot-strategies-${timestamp}.json"`);
    res.json(payload);
  });

  app.post('/api/strategies/import', (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'Import disabled in Demo Mode' });
    }

    if (!ENABLE_STRATEGY_IMPORT) {
      return res.status(403).json({ error: 'Import is disabled. Set ENABLE_STRATEGY_IMPORT=true to enable it.' });
    }

    const replaceExisting = req.body?.replaceExisting !== false;
    const payload = req.body?.strategies ? req.body : null;
    const rawStrategies = Array.isArray(payload?.strategies)
      ? payload.strategies
      : (Array.isArray(req.body) ? req.body : null);

    if (!rawStrategies) {
      return res.status(400).json({ error: 'Import payload must contain a strategies array.' });
    }

    try {
      const strategies = rawStrategies.map((item: Record<string, unknown>, index: number) => normalizeImportedStrategy(item, index));
      const insert = db.prepare(`
        INSERT INTO strategies (
          id, title, category, difficulty, profitPotential, description, implementationHint,
          deepDiveAnalysis, analysisStatus, isFavorite, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const clear = db.prepare('DELETE FROM strategies');
      const deleteById = db.prepare('DELETE FROM strategies WHERE id = ?');

      const tx = db.transaction((rows: ReturnType<typeof normalizeImportedStrategy>[]) => {
        if (replaceExisting) {
          clear.run();
        }

        rows.forEach((strategy) => {
          if (!replaceExisting) {
            deleteById.run(strategy.id);
          }

          insert.run(
            strategy.id,
            strategy.title,
            strategy.category,
            strategy.difficulty,
            strategy.profitPotential,
            strategy.description,
            strategy.implementationHint,
            strategy.deepDiveAnalysis,
            strategy.analysisStatus,
            strategy.isFavorite,
            strategy.createdAt
          );
        });
      });

      tx(strategies);

      res.json({
        success: true,
        imported: strategies.length,
        replaceExisting,
        total: db.prepare('SELECT COUNT(*) as count FROM strategies').get() as { count: number }
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Import failed.' });
    }
  });

  app.post('/api/strategies', (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'Creation disabled in Demo Mode' });
    }
    const { id, title, category, difficulty, profitPotential, description, implementationHint } = req.body;
    const insert = db.prepare(`
      INSERT INTO strategies (id, title, category, difficulty, profitPotential, description, implementationHint, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(id, title, category, difficulty, profitPotential, description, implementationHint, Date.now());
    res.status(201).json({ id });
  });

  app.delete('/api/strategies/:id', (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'Deletion disabled in Demo Mode' });
    }

    const { id } = req.params;
    const result = db.prepare('DELETE FROM strategies WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json({ success: true, deleted: 1 });
  });

  app.delete('/api/strategies', (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'Bulk deletion disabled in Demo Mode' });
    }

    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
    if (!prefix) {
      return res.status(400).json({ error: 'prefix query parameter is required' });
    }

    const result = db.prepare('DELETE FROM strategies WHERE id LIKE ?').run(`${prefix}%`);
    res.json({ success: true, deleted: result.changes });
  });

  app.patch('/api/strategies/:id', (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true' && !req.body.deepDiveAnalysis && !req.body.analysisStatus) {
      if ('isFavorite' in req.body) {
        return res.status(403).json({ error: 'Updates disabled in Demo Mode' });
      }
    }
    const { id } = req.params;
    const allowedKeys = new Set(['title', 'category', 'difficulty', 'profitPotential', 'description', 'implementationHint', 'deepDiveAnalysis', 'analysisStatus', 'isFavorite']);
    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedKeys.has(key))
    ) as Record<string, unknown>;

    const keys = Object.keys(updates);
    if (keys.length === 0) return res.status(400).json({ error: 'No updates provided' });

    if ('isFavorite' in updates) {
      updates.isFavorite = updates.isFavorite ? 1 : 0;
    }

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => updates[k]);

    const update = db.prepare(`UPDATE strategies SET ${setClause} WHERE id = ?`);
    const result = update.run(...values, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const updated = db.prepare('SELECT * FROM strategies WHERE id = ?').get(id) as any;
    res.json({
      ...updated,
      isFavorite: !!updated.isFavorite
    });
  });

  app.post('/api/ai/strategies', async (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'AI generation is disabled in Demo Mode.' });
    }

    if (!ENABLE_STRATEGY_GENERATION) {
      return res.status(403).json({ error: 'Strategy generation is disabled. Set ENABLE_STRATEGY_GENERATION=true to enable it.' });
    }

    try {
      const strategies = await generateStrategiesWithOpenAi(req.body?.userInstruction, req.body?.count);
      res.json(strategies);
    } catch (error) {
      console.error('Failed to generate strategies:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate strategies.' });
    }
  });

  app.post('/api/ai/deep-dive', async (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'AI analysis is disabled in Demo Mode.' });
    }

    try {
      const strategy = req.body?.strategy as Strategy;
      const content = await generateDeepDiveWithOpenAi(strategy);
      res.json({ content });
    } catch (error) {
      console.error('Failed to generate deep dive:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate deep dive.' });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    if (process.env.VITE_DEMO_MODE === 'true') {
      return res.status(403).json({ error: 'AI chat is disabled in Demo Mode.' });
    }

    if (!ENABLE_ANALYST_CHAT) {
      return res.status(403).json({ error: 'Analyst Chat is disabled. Set ENABLE_ANALYST_CHAT=true to enable it.' });
    }

    try {
      const history = (req.body?.history || []) as ChatHistoryEntry[];
      const message = req.body?.message;
      const content = await chatWithResearcher(history, message);
      res.json({ content });
    } catch (error) {
      console.error('Failed to answer chat message:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to answer chat message.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
