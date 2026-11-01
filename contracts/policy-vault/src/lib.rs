//! Exact, policy-bound NEAR agent spending. The owner pins an independently attested executor key.
//! Intel attestation and hidden recipient/quote bindings are verified off-chain by that pinned TEE.
use near_sdk::{
    borsh, env, ext_contract, near, store::LookupMap, AccountId, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue, PromiseError, json_types::{U128, U64},
};

const DAY_MS: u64 = 86_400_000;
const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);
const FT_GAS: Gas = Gas::from_tgas(30);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub daily_limit: U128,
    pub per_action_limit: U128,
    pub max_slippage_bps: u16,
    pub max_quote_age_ms: U64,
    pub venue_commitments: Vec<String>,
    pub counterparty_commitments: Vec<String>,
    pub output_assets: Vec<String>,
    pub require_confidential: bool,
    pub paused: bool,
}
impl Policy {
    fn validate(&self) {
        assert!(self.daily_limit.0 > 0, "ZERO_DAILY_LIMIT");
        assert!(self.per_action_limit.0 > 0 && self.per_action_limit.0 <= self.daily_limit.0, "INVALID_PER_ACTION_LIMIT");
        assert!(self.max_slippage_bps <= 1_000, "SLIPPAGE_POLICY_TOO_HIGH");
        assert!((5_000..=300_000).contains(&self.max_quote_age_ms.0), "INVALID_QUOTE_AGE");
        for values in [&self.venue_commitments, &self.counterparty_commitments] {
            assert!(!values.is_empty() && values.len() <= 32, "INVALID_ALLOWLIST_SIZE");
            for (i, value) in values.iter().enumerate() {
                assert!(is_hash(value), "INVALID_COMMITMENT");
                assert!(!values[..i].contains(value), "DUPLICATE_ALLOWLIST_ENTRY");
            }
        }
        assert!(!self.output_assets.is_empty() && self.output_assets.len() <= 16, "INVALID_OUTPUT_ASSETS");
        for (i, asset) in self.output_assets.iter().enumerate() {
            assert!(!asset.is_empty() && asset.len() <= 200, "INVALID_OUTPUT_ASSET");
            assert!(!self.output_assets[..i].contains(asset), "DUPLICATE_OUTPUT_ASSET");
        }
    }
}

