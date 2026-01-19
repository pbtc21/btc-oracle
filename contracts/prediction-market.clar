;; BTC Prediction Market
;; Bet sBTC on Bitcoin price targets, settled via Pyth oracle

;; ============================================
;; TRAITS
;; ============================================

(use-trait ft-trait .traits.sip-010-trait.sip-010-trait)

;; ============================================
;; CONSTANTS
;; ============================================

;; External contracts
(define-constant SBTC_CONTRACT 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-sbtc)
(define-constant PYTH_ORACLE 'SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4)
(define-constant PYTH_STORAGE 'SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-storage-v4)

;; BTC/USD price feed ID
(define-constant BTC_FEED_ID 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43)

;; Protocol parameters
(define-constant PROTOCOL_FEE_BPS u200) ;; 2%
(define-constant MIN_BET u1000) ;; 1000 sats minimum
(define-constant MIN_SETTLEMENT_DELAY u144) ;; ~24 hours in blocks
(define-constant CONTRACT_OWNER tx-sender)

;; Error codes
(define-constant ERR_NOT_AUTHORIZED (err u1001))
(define-constant ERR_INVALID_AMOUNT (err u1002))
(define-constant ERR_MARKET_NOT_FOUND (err u1003))
(define-constant ERR_MARKET_CLOSED (err u1004))
(define-constant ERR_MARKET_NOT_SETTLED (err u1005))
(define-constant ERR_ALREADY_SETTLED (err u1006))
(define-constant ERR_NO_POSITION (err u1007))
(define-constant ERR_ALREADY_CLAIMED (err u1008))
(define-constant ERR_WRONG_SIDE (err u1009))
(define-constant ERR_SETTLEMENT_TOO_SOON (err u1010))
(define-constant ERR_TRANSFER_FAILED (err u1011))
(define-constant ERR_INVALID_BLOCK (err u1012))
(define-constant ERR_PAUSED (err u1013))

;; ============================================
;; DATA VARIABLES
;; ============================================

(define-data-var market-nonce uint u0)
(define-data-var protocol-paused bool false)
(define-data-var fee-recipient principal CONTRACT_OWNER)

;; ============================================
;; DATA MAPS
;; ============================================

;; Market data
(define-map markets
  uint  ;; market-id
  {
    creator: principal,
    target-price: uint,           ;; Price in cents (e.g., 15000000 = $150,000)
    settlement-block: uint,       ;; Bitcoin block height
    yes-pool: uint,               ;; Total sBTC on YES
    no-pool: uint,                ;; Total sBTC on NO
    settled: bool,
    winning-side: (optional bool), ;; true = YES won, false = NO won
    settlement-price: uint,       ;; Actual price at settlement
    description: (string-utf8 256)
  }
)

;; User positions
(define-map positions
  { user: principal, market-id: uint }
  {
    yes-amount: uint,
    no-amount: uint,
    claimed: bool
  }
)

;; ============================================
;; READ-ONLY FUNCTIONS
;; ============================================

(define-read-only (get-market (market-id uint))
  (map-get? markets market-id)
)

(define-read-only (get-position (user principal) (market-id uint))
  (map-get? positions { user: user, market-id: market-id })
)

(define-read-only (get-odds (market-id uint))
  (match (map-get? markets market-id)
    market
    (let
      (
        (yes-pool (get yes-pool market))
        (no-pool (get no-pool market))
        (total (+ yes-pool no-pool))
      )
      (ok {
        yes-pool: yes-pool,
        no-pool: no-pool,
        total-pool: total,
        yes-odds: (if (> total u0) (/ (* yes-pool u10000) total) u5000),
        no-odds: (if (> total u0) (/ (* no-pool u10000) total) u5000)
      })
    )
    ERR_MARKET_NOT_FOUND
  )
)

(define-read-only (get-market-count)
  (var-get market-nonce)
)

(define-read-only (is-paused)
  (var-get protocol-paused)
)

(define-read-only (calculate-payout (market-id uint) (user principal))
  (match (map-get? markets market-id)
    market
    (if (not (get settled market))
      (ok u0)
      (match (get winning-side market)
        winning
        (match (map-get? positions { user: user, market-id: market-id })
          position
          (let
            (
              (user-bet (if winning (get yes-amount position) (get no-amount position)))
              (winning-pool (if winning (get yes-pool market) (get no-pool market)))
              (total-pool (+ (get yes-pool market) (get no-pool market)))
              (fee (/ (* total-pool PROTOCOL_FEE_BPS) u10000))
              (payout-pool (- total-pool fee))
            )
            (if (> user-bet u0)
              (ok (/ (* payout-pool user-bet) winning-pool))
              (ok u0)
            )
          )
          (ok u0)
        )
        (ok u0)
      )
    )
    ERR_MARKET_NOT_FOUND
  )
)

;; ============================================
;; PUBLIC FUNCTIONS
;; ============================================

;; Create a new prediction market
(define-public (create-market (target-price uint) (settlement-block uint) (description (string-utf8 256)))
  (let
    (
      (market-id (var-get market-nonce))
      (current-block burn-block-height)
    )
    ;; Validations
    (asserts! (not (var-get protocol-paused)) ERR_PAUSED)
    (asserts! (> target-price u0) ERR_INVALID_AMOUNT)
    (asserts! (>= settlement-block (+ current-block MIN_SETTLEMENT_DELAY)) ERR_SETTLEMENT_TOO_SOON)

    ;; Create market
    (map-set markets market-id {
      creator: tx-sender,
      target-price: target-price,
      settlement-block: settlement-block,
      yes-pool: u0,
      no-pool: u0,
      settled: false,
      winning-side: none,
      settlement-price: u0,
      description: description
    })

    ;; Increment nonce
    (var-set market-nonce (+ market-id u1))

    ;; Emit event
    (print {
      event: "market-created",
      market-id: market-id,
      creator: tx-sender,
      target-price: target-price,
      settlement-block: settlement-block,
      description: description
    })

    (ok market-id)
  )
)

;; Bet YES (BTC will be >= target price)
(define-public (bet-yes (market-id uint) (amount uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR_MARKET_NOT_FOUND))
      (current-position (default-to
        { yes-amount: u0, no-amount: u0, claimed: false }
        (map-get? positions { user: tx-sender, market-id: market-id })
      ))
    )
    ;; Validations
    (asserts! (not (var-get protocol-paused)) ERR_PAUSED)
    (asserts! (>= amount MIN_BET) ERR_INVALID_AMOUNT)
    (asserts! (not (get settled market)) ERR_MARKET_CLOSED)
    (asserts! (< burn-block-height (get settlement-block market)) ERR_MARKET_CLOSED)

    ;; Transfer sBTC to contract
    (unwrap! (contract-call? SBTC_CONTRACT transfer amount tx-sender (as-contract tx-sender) none) ERR_TRANSFER_FAILED)

    ;; Update position
    (map-set positions { user: tx-sender, market-id: market-id } {
      yes-amount: (+ (get yes-amount current-position) amount),
      no-amount: (get no-amount current-position),
      claimed: false
    })

    ;; Update market pool
    (map-set markets market-id (merge market { yes-pool: (+ (get yes-pool market) amount) }))

    ;; Emit event
    (print {
      event: "bet-placed",
      market-id: market-id,
      user: tx-sender,
      side: "yes",
      amount: amount
    })

    (ok true)
  )
)

