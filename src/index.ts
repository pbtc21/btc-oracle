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

  // Get cached markets (handle missing KV gracefully)
  let marketsData: Market[] = [];
  try {
    if (c.env.CACHE) {
      marketsData = await c.env.CACHE.get("markets", "json") as Market[] || [];
    }
  } catch (e) {
    console.error("KV error:", e);
  }
  const activeMarkets = marketsData.filter(m => !m.settled);
  const totalPool = marketsData.reduce((sum, m) => sum + m.yesPool + m.noPool, 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BTC Oracle</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --orange-50: #fff7ed;
      --orange-100: #ffedd5;
      --orange-200: #fed7aa;
      --orange-300: #fdba74;
      --orange-400: #fb923c;
      --orange-500: #f97316;
      --orange-600: #ea580c;
      --orange-700: #c2410c;
      --bg-dark: #0c0c0c;
      --bg-card: #141414;
      --bg-elevated: #1a1a1a;
      --border: #262626;
      --text-primary: #fafafa;
      --text-secondary: #a3a3a3;
      --text-muted: #525252;
      --green: #22c55e;
      --red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Space Grotesk', -apple-system, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
    }
    .noise {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
      opacity: 0.03;
      pointer-events: none;
      z-index: 0;
    }
    .glow {
      position: fixed;
      top: -50%;
      left: 50%;
      transform: translateX(-50%);
      width: 100%;
      max-width: 800px;
      height: 600px;
      background: radial-gradient(ellipse, rgba(249, 115, 22, 0.15) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 3rem 1.5rem;
      position: relative;
      z-index: 1;
    }

    /* Header */
    .header {
      text-align: center;
      margin-bottom: 4rem;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .logo-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--orange-500), var(--orange-600));
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      box-shadow: 0 0 30px rgba(249, 115, 22, 0.3);
    }
    .logo-text {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .tagline {
      font-size: 1.25rem;
      color: var(--text-secondary);
      max-width: 500px;
      margin: 0 auto 1rem;
    }
    .tagline-emphasis {
      color: var(--orange-400);
      font-weight: 500;
    }
    .sub-tagline {
      font-size: 0.875rem;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
    }

    /* Stats */
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--border);
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: 3rem;
    }
    .stat {
      background: var(--bg-card);
      padding: 1.75rem;
      text-align: center;
    }
    .stat:first-child { border-radius: 16px 0 0 16px; }
    .stat:last-child { border-radius: 0 16px 16px 0; }
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: -0.02em;
    }
    .stat-value .currency { color: var(--orange-500); }
    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 0.5rem;
    }

    /* Section */
    .section {
      margin-bottom: 3rem;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .section-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .section-badge {
      font-size: 0.75rem;
      color: var(--orange-400);
      background: rgba(249, 115, 22, 0.1);
      padding: 0.25rem 0.75rem;
      border-radius: 100px;
      font-family: 'JetBrains Mono', monospace;
    }

    /* Market Card */
    .market-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .market-card:hover {
      border-color: var(--orange-700);
      box-shadow: 0 0 40px rgba(249, 115, 22, 0.1);
    }
    .market-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .market-target {
      font-size: 1.5rem;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .market-target .symbol { color: var(--orange-500); }
    .market-status {
      font-size: 0.75rem;
      padding: 0.25rem 0.75rem;
      border-radius: 100px;
      font-weight: 500;
    }
    .status-active {
      background: rgba(34, 197, 94, 0.1);
      color: var(--green);
    }
    .status-pending {
      background: rgba(249, 115, 22, 0.1);
      color: var(--orange-400);
    }
    .market-meta {
      display: flex;
      gap: 1.5rem;
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-bottom: 1.25rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .market-meta span {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    .odds-container {
      margin-bottom: 1rem;
    }
    .odds-bar {
      display: flex;
      height: 40px;
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-elevated);
    }
    .odds-yes {
      background: linear-gradient(135deg, #16a34a, #22c55e);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
      min-width: 60px;
      transition: width 0.3s ease;
    }
    .odds-no {
      background: linear-gradient(135deg, #dc2626, #ef4444);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
      min-width: 60px;
      transition: width 0.3s ease;
    }
    .pool-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .pool-info .yes { color: var(--green); }
    .pool-info .no { color: var(--red); }

    /* Empty State */
    .empty {
      text-align: center;
      padding: 4rem 2rem;
      background: var(--bg-card);
      border: 1px dashed var(--border);
      border-radius: 16px;
    }
    .empty-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }
    .empty-text {
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .empty-cta {
      color: var(--orange-400);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
    }

    /* API Section */
    .api-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
    }
    .endpoint {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      transition: background 0.2s;
    }
    .endpoint:last-child { border-bottom: none; }
    .endpoint:hover { background: var(--bg-elevated); }
    .method {
      font-size: 0.625rem;
      font-weight: 700;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: 0.05em;
      min-width: 44px;
      text-align: center;
    }
    .method-get { background: rgba(34, 197, 94, 0.15); color: var(--green); }
    .method-post { background: rgba(249, 115, 22, 0.15); color: var(--orange-400); }
    .endpoint-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      color: var(--text-primary);
    }
    .endpoint-desc {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-left: auto;
    }
    .price-tag {
      font-size: 0.75rem;
      color: var(--orange-400);
      background: rgba(249, 115, 22, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
    }

    /* How it works */
    .steps {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
    }
    .step {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      text-align: center;
    }
    .step-num {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--orange-600), var(--orange-500));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.875rem;
      margin: 0 auto 0.75rem;
    }
    .step-title {
      font-weight: 600;
      font-size: 0.875rem;
      margin-bottom: 0.25rem;
    }
    .step-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* Footer */
    .footer {
      text-align: center;
      padding-top: 3rem;
      border-top: 1px solid var(--border);
      margin-top: 3rem;
    }
    .footer-text {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .footer-links {
      display: flex;
      justify-content: center;
      gap: 1.5rem;
      margin-top: 1rem;
    }
    .footer-links a {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-links a:hover { color: var(--orange-400); }

    /* Responsive */
    @media (max-width: 768px) {
      .stats { grid-template-columns: 1fr; }
      .stat { border-radius: 0 !important; }
      .stat:first-child { border-radius: 16px 16px 0 0 !important; }
      .stat:last-child { border-radius: 0 0 16px 16px !important; }
      .steps { grid-template-columns: repeat(2, 1fr); }
      .endpoint { flex-wrap: wrap; }
      .endpoint-desc { width: 100%; margin-left: 0; margin-top: 0.5rem; }
    }
  </style>
</head>
<body>
  <div class="noise"></div>
  <div class="glow"></div>

  <div class="container">
    <header class="header">
      <div class="logo">
        <div class="logo-icon">₿</div>
        <span class="logo-text">BTC Oracle</span>
      </div>
      <p class="tagline">
        Bet sBTC on price. Settle on <span class="tagline-emphasis">Bitcoin blocks</span>.
        Trust the <span class="tagline-emphasis">Pyth</span>.
      </p>
      <p class="sub-tagline">no house · no edge · no trust required</p>
    </header>

    <div class="stats">
      <div class="stat">
        <div class="stat-value"><span class="currency">$</span>${btcPrice ? (btcPrice / 100).toLocaleString() : '---'}</div>
        <div class="stat-label">BTC Price</div>
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
      <div class="section-header">
        <h2 class="section-title">Markets</h2>
        ${totalPool > 0 ? '<span class="section-badge">' + (totalPool / 100000000).toFixed(4) + ' sBTC total</span>' : ''}
      </div>
      ${activeMarkets.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">◎</div>
          <p class="empty-text">No active markets yet</p>
          <p class="empty-cta">POST /create to open the first one</p>
        </div>
      ` : ''}
      ${activeMarkets.map(m => {
        const odds = calculateOdds(m.yesPool, m.noPool);
        const blocksRemaining = m.settlementBlock - currentBlock;
        const isSettlementPending = blocksRemaining <= 0;
        return `
        <div class="market-card">
          <div class="market-header">
            <div class="market-target">
              <span class="symbol">BTC</span> ${m.targetPrice >= (btcPrice || 0) ? '≥' : '<'} $${(m.targetPrice / 100).toLocaleString()}
            </div>
            <span class="market-status ${isSettlementPending ? 'status-pending' : 'status-active'}">
              ${isSettlementPending ? 'Settlement Ready' : 'Live'}
            </span>
          </div>
          <div class="market-meta">
            <span>◷ Block ${m.settlementBlock.toLocaleString()}</span>
            <span>${blocksRemaining > 0 ? blocksRemaining.toLocaleString() + ' blocks left' : 'Ready to settle'}</span>
          </div>
          <div class="odds-container">
            <div class="odds-bar">
              <div class="odds-yes" style="width: ${Math.max(odds.yesOdds, 15)}%">YES ${odds.yesOdds}%</div>
              <div class="odds-no" style="width: ${Math.max(odds.noOdds, 15)}%">NO ${odds.noOdds}%</div>
            </div>
          </div>
          <div class="pool-info">
            <span class="yes">${(m.yesPool / 100000000).toFixed(6)} sBTC</span>
            <span class="no">${(m.noPool / 100000000).toFixed(6)} sBTC</span>
          </div>
        </div>
        `;
      }).join('')}
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title">How It Works</h2>
      </div>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-title">Create</div>
          <div class="step-desc">Set price target & settlement block</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-title">Bet</div>
          <div class="step-desc">Stake sBTC on YES or NO</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-title">Settle</div>
          <div class="step-desc">Pyth oracle reports truth</div>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <div class="step-title">Claim</div>
          <div class="step-desc">Winners split the pool</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title">API</h2>
      </div>
      <div class="api-card">
        <div class="endpoint">
          <span class="method method-get">GET</span>
          <span class="endpoint-path">/markets</span>
          <span class="endpoint-desc">List all markets</span>
        </div>
        <div class="endpoint">
          <span class="method method-get">GET</span>
          <span class="endpoint-path">/market/:id</span>
          <span class="endpoint-desc">Market details + odds</span>
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
          <span class="endpoint-desc">Generate bet tx</span>
        </div>
        <div class="endpoint">
          <span class="method method-post">POST</span>
          <span class="endpoint-path">/settle/:id</span>
          <span class="endpoint-desc">Trigger settlement</span>
        </div>
        <div class="endpoint">
          <span class="method method-post">POST</span>
          <span class="endpoint-path">/claim/:id</span>
          <span class="endpoint-desc">Claim winnings</span>
        </div>
      </div>
    </div>

    <footer class="footer">
      <p class="footer-text">Parimutuel betting · 2% protocol fee · On-chain settlement</p>
      <div class="footer-links">
        <a href="https://pyth.network" target="_blank">Pyth Network</a>
        <a href="https://stacks.co" target="_blank">Stacks</a>
        <a href="/api">API Docs</a>
      </div>
    </footer>
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
