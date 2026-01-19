
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Project Overview

BTC Oracle is a prediction market for Bitcoin price targets:
- Users create markets predicting BTC price at future Bitcoin blocks
- Bets placed in sBTC
- Settlement via Pyth oracle on Stacks
- Parimutuel payout model (2% protocol fee)

## Architecture

```
x402 API (Cloudflare Worker)
  ↓
prediction-market.clar (Stacks mainnet)
  ↓
Pyth Oracle (BTC/USD feed)
```

## Key Contracts

- **sBTC**: `SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc`
- **Pyth Oracle**: `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4`
- **BTC Feed ID**: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`

## Deployment

```bash
# Deploy worker
bunx wrangler deploy

# Or via API if auth issues
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/d0766755a8912ac630c84a07eb827cde/workers/scripts/btc-oracle" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata=@/tmp/metadata.json;type=application/json' \
  -F 'index.js=@/tmp/worker-build/index.js;type=application/javascript+module'
```
