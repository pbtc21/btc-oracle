;; Mock sBTC for local testing
;; NOT deployed to mainnet - only for Clarinet check

(define-fungible-token sbtc)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (try! (ft-transfer? sbtc amount sender recipient))
    (ok true)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (ft-mint? sbtc amount recipient)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance sbtc account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply sbtc))
)