/// Borsh field order is the signing protocol. SHA-256 these bytes, then Ed25519-sign the digest.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Authorization {
    pub domain: String,
    pub network: String,
    pub vault: AccountId,
    pub policy_version: U64,
    pub nonce: U64,
    pub amount: U128,
    pub quoted_output: U128,
    pub minimum_output: U128,
    pub slippage_bps: u16,
    pub quoted_at_ms: U64,
    pub expires_at_ms: U64,
    pub venue_commitment: String,
    pub strategy_venue_commitment: Option<String>,
    pub counterparty_commitment: String,
    pub deposit_account: AccountId,
    pub output_asset: String,
    pub quote_hash: String,
    pub confidential: bool,
    /// 0 = private payment, 1 = allocation reserve. No arbitrary call or lending adapter.
    pub action: u8,
    pub audit_hash: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status { Pending, Dispatched, DispatchFailed, Unknown, Settled, Refunded }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Record {
    pub day: U64,
    pub amount: U128,
    pub authorization_hash: String,
    pub quote_hash: String,
    pub audit_hash: String,
    pub status: Status,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Settlement {
    pub domain: String,
    pub network: String,
    pub vault: AccountId,
    pub nonce: U64,
    pub quote_hash: String,
    /// 0 = unknown, 1 = settled, 2 = refunded. Refunded never replenishes spending allowance.
    pub outcome: u8,
    pub audit_hash: String,
}
#[near(serializers = [json])]
pub struct Budget {
    pub day: U64,
    pub used: U128,
    pub remaining: U128,
    pub policy_version: U64,
    pub next_nonce: U64,
    pub paused: bool,
}
#[near(serializers = [json])]
pub struct Configuration {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub network: String,
    pub executor_public_key: String,
    pub policy: Policy,
    pub policy_version: U64,
}

#[allow(dead_code)]
#[ext_contract(ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
#[allow(dead_code)]
#[ext_contract(callbacks)]
trait Callbacks { fn on_dispatch(&mut self, nonce: U64) -> bool; }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner_id: AccountId,
    token_id: AccountId,
    network: String,
    executor_public_key: String,
    policy: Policy,
    policy_version: u64,
    next_nonce: u64,
    used: LookupMap<u64, u128>,
    records: LookupMap<u64, Record>,
}
#[near]
impl Vault {
    #[init]
    pub fn new(owner_id: AccountId, token_id: AccountId, network: String, executor_public_key: String, policy: Policy) -> Self {
        assert!(network == "mainnet" || network == "testnet", "UNSUPPORTED_NETWORK");
        policy.validate();
        validate_key(&executor_public_key);
        Self { owner_id, token_id, network, executor_public_key, policy, policy_version: 1, next_nonce: 0, used: LookupMap::new(b"u"), records: LookupMap::new(b"r") }
    }
    pub fn get_config(&self) -> Configuration {
        Configuration { owner_id: self.owner_id.clone(), token_id: self.token_id.clone(), network: self.network.clone(), executor_public_key: self.executor_public_key.clone(), policy: self.policy.clone(), policy_version: U64(self.policy_version) }
    }
    pub fn get_budget(&self) -> Budget {
        let day = env::block_timestamp_ms() / DAY_MS;
        let used = self.used.get(&day).copied().unwrap_or(0);
        Budget { day: U64(day), used: U128(used), remaining: U128(self.policy.daily_limit.0.saturating_sub(used)), policy_version: U64(self.policy_version), next_nonce: U64(self.next_nonce), paused: self.policy.paused }
    }
    pub fn get_record(&self, nonce: U64) -> Option<Record> { self.records.get(&nonce.0).cloned() }