;; Bet NO (BTC will be < target price)
(define-public (bet-no (market-id uint) (amount uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR_MARKET_NOT_FOUND))
      (current-position (default-to
        { yes-amount: u0, no-amount: u0, claimed: false }
        (map-get? positions { user: tx-sender, market-id: market-id })
      ))
    )
    ;; Validations
    (asserts! (not (var-get protocol-paused)) ERR_PAUSED)
    (asserts! (>= amount MIN_BET) ERR_INVALID_AMOUNT)
    (asserts! (not (get settled market)) ERR_MARKET_CLOSED)
    (asserts! (< burn-block-height (get settlement-block market)) ERR_MARKET_CLOSED)

    ;; Transfer sBTC to contract
    (unwrap! (contract-call? SBTC_CONTRACT transfer amount tx-sender (as-contract tx-sender) none) ERR_TRANSFER_FAILED)

    ;; Update position
    (map-set positions { user: tx-sender, market-id: market-id } {
      yes-amount: (get yes-amount current-position),
      no-amount: (+ (get no-amount current-position) amount),
      claimed: false
    })

    ;; Update market pool
    (map-set markets market-id (merge market { no-pool: (+ (get no-pool market) amount) }))

    ;; Emit event
    (print {
      event: "bet-placed",
      market-id: market-id,
      user: tx-sender,
      side: "no",
      amount: amount
    })

    (ok true)
  )
)

