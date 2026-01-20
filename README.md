# BTC Oracle

Bitcoin price prediction market on Stacks. Bet sBTC on BTC price targets, settled trustlessly via Pyth oracle.

## Live

https://btc-oracle.p-d07.workers.dev/

## How It Works

1. **Create Market** - Set a BTC price target and settlement Bitcoin block
2. **Place Bets** - Users bet sBTC on YES (price ≥ target) or NO (price < target)
3. **Settlement** - After the block, anyone can trigger Pyth oracle settlement
4. **Claim** - Winners claim proportional share of the pool (2% protocol fee)

## Architecture

```
┌─────────────────────────────────────────┐
│           x402 API (Cloudflare)         │
│  /markets, /create, /bet, /settle       │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│      prediction-market.clar (Stacks)    │
│  On-chain escrow, betting, settlement   │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│           Pyth Oracle                   │
│  BTC/USD price feed for settlement      │
└─────────────────────────────────────────┘
```

## API Endpoints

| Endpoint | Method | Price | Description |
|----------|--------|-------|-------------|
| `/` | GET | Free | Interactive UI |
| `/markets` | GET | Free | List all markets |
| `/market/:id` | GET | Free | Market details |
| `/create` | POST | 0.01 STX | Create market |
| `/bet` | POST | Free | Generate bet tx |
| `/settle/:id` | POST | Free | Trigger settlement |
| `/claim/:id` | POST | Free | Generate claim tx |

## Contracts

### prediction-market.clar

Core contract handling:
- Market creation with price targets and settlement blocks
- sBTC betting on YES/NO positions
- Pyth oracle integration for trustless settlement
- Proportional payout distribution

### Dependencies

- **sBTC**: `SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc`
- **Pyth Oracle**: `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4`
- **BTC Feed ID**: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`

## Development

```bash
# Install dependencies
bun install

# Run locally
bun run dev

# Deploy to Cloudflare
bun run deploy

# Check contract
cd contracts && clarinet check
```

## Deployment Status

- [x] x402 API deployed
- [ ] Contract deployed to mainnet (needs ~1 STX for gas)
- [ ] Update API with contract address

## License

MIT
