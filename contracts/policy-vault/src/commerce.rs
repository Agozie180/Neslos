//! Public owner commerce is separate from the attested authorization protocol.
//! No new state fields: existing deployments retain their policy, nonce and usage.
use super::*;

const RHEA_MAINNET: &str = "contract.main.burrow.near";
const RHEA_TESTNET: &str = "contract.1689937928.burrow.testnet";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CommerceRequestV1 {
    pub domain: String,
    pub network: String,
    pub vault: AccountId,
    pub policy_version: U64,
    pub nonce: U64,
    /// 0 = exact public FT payment, 1 = non-collateral Rhea supply, 2 = Rhea withdrawal.
    pub action: u8,
    /// Configured-token base units. Withdrawals also consume allowance and never refill it.
    pub amount: U128,
    pub target: AccountId,
    pub venue: String,
    pub venue_salt: String,
    pub counterparty_salt: String,
    pub quoted_at_ms: U64,
    pub expires_at_ms: U64,
    pub quote_hash: String,
    pub audit_hash: String,
}

#[near(serializers = [json])]
struct RheaAsset {
    token_id: AccountId,
    supplied: RheaBalance,
    config: RheaAssetConfig,
}
#[near(serializers = [json])]
struct RheaAssetConfig { extra_decimals: u8, can_deposit: bool, can_withdraw: bool, supplied_limit: Option<U128> }
#[near(serializers = [json])]
struct RheaPosition { account_id: AccountId, borrowed: Vec<RheaBalance> }
#[near(serializers = [json])]
struct RheaBalance { balance: U128 }

#[near]
impl Vault {
    /// An owner transaction is the authorization. All spend limits still execute on-chain.
    /// This interface accepts no arbitrary method, FT message, debt or collateral action.
    #[payable]
    pub fn execute_commerce_v1(&mut self, request: CommerceRequestV1) -> Promise {
        self.assert_owner();
        assert!(env::attached_deposit() >= STORAGE_DEPOSIT, "ATTACH_0.01_NEAR_FOR_STORAGE");
        assert!(env::prepaid_gas() >= Gas::from_tgas(300), "INSUFFICIENT_GAS");
        self.validate_commerce(&request);
        let r = &request;
        let day = env::block_timestamp_ms() / DAY_MS;
        let used = self.used.get(&day).copied().unwrap_or(0);
        let new_used = used.checked_add(r.amount.0).expect("DAILY_OVERFLOW");
        assert!(new_used <= self.policy.daily_limit.0, "DAILY_LIMIT");
        let next_nonce = self.next_nonce.checked_add(1).expect("NONCE_EXHAUSTED");
        let digest = commerce_hash(r);
        self.next_nonce = next_nonce;
        self.used.insert(day, new_used);
        self.records.insert(r.nonce.0, Record { day: U64(day), amount: r.amount, authorization_hash: digest.clone(), quote_hash: r.quote_hash.clone(), audit_hash: r.audit_hash.clone(), status: Status::Pending });
        event("commerce_authorized", near_sdk::serde_json::json!({"nonce":r.nonce,"hash":digest,"action":r.action,"target":r.target,"amount":r.amount,"day":day.to_string(),"audit_hash":r.audit_hash}));
        if r.action == 0 {
            return ft::ext(self.token_id.clone()).with_attached_deposit(NearToken::from_yoctonear(1)).with_static_gas(FT_GAS)
                .ft_transfer(r.target.clone(), r.amount, None)
                .then(commerce_callback("on_commerce_dispatch_v1", near_sdk::serde_json::json!({"nonce":r.nonce,"action":r.action}), 15));
        }
        // The configured protocol supplies its own conversion factor. The caller cannot
        // turn a small base-unit authorization into a larger protocol-unit withdrawal.
        let asset = call(r.target.clone(), "get_asset", near_sdk::serde_json::json!({"token_id":self.token_id}), 0, 10);
        let account = call(r.target.clone(), "get_account", near_sdk::serde_json::json!({"account_id":env::current_account_id()}), 0, 10);
        asset.and(account).then(commerce_callback("on_commerce_preflight_v1", near_sdk::serde_json::json!({"request":request}), 220))
    }

