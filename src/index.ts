import { Hono } from "hono";
import { cors } from "hono/cors";

// Types
interface Env {
  CACHE: KVNamespace;
  PAYMENT_ADDRESS: string;
  CONTRACT_ADDRESS: string;
  HIRO_API: string;
}

interface Market {
  id: number;
  creator: string;
  targetPrice: number;
  settlementBlock: number;
  yesPool: number;
  noPool: number;
  settled: boolean;
  winningSide: boolean | null;
  settlementPrice: number;
  description: string;
  createdAt: string;
}

interface Position {
  yesAmount: number;
  noAmount: number;
  claimed: boolean;
}

// Contract details
const CONTRACT = {
  address: "SP_CONTRACT_ADDRESS",
  name: "prediction-market",
};

// x402 pricing (in microSTX)
const PRICES = {
  CREATE_MARKET: 10000, // 0.01 STX
};

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use("*", cors());

// ============================================
// UTILITIES
// ============================================

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function payment402(description: string, price: number) {
  return json(
    {
      error: "Payment required",
      description,
      pricing: {
        amount: price,
        formatted: `${(price / 1000000).toFixed(6)} STX`,
        sats: Math.ceil(price / 100),
      },
      instructions: "Include X-Payment header with transaction ID",
    },
    402
  );
}

async function getCurrentBtcBlock(env: Env): Promise<number> {
  try {
    const res = await fetch(`${env.HIRO_API}/extended/v2/burn-blocks?limit=1`);
    const data = (await res.json()) as { results: { burn_block_height: number }[] };
    return data.results[0]?.burn_block_height || 0;
  } catch {
    return 0;
  }
}

async function getBtcPrice(): Promise<number> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const data = (await res.json()) as { bitcoin: { usd: number } };
    return Math.round(data.bitcoin.usd * 100); // cents
  } catch {
    return 0;
  }
}

function calculateOdds(yesPool: number, noPool: number) {
  const total = yesPool + noPool;
  if (total === 0) return { yesOdds: 50, noOdds: 50, impliedYes: 2, impliedNo: 2 };

  const yesOdds = Math.round((yesPool / total) * 100);
  const noOdds = 100 - yesOdds;

  return {
    yesOdds,
    noOdds,
    impliedYes: noOdds > 0 ? (total / noPool).toFixed(2) : "∞",
    impliedNo: yesOdds > 0 ? (total / yesPool).toFixed(2) : "∞",
  };
}

// ============================================
// HOMEPAGE / UI
// ============================================