    /// Compare-and-swap: neither usage nor nonce is reset by an owner policy change.
    pub fn set_policy(&mut self, policy: Policy, expected_version: U64) {
        self.assert_owner();
        assert_eq!(expected_version.0, self.policy_version, "POLICY_CONFLICT");
        policy.validate(); self.policy = policy; self.bump_version();
        event("policy_updated", near_sdk::serde_json::json!({"version": self.policy_version.to_string()}));
    }
    /// The owner must independently verify hardware evidence before pinning this key.
    pub fn set_executor_key(&mut self, public_key: String, expected_version: U64) {
        self.assert_owner();
        assert_eq!(expected_version.0, self.policy_version, "POLICY_CONFLICT");
        validate_key(&public_key); self.executor_public_key = public_key; self.bump_version();
        event("executor_rotated", near_sdk::serde_json::json!({"version": self.policy_version.to_string()}));
    }
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner(); self.policy.paused = paused; self.bump_version();
        event("pause_changed", near_sdk::serde_json::json!({"paused": paused, "version": self.policy_version.to_string()}));
    }

    /// Relayer-funded storage. The input asset contract is fixed at initialization.
    #[payable]
    pub fn authorize(&mut self, authorization: Authorization, signature: String) -> Promise {
        assert!(env::attached_deposit() >= STORAGE_DEPOSIT, "ATTACH_0.01_NEAR_FOR_STORAGE");
        assert!(env::prepaid_gas() >= Gas::from_tgas(80), "INSUFFICIENT_GAS");
        let a = &authorization;
        self.validate_authorization(a, &signature);
        let day = env::block_timestamp_ms() / DAY_MS;
        let used = self.used.get(&day).copied().unwrap_or(0);
        let new_used = used.checked_add(a.amount.0).expect("DAILY_OVERFLOW");
        assert!(new_used <= self.policy.daily_limit.0, "DAILY_LIMIT");
        // All checks precede mutation. Reserve before any external receipt executes.
        self.next_nonce = self.next_nonce.checked_add(1).expect("NONCE_EXHAUSTED");
        self.used.insert(day, new_used);
        let digest = authorization_hash(a);
        self.records.insert(a.nonce.0, Record { day: U64(day), amount: a.amount, authorization_hash: digest.clone(), quote_hash: a.quote_hash.clone(), audit_hash: a.audit_hash.clone(), status: Status::Pending });
        event("authorized", near_sdk::serde_json::json!({"nonce": a.nonce, "hash": digest, "audit_hash": a.audit_hash, "amount": a.amount, "day": day.to_string()}));
        ft::ext(self.token_id.clone()).with_attached_deposit(NearToken::from_yoctonear(1)).with_static_gas(FT_GAS)
            .ft_transfer(a.deposit_account.clone(), a.amount, None)
            .then(callbacks::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_dispatch(a.nonce))
    }

    #[private]
    pub fn on_dispatch(&mut self, nonce: U64) -> bool {
        assert_eq!(env::promise_results_count(), 1, "INVALID_CALLBACK");
        let record = self.records.get_mut(&nonce.0).expect("UNKNOWN_AUTHORIZATION");
        assert_eq!(record.status, Status::Pending, "ALREADY_DISPATCHED");
        // TooLong still means the receipt SUCCEEDED. Never refund quota for an oversized
        // successful result; only an actual failed receipt can restore allowance.
        let success = !matches!(env::promise_result_checked(0, 32), Err(PromiseError::Failed));
        if success {
            record.status = Status::Dispatched;
        } else {
            // Refund the ORIGINAL UTC day, never the callback's day.
            let day = record.day.0;
            let old = self.used.get(&day).copied().expect("MISSING_USAGE");
            self.used.insert(day, old.checked_sub(record.amount.0).expect("USAGE_UNDERFLOW"));
            record.status = Status::DispatchFailed;
        }
        event("dispatch_observed", near_sdk::serde_json::json!({"nonce": nonce, "success": success}));
        success
    }

    /// Attested-observer evidence; NEAR does not itself prove a cross-chain receipt here.
    pub fn record_settlement(&mut self, settlement: Settlement, signature: String) {
        let s = &settlement;
        assert!(s.domain == "neslos:settlement:v1" && s.network == self.network && s.vault == env::current_account_id(), "WRONG_DOMAIN");
        assert!(s.outcome <= 2 && is_hash(&s.quote_hash) && is_hash(&s.audit_hash), "INVALID_SETTLEMENT");
        verify_signature(&borsh::to_vec(s).expect("SERIALIZATION"), &signature, &self.executor_public_key);
        let record = self.records.get_mut(&s.nonce.0).expect("UNKNOWN_AUTHORIZATION");
        assert_eq!(record.quote_hash, s.quote_hash, "WRONG_QUOTE");
        assert!(record.status == Status::Dispatched || record.status == Status::Unknown, "INVALID_TRANSITION");
        assert!(!(record.status == Status::Unknown && s.outcome == 0), "DUPLICATE_OUTCOME");
        record.status = match s.outcome { 0 => Status::Unknown, 1 => Status::Settled, _ => Status::Refunded };
        record.audit_hash = s.audit_hash.clone();
        // A timeout or late provider refund never increases allowance.
        event("settlement_observed", near_sdk::serde_json::json!({"nonce": s.nonce, "status": record.status, "audit_hash": s.audit_hash}));
    }

    /// Accept only the configured token. Direct FT transfers also work: the token holds balances.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = (sender_id, msg);
        if env::predecessor_account_id() != self.token_id { return PromiseOrValue::Value(amount); }
        PromiseOrValue::Value(U128(0))
    }
    /// Owner recovery is separate from agent authority, and requires pausing first.
    #[payable]
    pub fn withdraw_owner(&mut self, amount: U128) -> Promise {
        self.assert_owner(); near_sdk::assert_one_yocto();
        assert!(self.policy.paused && amount.0 > 0, "PAUSE_BEFORE_RECOVERY");
        ft::ext(self.token_id.clone()).with_attached_deposit(NearToken::from_yoctonear(1)).with_static_gas(FT_GAS)
            .ft_transfer(self.owner_id.clone(), amount, Some("Neslos owner recovery".to_owned()))
    }
}
impl Vault {
    fn assert_owner(&self) { assert_eq!(env::predecessor_account_id(), self.owner_id, "OWNER_ONLY"); }
    fn bump_version(&mut self) { self.policy_version = self.policy_version.checked_add(1).expect("VERSION_EXHAUSTED"); }
    fn validate_authorization(&self, a: &Authorization, signature: &str) {
        assert!(!self.policy.paused, "PAUSED");
        assert!(a.domain == "neslos:authorize:v1" && a.network == self.network && a.vault == env::current_account_id(), "WRONG_DOMAIN");
        assert_eq!(a.policy_version.0, self.policy_version, "POLICY_VERSION");
        assert_eq!(a.nonce.0, self.next_nonce, "NONCE");
        assert!(a.amount.0 > 0 && a.amount.0 <= self.policy.per_action_limit.0, "PER_ACTION_LIMIT");
        assert!(self.policy.venue_commitments.contains(&a.venue_commitment), "VENUE");
        if let Some(strategy) = &a.strategy_venue_commitment { assert!(self.policy.venue_commitments.contains(strategy), "STRATEGY_VENUE"); }
        assert!(self.policy.counterparty_commitments.contains(&a.counterparty_commitment), "COUNTERPARTY");
        assert!(self.policy.output_assets.contains(&a.output_asset), "OUTPUT_ASSET");
        assert!(a.action <= 1, "UNSUPPORTED_ACTION");
        assert!(!self.policy.require_confidential || a.confidential, "CONFIDENTIAL_REQUIRED");
        assert!(a.slippage_bps <= self.policy.max_slippage_bps, "SLIPPAGE");
        let minimum = output_floor(a.quoted_output.0, a.slippage_bps);
        assert!(a.quoted_output.0 > 0 && a.minimum_output.0 > 0 && a.minimum_output.0 >= minimum && a.minimum_output.0 <= a.quoted_output.0, "OUTPUT_FLOOR");
        let now = env::block_timestamp_ms();
        assert!(a.quoted_at_ms.0 <= now && now - a.quoted_at_ms.0 <= self.policy.max_quote_age_ms.0, "STALE_QUOTE");
        assert!(a.expires_at_ms.0 > now && a.expires_at_ms.0 > a.quoted_at_ms.0 && a.expires_at_ms.0 - a.quoted_at_ms.0 <= 300_000, "EXPIRED");
        assert!(is_hash(&a.quote_hash) && is_hash(&a.audit_hash), "INVALID_HASH");
        verify_signature(&borsh::to_vec(a).expect("SERIALIZATION"), signature, &self.executor_public_key);
    }
}
/// ceil(quote * (10000 - bps) / 10000), without overflowing a u128 intermediate.
pub fn output_floor(quote: u128, bps: u16) -> u128 {
    assert!(bps <= 10_000, "INVALID_SLIPPAGE");
    let factor = u128::from(10_000 - bps);
    (quote / 10_000) * factor + ((quote % 10_000) * factor).div_ceil(10_000)
}
pub fn authorization_hash(a: &Authorization) -> String { hex::encode(env::sha256(&borsh::to_vec(a).expect("SERIALIZATION"))) }
fn is_hash(value: &str) -> bool { value.len() == 64 && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }
fn validate_key(value: &str) { assert!(is_hash(value) && value != "0".repeat(64), "INVALID_EXECUTOR_KEY"); }
fn verify_signature(bytes: &[u8], signature: &str, public_key: &str) {
    let sig: [u8; 64] = hex::decode(signature).expect("INVALID_SIGNATURE_HEX").try_into().expect("INVALID_SIGNATURE_LENGTH");
    let key: [u8; 32] = hex::decode(public_key).expect("INVALID_KEY").try_into().expect("INVALID_KEY_LENGTH");
    assert!(env::ed25519_verify(&sig, &env::sha256(bytes), &key), "INVALID_SIGNATURE");
}
fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", near_sdk::serde_json::json!({"standard":"neslos", "version":"1.0.0", "event": name, "data": [data]})));
}
#[cfg(test)]
mod tests;