    #[private]
    pub fn on_commerce_preflight_v1(&mut self, request: CommerceRequestV1) -> PromiseOrValue<bool> {
        assert_eq!(env::promise_results_count(), 2, "INVALID_CALLBACK");
        let r = &request;
        let record = self.records.get(&r.nonce.0).expect("UNKNOWN_AUTHORIZATION");
        assert_eq!(record.status, Status::Pending, "ALREADY_DISPATCHED");
        assert_eq!(record.authorization_hash, commerce_hash(r), "COMMERCE_CALLBACK_BINDING");
        let asset: Option<RheaAsset> = promise_json(0);
        let account: Option<Option<RheaPosition>> = promise_json(1);
        let factor = asset.as_ref().filter(|a| a.token_id == self.token_id && a.config.extra_decimals <= 24)
            .and_then(|a| 10u128.checked_pow(u32::from(a.config.extra_decimals)));
        let protocol_amount = factor.and_then(|f| r.amount.0.checked_mul(f));
        let debt_free = matches!(&account, Some(None)) || matches!(&account, Some(Some(a)) if a.account_id == env::current_account_id() && a.borrowed.iter().all(|b| b.balance.0 == 0));
        let enabled = asset.as_ref().is_some_and(|a| if r.action == 1 { a.config.can_deposit } else { a.config.can_withdraw });
        let below_supply_cap = r.action != 1 || asset.as_ref().is_some_and(|a| match a.config.supplied_limit {
            None => true,
            Some(limit) => protocol_amount.and_then(|amount| a.supplied.balance.0.checked_add(amount)).is_some_and(|total| total <= limit.0),
        });
        let now = env::block_timestamp_ms();
        // A governance change or expiry while reads were in flight cancels before spend.
        if self.policy.paused || self.policy.require_confidential || self.policy_version != r.policy_version.0
            || now / DAY_MS != record.day.0 || now.saturating_sub(r.quoted_at_ms.0) > self.policy.max_quote_age_ms.0
            || now >= r.expires_at_ms.0 || !debt_free || !enabled || !below_supply_cap || protocol_amount.is_none() {
            self.commerce_result(r.nonce, r.action, Status::DispatchFailed, true);
            return PromiseOrValue::Value(false);
        }
        let dispatch = if r.action == 1 {
            call(self.token_id.clone(), "ft_transfer_call", near_sdk::serde_json::json!({"receiver_id":r.target,"amount":r.amount,"msg":""}), 1, 180)
        } else {
            call(r.target.clone(), "execute", near_sdk::serde_json::json!({"actions":[{"Withdraw":{"token_id":self.token_id,"max_amount":U128(protocol_amount.unwrap())}}]}), 1, 180)
        };
        PromiseOrValue::Promise(dispatch.then(commerce_callback("on_commerce_dispatch_v1", near_sdk::serde_json::json!({"nonce":r.nonce,"action":r.action}), 15)))
    }

    #[private]
    pub fn on_commerce_dispatch_v1(&mut self, nonce: U64, action: u8) -> bool {
        assert_eq!(env::promise_results_count(), 1, "INVALID_CALLBACK");
        assert!(action <= 2, "UNSUPPORTED_ACTION");
        let record = self.records.get(&nonce.0).expect("UNKNOWN_AUTHORIZATION");
        assert_eq!(record.status, Status::Pending, "ALREADY_DISPATCHED");
        let result = env::promise_result_checked(0, 64);
        let status = match action {
            0 => if matches!(result, Err(PromiseError::Failed)) { Status::DispatchFailed } else { Status::Dispatched },
            1 => match result.ok().and_then(|bytes| near_sdk::serde_json::from_slice::<U128>(&bytes).ok()) {
                Some(used) if used == record.amount => Status::Dispatched,
                Some(U128(0)) => Status::Refunded,
                _ => Status::Unknown,
            },
            _ => if result.is_ok() { Status::Dispatched } else { Status::Unknown },
        };
        let success = status == Status::Dispatched;
        // A failed transfer_call/execute can hide successful child receipts. Never release
        // their quota from top-level failure, malformed output, partial use or a refund.
        let release = action == 0 && status == Status::DispatchFailed;
        self.commerce_result(nonce, action, status, release);
        success
    }
}

