# Spec: BTC Prediction Market

## Problem

People want to bet on Bitcoin's future price with trustless settlement. Current prediction markets are either:
- Centralized (counterparty risk, withdrawal issues)
- On other chains (not Bitcoin-native)
- Complex UX (requires understanding DeFi mechanics)

## Solution

A Bitcoin-native prediction market on Stacks where users bet sBTC on BTC price targets at specific blocks. x402 API makes it easy to create/join markets. On-chain Clarity contracts handle escrow and Pyth oracle settles trustlessly.

## Core Features

- **Create Market**: Specify BTC price target and settlement block (e.g., "BTC > $150k by block 900,000")
- **Take Position**: Bet sBTC on YES or NO side of the market
- **Automatic Settlement**: Pyth oracle resolves at target block, winners paid proportionally
- **x402 API**: Simple REST endpoints to interact, x402 payment for market creation
- **On-chain Escrow**: All sBTC locked in contract until settlement

## Market Mechanics

```
Market: "BTC > $150,000 by Bitcoin block 900,000"

YES Pool: 0.5 sBTC (5 bets)
NO Pool: 0.3 sBTC (3 bets)

If BTC > $150k at block 900,000:
  - YES pool wins
  - Each YES bettor gets proportional share of total pool (0.8 sBTC)
  - 2% protocol fee

If BTC <= $150k:
  - NO pool wins
  - Same distribution logic
```

## Out of Scope (v1)

- Multiple price targets per market
- Partial position exits before settlement
- Limit orders / order book
- Non-BTC price feeds
- Time-based expiry (block-based only)

## Success Criteria

1. Users can create markets via x402 API
2. Users can bet sBTC on either side
3. Markets settle automatically using Pyth
4. Winners receive funds trustlessly
5. All funds held in auditable on-chain contract

## Technical Notes

### Pyth Integration
```clarity
;; Read BTC price from Pyth
(contract-call? 'SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4
  read-price-feed
  0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
  'SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-storage-v4)
```

### Architecture
```
┌─────────────────────────────────────────────────────────┐
│                    x402 API (Cloudflare)                │
│  /markets - list active markets                         │
│  /market/:id - market details + odds                    │
│  /create - create new market (x402 payment)             │
│  /bet - generate bet transaction                        │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│              prediction-market.clar (On-chain)          │
│  - create-market (target-price, settlement-block)       │
│  - bet-yes / bet-no (market-id, amount)                 │
│  - settle (market-id) - anyone can call post-block      │
│  - claim (market-id) - winners claim proportional share │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    Pyth Oracle                          │
│  SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y             │
│  - BTC/USD price feed                                   │
│  - Called at settlement to determine winner             │
└─────────────────────────────────────────────────────────┘
```

### sBTC Contract
```
SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc
```

### Key Design Decisions

1. **Block-based settlement**: More predictable than timestamps, Bitcoin-native
2. **Binary markets only**: Simpler UX, clearer odds
3. **Proportional payouts**: Parimutuel model, no market maker needed
4. **Anyone can settle**: Permissionless settlement after target block
5. **2% protocol fee**: Sustainable, taken from winning pool

### Endpoints

| Endpoint | Method | Price | Description |
|----------|--------|-------|-------------|
| `/` | GET | Free | UI + active markets |
| `/markets` | GET | Free | List all markets |
| `/market/:id` | GET | Free | Market details, positions, odds |
| `/create` | POST | 0.01 STX | Create new market |
| `/bet` | POST | Free | Generate bet transaction (user signs) |
| `/settle/:id` | POST | Free | Trigger settlement (calls contract) |
| `/claim/:id` | POST | Free | Generate claim transaction |