;; Settle market - anyone can call after settlement block
(define-public (settle (market-id uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR_MARKET_NOT_FOUND))
    )
    ;; Validations
    (asserts! (not (get settled market)) ERR_ALREADY_SETTLED)
    (asserts! (>= burn-block-height (get settlement-block market)) ERR_SETTLEMENT_TOO_SOON)

    ;; Get BTC price from Pyth
    (let
      (
        (price-data (unwrap! (contract-call? PYTH_ORACLE read-price-feed BTC_FEED_ID PYTH_STORAGE) ERR_TRANSFER_FAILED))
        (btc-price (get price price-data))
        (target (get target-price market))
        (yes-wins (>= btc-price (to-int target)))
        (total-pool (+ (get yes-pool market) (get no-pool market)))
        (fee-amount (/ (* total-pool PROTOCOL_FEE_BPS) u10000))
      )
      ;; Transfer fee to recipient
      (if (> fee-amount u0)
        (try! (as-contract (contract-call? SBTC_CONTRACT transfer fee-amount tx-sender (var-get fee-recipient) none)))
        true
      )

      ;; Update market as settled
      (map-set markets market-id (merge market {
        settled: true,
        winning-side: (some yes-wins),
        settlement-price: (to-uint btc-price)
      }))

      ;; Emit event
      (print {
        event: "market-settled",
        market-id: market-id,
        settlement-price: btc-price,
        target-price: target,
        winning-side: (if yes-wins "yes" "no"),
        total-pool: total-pool,
        fee: fee-amount
      })

      (ok yes-wins)
    )
  )
)

;; Claim winnings
(define-public (claim (market-id uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR_MARKET_NOT_FOUND))
      (position (unwrap! (map-get? positions { user: tx-sender, market-id: market-id }) ERR_NO_POSITION))
      (winning (unwrap! (get winning-side market) ERR_MARKET_NOT_SETTLED))
    )
    ;; Validations
    (asserts! (get settled market) ERR_MARKET_NOT_SETTLED)
    (asserts! (not (get claimed position)) ERR_ALREADY_CLAIMED)

    (let
      (
        (user-bet (if winning (get yes-amount position) (get no-amount position)))
        (winning-pool (if winning (get yes-pool market) (get no-pool market)))
        (total-pool (+ (get yes-pool market) (get no-pool market)))
        (fee (/ (* total-pool PROTOCOL_FEE_BPS) u10000))
        (payout-pool (- total-pool fee))
        (payout (/ (* payout-pool user-bet) winning-pool))
      )
      ;; Must have bet on winning side
      (asserts! (> user-bet u0) ERR_WRONG_SIDE)

      ;; Mark as claimed
      (map-set positions { user: tx-sender, market-id: market-id } (merge position { claimed: true }))

      ;; Transfer payout
      (try! (as-contract (contract-call? SBTC_CONTRACT transfer payout tx-sender tx-sender none)))

      ;; Emit event
      (print {
        event: "payout-claimed",
        market-id: market-id,
        user: tx-sender,
        amount: payout
      })

      (ok payout)
    )
  )
)

;; ============================================
;; ADMIN FUNCTIONS
;; ============================================

(define-public (set-paused (paused bool))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_NOT_AUTHORIZED)
    (var-set protocol-paused paused)
    (print { event: "pause-toggled", paused: paused })
    (ok true)
  )
)

(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_NOT_AUTHORIZED)
    (var-set fee-recipient new-recipient)
    (print { event: "fee-recipient-updated", recipient: new-recipient })
    (ok true)
  )
)
