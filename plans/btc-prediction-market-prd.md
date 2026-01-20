# PRD: BTC Prediction Market

## Overview

Spec: `specs/btc-prediction-market.md`

Bitcoin-native prediction market on Stacks. Users bet sBTC on BTC price targets at specific blocks. x402 API for UX, Clarity contracts for trustless escrow/settlement, Pyth oracle for price resolution.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER                                     │
│   1. Browse markets  2. Place bet  3. Claim winnings            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    btc-oracle.p-d07.workers.dev                  │
│                       (x402 API - Cloudflare)                    │
│                                                                  │
│  GET  /              → UI + market list                          │
│  GET  /markets       → All markets with odds                     │
│  GET  /market/:id    → Single market details                     │
│  POST /create        → Create market (x402: 0.01 STX)           │
│  POST /bet           → Generate bet tx for signing               │
│  POST /settle/:id    → Broadcast settlement tx                   │
│  POST /claim/:id     → Generate claim tx for signing             │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                 prediction-market.clar (Mainnet)                 │
│                                                                  │
│  Data:                                                           │
│    markets: {id, creator, target-price, settlement-block,        │
│              yes-pool, no-pool, settled, winning-side}           │
│    positions: {user, market-id, side, amount}                    │
│                                                                  │
│  Functions:                                                      │
│    create-market(target-price, settlement-block) → market-id     │
│    bet-yes(market-id, amount) → transfers sBTC to contract       │
│    bet-no(market-id, amount) → transfers sBTC to contract        │
│    settle(market-id) → reads Pyth, sets winner                   │
│    claim(market-id) → pays proportional share to caller          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                        Pyth Oracle                               │
│   SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4      │
│   BTC Feed: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72...   │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Clarity Contract (Core)

- [ ] Task 1.1: Create `prediction-market.clar` with data structures
  - Market map (id → details)
  - Position map (user+market → bet)
  - Constants (fee rate, min bet, Pyth addresses)

- [ ] Task 1.2: Implement `create-market`
  - Accept target-price (in cents) and settlement-block
  - Validate settlement-block > current block + min-delay
  - Generate unique market-id
  - Emit event for indexing

- [ ] Task 1.3: Implement `bet-yes` and `bet-no`
  - Transfer sBTC from user to contract
  - Record position in map
  - Update pool totals
  - Prevent bets after settlement block

- [ ] Task 1.4: Implement `settle`
  - Require current-block >= settlement-block
  - Call Pyth oracle for BTC price
  - Compare to target, set winning-side
  - Mark market as settled
  - Take protocol fee from winning pool

- [ ] Task 1.5: Implement `claim`
  - Require market settled
  - Require caller has winning position
  - Calculate proportional share
  - Transfer sBTC to caller
  - Mark position as claimed

- [ ] Task 1.6: Add read-only functions
  - `get-market(id)`
  - `get-position(user, market-id)`
  - `get-odds(market-id)` → (yes-pool, no-pool, implied-odds)
  - `get-active-markets`

### Phase 2: x402 API (Cloudflare Worker)

- [ ] Task 2.1: Project setup
  - New project: `btc-oracle` (or `btc-bets`)
  - Hono + Cloudflare Workers
  - KV for caching market data

- [ ] Task 2.2: Implement free endpoints
  - `GET /` - UI with market list
  - `GET /markets` - JSON list of all markets
  - `GET /market/:id` - Single market with positions/odds
  - `GET /health` - Health check

- [ ] Task 2.3: Implement `/create` (x402 gated)
  - Accept: target_price, settlement_block, description
  - Generate unsigned contract-call tx
  - Return tx for user to sign + broadcast
  - Cache new market in KV

- [ ] Task 2.4: Implement `/bet`
  - Accept: market_id, side (yes/no), amount
  - Validate market exists and not settled
  - Generate unsigned bet tx
  - Return for signing

- [ ] Task 2.5: Implement `/settle/:id`
  - Anyone can call
  - Generate + broadcast settlement tx
  - Update cached market state

- [ ] Task 2.6: Implement `/claim/:id`
  - Generate unsigned claim tx for caller
  - Return for signing

### Phase 3: Frontend UI

- [ ] Task 3.1: Market list view
  - Active markets with countdown to settlement
  - Current odds visualization (bar chart)
  - Total pool sizes

- [ ] Task 3.2: Market detail view
  - Price target + settlement block
  - Current BTC price (from Pyth)
  - Bet input (amount, side selector)
  - Position display if user has bet

- [ ] Task 3.3: Create market form
  - Price target input
  - Settlement block picker (or date → block converter)
  - x402 payment flow

- [ ] Task 3.4: Wallet integration
  - Connect wallet button
  - Sign transaction flow
  - Show user positions

### Phase 4: Testing & Deploy

- [ ] Task 4.1: Write Clarinet tests
  - Happy path: create → bet → settle → claim
  - Edge cases: bet after settlement, double claim
  - Pyth mock for testing

- [ ] Task 4.2: Deploy contract to testnet
  - Test full flow with testnet sBTC

- [ ] Task 4.3: Deploy x402 API to Cloudflare

- [ ] Task 4.4: Deploy contract to mainnet

- [ ] Task 4.5: End-to-end test on mainnet

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `btc-oracle/` | Create | New project directory |
| `btc-oracle/src/index.ts` | Create | x402 API worker |
| `btc-oracle/wrangler.toml` | Create | Cloudflare config |
| `btc-oracle/contracts/prediction-market.clar` | Create | Core contract |
| `btc-oracle/contracts/traits/sip-010-trait.clar` | Create | SIP-010 for sBTC |
| `btc-oracle/tests/prediction-market.test.ts` | Create | Clarinet tests |
| `btc-oracle/Clarinet.toml` | Create | Clarinet config |

## Dependencies

**Clarity:**
- Pyth Oracle: `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4`
- Pyth Storage: `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-storage-v4`
- sBTC: `SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc`

**Worker:**
- hono
- @stacks/transactions (for tx building)
- KV namespace for cache

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Pyth price stale at settlement | Add staleness check, allow re-settle if price was stale |
| Contract bugs lose funds | Thorough testing, start with small bet limits |
| Low liquidity / lopsided markets | Show odds clearly, let market dynamics work |
| Settlement block uncertainty | Use burn-block-height for Bitcoin blocks |
| Front-running settlement | Settlement is permissionless, no advantage to being first |

## Rollback Plan

1. **Contract issues**: Cannot rollback deployed contract. Mitigation:
   - Add admin pause function for emergencies
   - Start with low max-bet limits
   - Upgrade path: deploy new contract, migrate via claim refunds

2. **API issues**:
   - Redeploy previous worker version
   - Contract continues working independently

## Open Questions

1. **Block type**: Use `burn-block-height` (Bitcoin) or `stacks-block-height`?
   - Recommendation: `burn-block-height` for Bitcoin-native feel

2. **Minimum bet**: What's the floor?
   - Recommendation: 1000 sats (0.00001 BTC)

3. **Maximum bet**: Should there be a cap?
   - Recommendation: No cap for v1, let market decide

4. **Market creation fee**: 0.01 STX via x402?
   - Recommendation: Yes, prevents spam

---

Run `/approve` to begin implementation.
