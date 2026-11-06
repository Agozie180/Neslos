
use super::*;
use ed25519_dalek::{Signer, SigningKey};
#[allow(deprecated)]
use near_sdk::{test_utils::{VMContextBuilder, testing_env_with_promise_results}, testing_env, PromiseResult};
const NOW: u64 = 1_793_577_599_000;
fn context(predecessor: &str, now: u64) -> near_sdk::VMContext {
    VMContextBuilder::new().current_account_id("vault.testnet".parse().unwrap())
        .predecessor_account_id(predecessor.parse().unwrap()).signer_account_id(predecessor.parse().unwrap())
        .block_timestamp(now * 1_000_000).attached_deposit(STORAGE_DEPOSIT).prepaid_gas(Gas::from_tgas(150)).build()
}
fn key() -> SigningKey { SigningKey::from_bytes(&[7u8; 32]) }
fn policy() -> Policy {
    Policy { daily_limit: U128(500_000_000), per_action_limit: U128(200_000_000), max_slippage_bps: 50, max_quote_age_ms: U64(60_000), venue_commitments: vec!["a".repeat(64)], counterparty_commitments: vec!["b".repeat(64)], output_assets: vec!["nep141:usdt.tether-token.near".to_owned()], require_confidential: true, paused: false }
}
fn vault() -> Vault {
    testing_env!(context("owner.testnet", NOW));
    Vault::new("owner.testnet".parse().unwrap(), "usdc.testnet".parse().unwrap(), "testnet".into(), hex::encode(key().verifying_key().as_bytes()), policy())
}
fn auth(nonce: u64) -> Authorization {
    Authorization { domain: "neslos:authorize:v1".into(), network: "testnet".into(), vault: "vault.testnet".parse().unwrap(), policy_version: U64(1), nonce: U64(nonce), amount: U128(150_000_000), quoted_output: U128(150_000_000), minimum_output: U128(149_625_000), slippage_bps: 25, quoted_at_ms: U64(NOW), expires_at_ms: U64(NOW + 60_000), venue_commitment: "a".repeat(64), strategy_venue_commitment: None, counterparty_commitment: "b".repeat(64), deposit_account: "deposit.testnet".parse().unwrap(), output_asset: "nep141:usdt.tether-token.near".into(), quote_hash: "c".repeat(64), confidential: true, action: 0, audit_hash: "d".repeat(64) }
}
fn sign(a: &Authorization) -> String { hex::encode(key().sign(&env::sha256(&borsh::to_vec(a).unwrap())).to_bytes()) }