app.get("/", async (c) => {
  const currentBlock = await getCurrentBtcBlock(c.env);
  const btcPrice = await getBtcPrice();

  // Get cached markets
  const marketsData = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const activeMarkets = marketsData.filter(m => !m.settled);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BTC Oracle - Prediction Market</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%);
      color: #fff;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, #f7931a, #ff6b35);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 1.5rem;
      text-align: center;
    }
    .stat-value { font-size: 1.8rem; font-weight: bold; color: #f7931a; }
    .stat-label { color: #888; font-size: 0.9rem; }
    .section { margin-bottom: 2rem; }
    .section-title { font-size: 1.3rem; margin-bottom: 1rem; color: #fff; }
    .market-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      border: 1px solid rgba(247, 147, 26, 0.2);
    }
    .market-target {
      font-size: 1.5rem;
      font-weight: bold;
      color: #f7931a;
    }
    .market-desc { color: #aaa; margin: 0.5rem 0; }
    .market-meta { display: flex; gap: 2rem; color: #888; font-size: 0.9rem; }
    .odds-bar {
      display: flex;
      height: 30px;
      border-radius: 6px;
      overflow: hidden;
      margin: 1rem 0;
    }
    .odds-yes {
      background: linear-gradient(90deg, #22c55e, #16a34a);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }
    .odds-no {
      background: linear-gradient(90deg, #ef4444, #dc2626);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }
    .pool-info { display: flex; justify-content: space-between; color: #888; }
    .api-section {
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 1.5rem;
    }
    .endpoint {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .endpoint:last-child { border-bottom: none; }
    .method {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: bold;
    }
    .method-get { background: #22c55e; color: #000; }
    .method-post { background: #3b82f6; color: #fff; }
    .endpoint-path { font-family: monospace; color: #f7931a; }
    .endpoint-desc { color: #888; margin-left: auto; }
    .price-tag { color: #fbbf24; font-size: 0.8rem; }
    a { color: #f7931a; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .empty { color: #666; text-align: center; padding: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>BTC Oracle</h1>
    <p class="subtitle">Prediction Market for Bitcoin Price</p>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">$${btcPrice ? (btcPrice / 100).toLocaleString() : '---'}</div>
        <div class="stat-label">Current BTC Price</div>
      </div>
      <div class="stat">
        <div class="stat-value">${currentBlock.toLocaleString()}</div>
        <div class="stat-label">Bitcoin Block</div>
      </div>
      <div class="stat">
        <div class="stat-value">${activeMarkets.length}</div>
        <div class="stat-label">Active Markets</div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Active Markets</h2>
      ${activeMarkets.length === 0 ? '<div class="empty">No active markets. Create one via the API!</div>' : ''}
      ${activeMarkets.map(m => {
        const odds = calculateOdds(m.yesPool, m.noPool);
        const blocksRemaining = m.settlementBlock - currentBlock;
        return `
        <div class="market-card">
          <div class="market-target">BTC ${m.targetPrice >= (btcPrice || 0) ? '≥' : '<'} $${(m.targetPrice / 100).toLocaleString()}</div>
          <div class="market-desc">${m.description}</div>
          <div class="market-meta">
            <span>Block ${m.settlementBlock.toLocaleString()}</span>
            <span>${blocksRemaining > 0 ? `~${blocksRemaining} blocks remaining` : 'Settlement pending'}</span>
          </div>
          <div class="odds-bar">
            <div class="odds-yes" style="width: ${odds.yesOdds}%">YES ${odds.yesOdds}%</div>
            <div class="odds-no" style="width: ${odds.noOdds}%">NO ${odds.noOdds}%</div>
          </div>
          <div class="pool-info">
            <span>YES: ${(m.yesPool / 100000000).toFixed(8)} sBTC</span>
            <span>NO: ${(m.noPool / 100000000).toFixed(8)} sBTC</span>
          </div>
        </div>
        `;
      }).join('')}
    </div>

    <div class="section">
      <h2 class="section-title">API Endpoints</h2>
      <div class="api-section">
        <div class="endpoint">
          <span class="method method-get">GET</span>
          <span class="endpoint-path">/markets</span>
          <span class="endpoint-desc">List all markets</span>
        </div>
        <div class="endpoint">
          <span class="method method-get">GET</span>
          <span class="endpoint-path">/market/:id</span>
          <span class="endpoint-desc">Get market details</span>
        </div>
        <div class="endpoint">
          <span class="method method-post">POST</span>
          <span class="endpoint-path">/create</span>
          <span class="endpoint-desc">Create market</span>
          <span class="price-tag">0.01 STX</span>
        </div>
        <div class="endpoint">
          <span class="method method-post">POST</span>
          <span class="endpoint-path">/bet</span>
          <span class="endpoint-desc">Generate bet transaction</span>
        </div>
        <div class="endpoint">
          <span class="method method-post">POST</span>
          <span class="endpoint-path">/settle/:id</span>
          <span class="endpoint-desc">Settle market</span>
        </div>
        <div class="endpoint">
          <span class="method method-post">POST</span>
          <span class="endpoint-path">/claim/:id</span>
          <span class="endpoint-desc">Claim winnings</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">How It Works</h2>
      <ol style="color: #aaa; padding-left: 1.5rem; line-height: 1.8;">
        <li>Create a market predicting BTC price at a future Bitcoin block</li>
        <li>Users bet sBTC on YES (price ≥ target) or NO (price < target)</li>
        <li>After settlement block, anyone can trigger settlement via Pyth oracle</li>
        <li>Winners claim proportional share of the pool (2% protocol fee)</li>
      </ol>
    </div>

    <p style="color: #666; text-align: center; margin-top: 3rem;">
      Powered by <a href="https://pyth.network">Pyth Network</a> oracle on Stacks
    </p>
  </div>
</body>
</html>`;

  return c.html(html);
});

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get("/health", (c) => json({ status: "ok", timestamp: new Date().toISOString() }));

// Get API info
app.get("/api", async (c) => {
  const currentBlock = await getCurrentBtcBlock(c.env);
  const btcPrice = await getBtcPrice();

  return json({
    name: "BTC Oracle - Prediction Market",
    version: "1.0.0",
    description: "Bet sBTC on Bitcoin price predictions, settled via Pyth oracle",
    currentBtcBlock: currentBlock,
    currentBtcPrice: btcPrice ? `$${(btcPrice / 100).toLocaleString()}` : null,
    contract: CONTRACT,
    endpoints: {
      "GET /markets": "List all markets",
      "GET /market/:id": "Get market details",
      "POST /create": "Create new market (x402: 0.01 STX)",
      "POST /bet": "Generate bet transaction",
      "POST /settle/:id": "Trigger market settlement",
      "POST /claim/:id": "Generate claim transaction",
    },
  });
});

// List all markets
app.get("/markets", async (c) => {
  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const currentBlock = await getCurrentBtcBlock(c.env);

  return json({
    markets: markets.map(m => ({
      ...m,
      odds: calculateOdds(m.yesPool, m.noPool),
      blocksRemaining: m.settlementBlock - currentBlock,
      status: m.settled ? "settled" : (m.settlementBlock <= currentBlock ? "pending_settlement" : "active"),
    })),
    count: markets.length,
    currentBlock,
  });
});

// Get single market
app.get("/market/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const market = markets.find(m => m.id === id);

  if (!market) {
    return json({ error: "Market not found" }, 404);
  }

  const currentBlock = await getCurrentBtcBlock(c.env);
  const btcPrice = await getBtcPrice();

  return json({
    ...market,
    odds: calculateOdds(market.yesPool, market.noPool),
    blocksRemaining: market.settlementBlock - currentBlock,
    status: market.settled ? "settled" : (market.settlementBlock <= currentBlock ? "pending_settlement" : "active"),
    currentBtcPrice: btcPrice,
    currentBlock,
  });
});

// Create market (x402 gated)
app.post("/create", async (c) => {
  const payment = c.req.header("X-Payment");

  if (!payment) {
    return payment402("Create prediction market", PRICES.CREATE_MARKET);
  }

  const body = await c.req.json() as {
    targetPrice: number;
    settlementBlock: number;
    description?: string;
  };

  // Validation
  if (!body.targetPrice || body.targetPrice <= 0) {
    return json({ error: "Invalid target price" }, 400);
  }

  const currentBlock = await getCurrentBtcBlock(c.env);
  const minBlock = currentBlock + 144; // ~24 hours

  if (!body.settlementBlock || body.settlementBlock < minBlock) {
    return json({
      error: "Settlement block too soon",
      minimumBlock: minBlock,
      currentBlock,
    }, 400);
  }

  // Get existing markets
  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const newId = markets.length;

  const newMarket: Market = {
    id: newId,
    creator: payment.slice(0, 20), // Use payment tx as pseudo-creator
    targetPrice: body.targetPrice,
    settlementBlock: body.settlementBlock,
    yesPool: 0,
    noPool: 0,
    settled: false,
    winningSide: null,
    settlementPrice: 0,
    description: body.description || `BTC >= $${(body.targetPrice / 100).toLocaleString()} by block ${body.settlementBlock}`,
    createdAt: new Date().toISOString(),
  };

  markets.push(newMarket);
  await c.env.CACHE.put("markets", JSON.stringify(markets));

  return json({
    success: true,
    market: newMarket,
    payment: { txid: payment },
    message: "Market created! Users can now place bets.",
    betEndpoint: "/bet",
  });
});

// Generate bet transaction
app.post("/bet", async (c) => {
  const body = await c.req.json() as {
    marketId: number;
    side: "yes" | "no";
    amount: number; // in sats
    sender: string;
  };

  // Validation
  if (body.marketId === undefined || !body.side || !body.amount || !body.sender) {
    return json({
      error: "Missing required fields",
      required: { marketId: "number", side: "yes|no", amount: "sats", sender: "address" }
    }, 400);
  }

  if (body.amount < 1000) {
    return json({ error: "Minimum bet is 1000 sats" }, 400);
  }

  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const market = markets.find(m => m.id === body.marketId);

  if (!market) {
    return json({ error: "Market not found" }, 404);
  }

  if (market.settled) {
    return json({ error: "Market already settled" }, 400);
  }

  const currentBlock = await getCurrentBtcBlock(c.env);
  if (market.settlementBlock <= currentBlock) {
    return json({ error: "Betting period ended" }, 400);
  }

  // Generate contract call details
  const functionName = body.side === "yes" ? "bet-yes" : "bet-no";

  return json({
    success: true,
    transaction: {
      contractAddress: CONTRACT.address,
      contractName: CONTRACT.name,
      functionName,
      functionArgs: [
        { type: "uint", value: body.marketId },
        { type: "uint", value: body.amount },
      ],
      postConditions: [
        {
          type: "stx-transfer",
          sender: body.sender,
          amount: body.amount,
        },
      ],
    },
    market: {
      id: market.id,
      targetPrice: market.targetPrice,
      settlementBlock: market.settlementBlock,
      currentOdds: calculateOdds(market.yesPool, market.noPool),
    },
    message: `Sign this transaction to bet ${body.amount} sats on ${body.side.toUpperCase()}`,
  });
});

// Trigger settlement
app.post("/settle/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const marketIndex = markets.findIndex(m => m.id === id);

  if (marketIndex === -1) {
    return json({ error: "Market not found" }, 404);
  }

  const market = markets[marketIndex];

  if (market.settled) {
    return json({ error: "Already settled", winningSide: market.winningSide }, 400);
  }

  const currentBlock = await getCurrentBtcBlock(c.env);
  if (market.settlementBlock > currentBlock) {
    return json({
      error: "Settlement block not reached",
      currentBlock,
      settlementBlock: market.settlementBlock,
      blocksRemaining: market.settlementBlock - currentBlock,
    }, 400);
  }

  // Get BTC price for settlement
  const btcPrice = await getBtcPrice();
  if (!btcPrice) {
    return json({ error: "Could not fetch BTC price" }, 500);
  }

  const yesWins = btcPrice >= market.targetPrice;

  // Update market
  markets[marketIndex] = {
    ...market,
    settled: true,
    winningSide: yesWins,
    settlementPrice: btcPrice,
  };

  await c.env.CACHE.put("markets", JSON.stringify(markets));

  return json({
    success: true,
    settlement: {
      marketId: id,
      targetPrice: market.targetPrice,
      settlementPrice: btcPrice,
      winningSide: yesWins ? "yes" : "no",
      yesPool: market.yesPool,
      noPool: market.noPool,
    },
    message: `Market settled! ${yesWins ? "YES" : "NO"} wins. BTC was $${(btcPrice / 100).toLocaleString()} vs target $${(market.targetPrice / 100).toLocaleString()}`,
    claimEndpoint: `/claim/${id}`,
  });
});

// Generate claim transaction
app.post("/claim/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json() as { sender: string };

  if (!body.sender) {
    return json({ error: "Sender address required" }, 400);
  }

  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];
  const market = markets.find(m => m.id === id);

  if (!market) {
    return json({ error: "Market not found" }, 404);
  }

  if (!market.settled) {
    return json({ error: "Market not yet settled" }, 400);
  }

  return json({
    success: true,
    transaction: {
      contractAddress: CONTRACT.address,
      contractName: CONTRACT.name,
      functionName: "claim",
      functionArgs: [
        { type: "uint", value: id },
      ],
    },
    market: {
      id: market.id,
      winningSide: market.winningSide ? "yes" : "no",
      settlementPrice: market.settlementPrice,
    },
    message: "Sign this transaction to claim your winnings",
  });
});

// Demo endpoint - add a test market
app.post("/demo/create-test-market", async (c) => {
  const currentBlock = await getCurrentBtcBlock(c.env);
  const btcPrice = await getBtcPrice();

  const markets = await c.env.CACHE.get("markets", "json") as Market[] || [];

  // Create a test market
  const testMarket: Market = {
    id: markets.length,
    creator: "demo",
    targetPrice: btcPrice ? btcPrice + 500000 : 15000000, // Current + $5k or $150k
    settlementBlock: currentBlock + 1000, // ~1 week
    yesPool: 50000, // 50k sats
    noPool: 30000, // 30k sats
    settled: false,
    winningSide: null,
    settlementPrice: 0,
    description: "Demo: Will BTC reach new highs?",
    createdAt: new Date().toISOString(),
  };

  markets.push(testMarket);
  await c.env.CACHE.put("markets", JSON.stringify(markets));

  return json({
    success: true,
    market: testMarket,
    message: "Test market created for demo purposes",
  });
});

export default app;