impl Vault {
    fn validate_commerce(&self, r: &CommerceRequestV1) {
        assert!(!self.policy.paused, "PAUSED");
        assert!(!self.policy.require_confidential, "CONFIDENTIAL_REQUIRED");
        assert!(r.domain == "neslos:commerce:v1" && r.network == self.network && r.vault == env::current_account_id(), "WRONG_DOMAIN");
        assert_eq!(r.policy_version.0, self.policy_version, "POLICY_VERSION");
        assert_eq!(r.nonce.0, self.next_nonce, "NONCE");
        assert!(r.action <= 2, "UNSUPPORTED_ACTION");
        assert!(r.amount.0 > 0 && r.amount.0 <= self.policy.per_action_limit.0, "PER_ACTION_LIMIT");
        assert!(r.target != env::current_account_id(), "INVALID_TARGET");
        assert!(!r.venue.is_empty() && r.venue.len() <= 100, "INVALID_VENUE");
        assert!(self.policy.venue_commitments.contains(&opening("venue", &r.venue, &r.venue_salt)), "VENUE");
        assert!(self.policy.counterparty_commitments.contains(&opening("counterparty", r.target.as_str(), &r.counterparty_salt)), "COUNTERPARTY");
        assert!(self.policy.output_assets.contains(&format!("nep141:{}", self.token_id)), "OUTPUT_ASSET");
        if r.action != 0 {
            assert_eq!(r.venue, "rhea", "RHEA_VENUE");
            assert_eq!(r.target.as_str(), if self.network == "mainnet" { RHEA_MAINNET } else { RHEA_TESTNET }, "RHEA_CONTRACT");
        }
        let now = env::block_timestamp_ms();
        assert!(r.quoted_at_ms.0 <= now && now - r.quoted_at_ms.0 <= self.policy.max_quote_age_ms.0, "STALE_QUOTE");
        assert!(r.expires_at_ms.0 > now && r.expires_at_ms.0 > r.quoted_at_ms.0 && r.expires_at_ms.0 - r.quoted_at_ms.0 <= 300_000, "EXPIRED");
        assert!(is_hash(&r.quote_hash) && is_hash(&r.audit_hash), "INVALID_HASH");
    }

    fn commerce_result(&mut self, nonce: U64, action: u8, status: Status, release: bool) {
        let record = self.records.get_mut(&nonce.0).expect("UNKNOWN_AUTHORIZATION");
        if release {
            let old = self.used.get(&record.day.0).copied().expect("MISSING_USAGE");
            self.used.insert(record.day.0, old.checked_sub(record.amount.0).expect("USAGE_UNDERFLOW"));
        }
        record.status = status.clone();
        event("commerce_dispatch_observed", near_sdk::serde_json::json!({"nonce":nonce,"action":action,"status":status}));
    }
}