#[test]
fn reserves_before_dispatch_and_preserves_usage_on_update() {
    let mut v = vault(); let a = auth(0); v.authorize(a.clone(), sign(&a));
    assert_eq!(v.get_budget().used.0, 150_000_000); assert_eq!(v.get_budget().next_nonce.0, 1);
    let mut smaller = policy(); smaller.daily_limit = U128(100_000_000); smaller.per_action_limit = U128(100_000_000);
    v.set_policy(smaller, U64(1)); assert_eq!(v.get_budget().remaining.0, 0); assert_eq!(v.get_budget().next_nonce.0, 1);
}
#[test]
fn adversarial_authorizations_are_rejected_before_mutation() {
    let v = vault();
    let cases: Vec<Box<dyn Fn(&mut Authorization)>> = vec![
        Box::new(|a| a.amount = U128(200_000_001)), Box::new(|a| a.amount = U128(0)),
        Box::new(|a| a.nonce = U64(1)), Box::new(|a| a.policy_version = U64(2)),
        Box::new(|a| a.network = "mainnet".into()), Box::new(|a| a.vault = "other.testnet".parse().unwrap()),
        Box::new(|a| a.domain = "other".into()), Box::new(|a| a.confidential = false),
        Box::new(|a| a.slippage_bps = 51), Box::new(|a| a.minimum_output = U128(1)),
        Box::new(|a| a.minimum_output = U128(150_000_001)), Box::new(|a| a.expires_at_ms = U64(NOW)),
        Box::new(|a| a.quoted_at_ms = U64(NOW + 1)), Box::new(|a| a.quoted_at_ms = U64(NOW - 60_001)),
        Box::new(|a| a.counterparty_commitment = "f".repeat(64)), Box::new(|a| a.venue_commitment = "f".repeat(64)),
        Box::new(|a| a.strategy_venue_commitment = Some("f".repeat(64))), Box::new(|a| a.action = 2),
        Box::new(|a| a.output_asset = "attacker-token".into()),
    ];
    for mutate in cases {
        let mut a = auth(0); mutate(&mut a);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.validate_authorization(&a, &sign(&a)))).is_err());
        assert_eq!(v.get_budget().used.0, 0);
    }
}
#[test]
#[should_panic(expected = "INVALID_SIGNATURE")]
fn signature_cannot_be_reused_after_recipient_change() {
    let v = vault(); let mut a = auth(0); let s = sign(&a); a.deposit_account = "attacker.testnet".parse().unwrap();
    v.validate_authorization(&a, &s);
}
#[test]
#[should_panic(expected = "NONCE")]
fn replay_fails() {
    let mut v = vault(); let a = auth(0); let s = sign(&a); v.authorize(a.clone(), s.clone());
    testing_env!(context("owner.testnet", NOW)); v.authorize(a, s);
}
#[test]
#[should_panic(expected = "DAILY_LIMIT")]
fn several_agents_share_one_daily_limit() {
    let mut v = vault();
    for nonce in 0..4 { testing_env!(context("owner.testnet", NOW)); let a = auth(nonce); v.authorize(a.clone(), sign(&a)); }
}
#[test]
#[should_panic(expected = "OWNER_ONLY")]
fn agent_cannot_change_policy() {
    let mut v = vault(); testing_env!(context("agent.testnet", NOW)); v.set_policy(policy(), U64(1));
}
#[test]
#[should_panic(expected = "PAUSED")]
fn owner_pause_takes_effect() {
    let mut v = vault(); v.set_paused(true, None); let mut a = auth(0); a.policy_version = U64(2); v.authorize(a.clone(), sign(&a));
}
#[test]
fn stale_or_unversioned_resume_cannot_reopen_a_newer_pause() {
    let mut v = vault(); let a = auth(0); let _ = v.authorize(a.clone(), sign(&a));
    v.set_paused(true, None);
    let reviewed_version = v.policy_version;
    // Another owner session pauses again after the first session reviewed a resume.
    v.set_paused(true, Some(U64(1)));
    assert_eq!(v.policy_version, reviewed_version + 1);
    for version in [None, Some(U64(reviewed_version))] {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.set_paused(false, version)));
        assert!(result.is_err());
        assert!(v.policy.paused);
        assert_eq!(v.policy_version, reviewed_version + 1);
        assert_eq!(v.get_budget().used.0, 150_000_000);
        assert_eq!(v.get_budget().next_nonce.0, 1);
    }
    v.set_paused(false, Some(U64(reviewed_version + 1)));
    assert!(!v.policy.paused);
    assert_eq!(v.policy_version, reviewed_version + 2);
    assert_eq!(v.get_budget().used.0, 150_000_000);
    assert_eq!(v.get_budget().next_nonce.0, 1);
}
#[test]
#[allow(deprecated)]
fn failed_callback_after_midnight_only_restores_original_day() {
    let mut v = vault(); let a = auth(0); v.authorize(a.clone(), sign(&a));
    let tomorrow = (NOW / DAY_MS + 1) * DAY_MS + 1;
    testing_env!(context("owner.testnet", tomorrow));
    let mut second = auth(1); second.quoted_at_ms = U64(tomorrow); second.expires_at_ms = U64(tomorrow + 60_000);
    v.authorize(second.clone(), sign(&second));
    testing_env_with_promise_results(context("vault.testnet", tomorrow), PromiseResult::Failed);
    assert!(!v.on_dispatch(U64(0))); assert_eq!(v.get_budget().used.0, 150_000_000);
    assert_eq!(v.get_record(U64(0)).unwrap().status, Status::DispatchFailed); assert_eq!(v.next_nonce, 2);
}
#[test]
#[allow(deprecated)]
fn unknown_and_late_refund_never_replenish_daily_allowance() {
    let mut v = vault(); let a = auth(0); v.authorize(a.clone(), sign(&a));
    testing_env_with_promise_results(context("vault.testnet", NOW), PromiseResult::Successful(vec![]));
    assert!(v.on_dispatch(U64(0)));
    let mut s = Settlement { domain: "neslos:settlement:v1".into(), network: "testnet".into(), vault: "vault.testnet".parse().unwrap(), nonce: U64(0), quote_hash: "c".repeat(64), outcome: 0, audit_hash: "e".repeat(64) };
    let signature = hex::encode(key().sign(&env::sha256(&borsh::to_vec(&s).unwrap())).to_bytes()); v.record_settlement(s.clone(), signature);
    assert_eq!(v.get_record(U64(0)).unwrap().status, Status::Unknown);
    s.outcome = 2; let signature = hex::encode(key().sign(&env::sha256(&borsh::to_vec(&s).unwrap())).to_bytes()); v.record_settlement(s, signature);
    assert_eq!(v.get_budget().used.0, 150_000_000);
}
#[test]
fn rounding_and_maximum_integer_do_not_bypass_output_floor() {
    assert_eq!(output_floor(1, 50), 1); assert_eq!(output_floor(100_000_001, 50), 99_500_001);
    assert_eq!(output_floor(u128::MAX, 0), u128::MAX);
}
#[test]
#[allow(deprecated)]
fn oversized_successful_receipt_never_restores_allowance() {
    let mut v = vault(); let a = auth(0); v.authorize(a.clone(), sign(&a));
    testing_env_with_promise_results(context("vault.testnet", NOW), PromiseResult::Successful(vec![0; 1024]));
    assert!(v.on_dispatch(U64(0)));
    assert_eq!(v.get_budget().used.0, 150_000_000);
    assert_eq!(v.get_record(U64(0)).unwrap().status, Status::Dispatched);
}
#[test]
fn authorization_wire_vector_is_stable() {
    let _v = vault(); let bytes = borsh::to_vec(&auth(0)).unwrap();
    assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 19);
    assert_eq!(authorization_hash(&auth(0)), "5bbf40ba5577220ae67679f9977f3aff7b205ea2961a13724e040b80237731db");
}
