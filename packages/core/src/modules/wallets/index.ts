// Public API of the wallets module (spec 0004). Writers take `tx: Tx` first;
// readers take `db: Db | Tx`. A wallet is always found by its user id.

/** ₦10,000 in kobo, the sign up test deposit. */
export { SIGN_UP_TEST_DEPOSIT } from './wallets.ts';

/** Opens a user's wallet and posts the sign up test deposit; run it in the same unit of work as `registerUser`. */
export { openWallet, type Wallet } from './wallets.ts';

/** A user's wallet and balance, or null when the user has none (the caller answers 401). */
export { getWallet } from './wallets.ts';

/** A user's wallet entries newest first, paginated by `cursor` and `limit` (already validated), or null as above. */
export { listWalletHistory, type WalletHistoryItem, type WalletHistoryPage } from './wallets.ts';