fn commerce_hash(r: &CommerceRequestV1) -> String { hex::encode(env::sha256(&borsh::to_vec(r).expect("SERIALIZATION"))) }
/// Exact canonical JSON counterpart of src/core/crypto.ts::commitment.
pub(crate) fn opening(kind: &str, value: &str, salt: &str) -> String {
    assert!(is_hash(salt), "INVALID_SALT");
    let value = near_sdk::serde_json::to_string(value).expect("SERIALIZATION");
    hex::encode(env::sha256(format!("{{\"domain\":\"neslos:{kind}:v1\",\"salt\":\"{salt}\",\"value\":{value}}}").as_bytes()))
}
fn call(target: AccountId, method: &str, args: near_sdk::serde_json::Value, deposit: u128, gas: u64) -> Promise {
    Promise::new(target).function_call(method.to_owned(), near_sdk::serde_json::to_vec(&args).expect("SERIALIZATION"), NearToken::from_yoctonear(deposit), Gas::from_tgas(gas))
}
fn commerce_callback(method: &str, args: near_sdk::serde_json::Value, gas: u64) -> Promise { call(env::current_account_id(), method, args, 0, gas) }
fn promise_json<T: near_sdk::serde::de::DeserializeOwned>(index: u64) -> Option<T> {
    env::promise_result_checked(index, 32_768).ok().and_then(|bytes| near_sdk::serde_json::from_slice(&bytes).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer,SigningKey};
    use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};
    const NOW: u64 = 1_793_577_599_000;
    fn context(owner: &str, now: u64) -> near_sdk::VMContext {
        VMContextBuilder::new().current_account_id("vault.testnet".parse().unwrap())
            .predecessor_account_id(owner.parse().unwrap()).signer_account_id(owner.parse().unwrap())
            .block_timestamp(now * 1_000_000).attached_deposit(STORAGE_DEPOSIT).prepaid_gas(Gas::from_tgas(300)).build()
    }
    fn request(action: u8, nonce: u64) -> CommerceRequestV1 {
        CommerceRequestV1 { domain:"neslos:commerce:v1".into(),network:"testnet".into(),vault:"vault.testnet".parse().unwrap(),policy_version:U64(1),nonce:U64(nonce),action,amount:U128(100),target:if action == 0 { "payee.testnet" } else { RHEA_TESTNET }.parse().unwrap(),venue:if action == 0 { "public-payment" } else { "rhea" }.into(),venue_salt:"a".repeat(64),counterparty_salt:"b".repeat(64),quoted_at_ms:U64(NOW),expires_at_ms:U64(NOW+60_000),quote_hash:"c".repeat(64),audit_hash:"d".repeat(64) }
    }
    fn vault() -> Vault {
        near_sdk::mock::with_mocked_blockchain(|b| { b.take_storage(); });
        testing_env!(context("owner.testnet", NOW));
        let requests = [request(0,0), request(1,0)];
        let v=Vault::new("owner.testnet".parse().unwrap(),"token.testnet".parse().unwrap(),"testnet".into(),"a".repeat(64),Policy {
            daily_limit:U128(250),per_action_limit:U128(150),max_slippage_bps:50,max_quote_age_ms:U64(60_000),
            venue_commitments:requests.iter().map(|r|opening("venue",&r.venue,&r.venue_salt)).collect(),
            counterparty_commitments:requests.iter().map(|r|opening("counterparty",r.target.as_str(),&r.counterparty_salt)).collect(),
            output_assets:vec!["nep141:token.testnet".into()],require_confidential:false,paused:false });
        testing_env!(context("owner.testnet",NOW));v
    }
    fn callback(now: u64, results: Vec<PromiseResult>) {
        testing_env!(context("vault.testnet",now),near_sdk::test_vm_config(),near_sdk::RuntimeFeesConfig::test(),std::collections::HashMap::default(),results);
    }
    fn reads(extra: u8, debt: u128) -> Vec<PromiseResult> {
        [near_sdk::serde_json::json!({"token_id":"token.testnet","supplied":{"balance":"0"},"config":{"extra_decimals":extra,"can_deposit":true,"can_withdraw":true}}),
        near_sdk::serde_json::json!({"account_id":"vault.testnet","borrowed":[{"balance":debt.to_string()}]})].iter().map(|v|PromiseResult::Successful(near_sdk::serde_json::to_vec(v).unwrap())).collect()
    }
    #[test]
    fn public_request_cannot_change_opening_identity_or_policy() {
        let v=vault();
        let cases:Vec<Box<dyn Fn(&mut CommerceRequestV1)>>=vec![
            Box::new(|r|r.amount=U128(151)),Box::new(|r|r.amount=U128(0)),Box::new(|r|r.nonce=U64(1)),
            Box::new(|r|r.policy_version=U64(2)),Box::new(|r|r.network="mainnet".into()),
            Box::new(|r|r.target="attacker.testnet".parse().unwrap()),Box::new(|r|r.venue_salt="f".repeat(64)),
            Box::new(|r|r.counterparty_salt="f".repeat(64)),Box::new(|r|r.action=3),Box::new(|r|r.expires_at_ms=U64(NOW)),
        ];
        for mutate in cases { let mut r=request(0,0);mutate(&mut r);assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||v.validate_commerce(&r))).is_err()); }
        assert_eq!(v.get_budget().used.0,0);assert_eq!(v.next_nonce,0);
    }
    #[test]
    fn confidential_policy_rejects_all_public_actions() {
        let mut v=vault();v.policy.require_confidential=true;
        for action in 0..=2 { assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||v.validate_commerce(&request(action,0)))).is_err()); }
    }
    #[test]
    #[should_panic(expected="OWNER_ONLY")]
    fn relayer_cannot_use_owner_commerce() { let mut v=vault();testing_env!(context("relay.testnet",NOW));let _=v.execute_commerce_v1(request(0,0)); }
    #[test]
    fn commerce_reserves_shared_usage_and_nonce_before_reads() {
        let mut v=vault();let _=v.execute_commerce_v1(request(1,0));
        assert_eq!(v.get_budget().used.0,100);assert_eq!(v.next_nonce,1);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||v.validate_commerce(&request(0,0)))).is_err());
        let bytes=borsh::to_vec(&v).unwrap();let restored:Vault=borsh::from_slice(&bytes).unwrap();
        assert_eq!(restored.next_nonce,1);assert_eq!(restored.policy_version,1);
    }
    #[test]
    fn delayed_preflight_checks_governance_and_refunds_original_day() {
        let mut v=vault();let r=request(1,0);let _=v.execute_commerce_v1(r.clone());v.set_paused(true,None);
        let tomorrow=(NOW/DAY_MS+1)*DAY_MS+1;callback(tomorrow,reads(12,0));
        assert!(matches!(v.on_commerce_preflight_v1(r),PromiseOrValue::Value(false)));
        assert_eq!(*v.used.get(&(NOW/DAY_MS)).unwrap(),0);assert_eq!(v.next_nonce,1);
        assert_eq!(v.get_record(U64(0)).unwrap().status,Status::DispatchFailed);
    }
    #[test]
    fn malformed_decimal_and_debt_preflights_release_without_dispatch() {
        for (extra,debt) in [(25,0),(12,1)] {
            let mut v=vault();let r=request(2,0);let _=v.execute_commerce_v1(r.clone());callback(NOW,reads(extra,debt));
            assert!(matches!(v.on_commerce_preflight_v1(r),PromiseOrValue::Value(false)));
            assert_eq!(v.get_budget().used.0,0);assert_eq!(v.next_nonce,1);
        }
    }
    #[test]
    fn supply_refunds_partial_use_and_failure_do_not_replenish_allowance() {
        for (result,status) in [(PromiseResult::Successful(b"\"0\"".to_vec()),Status::Refunded),(PromiseResult::Successful(b"\"50\"".to_vec()),Status::Unknown),(PromiseResult::Failed,Status::Unknown)] {
            let mut v=vault();let _=v.execute_commerce_v1(request(1,0));callback(NOW,vec![result]);
            assert!(!v.on_commerce_dispatch_v1(U64(0),1));assert_eq!(v.get_budget().used.0,100);
            assert_eq!(v.get_record(U64(0)).unwrap().status,status);
        }
    }
    #[test]
    fn withdraw_success_never_refills_and_payment_failure_releases() {
        let mut v=vault();let _=v.execute_commerce_v1(request(2,0));callback(NOW,vec![PromiseResult::Successful(vec![])]);
        assert!(v.on_commerce_dispatch_v1(U64(0),2));assert_eq!(v.get_budget().used.0,100);
        testing_env!(context("owner.testnet",NOW));let _=v.execute_commerce_v1(request(0,1));
        callback(NOW,vec![PromiseResult::Failed]);assert!(!v.on_commerce_dispatch_v1(U64(1),0));
        assert_eq!(v.get_budget().used.0,100);assert_eq!(v.next_nonce,2);
    }
    #[test]
    fn commerce_wire_vector() {
        let _v=vault();assert_eq!(commerce_hash(&request(0,0)),"8ca76695b9c58d538a014e4d26beea3faed82993954cedcb22f911d9b7e23c4f");
    }
    #[test]
    fn preflight_cannot_spend_yesterdays_reservation_or_a_stale_quote() {
        for midnight in [true,false] {
            let mut v=vault();let mut r=request(1,0);
            let start=if midnight {NOW} else {(NOW/DAY_MS)*DAY_MS+1};
            r.quoted_at_ms=U64(start);r.expires_at_ms=U64(start+120_000);
            testing_env!(context("owner.testnet",start));let _=v.execute_commerce_v1(r.clone());
            let later=if midnight {(NOW/DAY_MS+1)*DAY_MS+1} else {start+60_001};
            callback(later,reads(12,0));assert!(matches!(v.on_commerce_preflight_v1(r),PromiseOrValue::Value(false)));
            assert_eq!(*v.used.get(&(start/DAY_MS)).unwrap(),0);assert_eq!(v.next_nonce,1);
        }
    }
    #[test]
    fn existing_deployed_v1_state_loads_without_migration() {
        testing_env!(context("owner.testnet",NOW));
        let snapshot:near_sdk::serde_json::Value=near_sdk::serde_json::from_str(include_str!("../tests/fixtures/deployed-v1-state.json")).unwrap();
        for row in snapshot["state"]["values"].as_array().unwrap() {
            let key:near_sdk::json_types::Base64VecU8=near_sdk::serde_json::from_value(row["key"].clone()).unwrap();
            let value:near_sdk::json_types::Base64VecU8=near_sdk::serde_json::from_value(row["value"].clone()).unwrap();
            env::storage_write(&key.0,&value.0);
        }
        let v:Vault=env::state_read().unwrap();
        assert_eq!(v.owner_id.as_str(),"neslos.testnet");assert_eq!(v.token_id.as_str(),"token.neslos.testnet");
        assert_eq!(v.policy_version,5);assert_eq!(v.next_nonce,2);assert!(v.policy.paused);
        assert_eq!(v.policy.daily_limit.0,500_000_000);
        let paid=v.get_record(U64(0)).unwrap();assert_eq!(paid.amount.0,150_000_000);assert_eq!(paid.status,Status::Settled);
        assert_eq!(v.used.get(&paid.day.0).copied(),Some(150_000_000));
        assert_eq!(v.get_record(U64(1)).unwrap().status,Status::DispatchFailed);
    }
    #[test]
    fn original_authorizations_and_public_commerce_share_the_same_budget() {
        let mut v=vault();let key=SigningKey::from_bytes(&[7;32]);v.executor_public_key=hex::encode(key.verifying_key().as_bytes());
        let _=v.execute_commerce_v1(request(0,0));testing_env!(context("owner.testnet",NOW));
        let r=request(0,1);
        let a=Authorization {domain:"neslos:authorize:v1".into(),network:r.network,vault:r.vault,policy_version:r.policy_version,nonce:r.nonce,amount:U128(150),quoted_output:U128(150),minimum_output:U128(150),slippage_bps:0,quoted_at_ms:r.quoted_at_ms,expires_at_ms:r.expires_at_ms,venue_commitment:v.policy.venue_commitments[0].clone(),strategy_venue_commitment:None,counterparty_commitment:v.policy.counterparty_commitments[0].clone(),deposit_account:r.target,output_asset:"nep141:token.testnet".into(),quote_hash:r.quote_hash,confidential:false,action:0,audit_hash:r.audit_hash};
        let signature=hex::encode(key.sign(&env::sha256(&borsh::to_vec(&a).unwrap())).to_bytes());let _=v.authorize(a,signature);
        assert_eq!(v.get_budget().used.0,250);assert_eq!(v.next_nonce,2);
        testing_env!(context("owner.testnet",NOW));let mut r=request(0,2);r.amount=U128(1);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(||v.execute_commerce_v1(r))).is_err());
        assert_eq!(v.next_nonce,2);assert_eq!(v.get_budget().used.0,250);
    }
}
