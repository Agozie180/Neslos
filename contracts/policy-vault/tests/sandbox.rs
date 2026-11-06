use ed25519_dalek::{Signer as _, SigningKey};
use near_api::{AccountId, NearGas, NearToken};
use near_sdk::{borsh, json_types::{U128, U64}, serde_json::json};
use policy_vault::{Authorization, Budget, Policy, Record, Settlement, Status};
use sha2::{Digest, Sha256};

fn signing_key() -> SigningKey { SigningKey::from_bytes(&[7; 32]) }
fn policy() -> Policy {
    Policy { daily_limit: U128(500_000_000), per_action_limit: U128(200_000_000), max_slippage_bps: 50, max_quote_age_ms: U64(60_000), venue_commitments: vec!["a".repeat(64)], counterparty_commitments: vec!["b".repeat(64)], output_assets: vec!["nep141:usdt.tether-token.near".into()], require_confidential: true, paused: false }
}
fn auth(nonce: u64, version: u64, receiver: &AccountId) -> Authorization {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    Authorization { domain: "neslos:authorize:v1".into(), network: "testnet".into(), vault: "vault.sandbox".parse().unwrap(), policy_version: U64(version), nonce: U64(nonce), amount: U128(150_000_000), quoted_output: U128(150_000_000), minimum_output: U128(149_625_000), slippage_bps: 25, quoted_at_ms: U64(now), expires_at_ms: U64(now + 60_000), venue_commitment: "a".repeat(64), strategy_venue_commitment: None, counterparty_commitment: "b".repeat(64), deposit_account: receiver.clone(), output_asset: "nep141:usdt.tether-token.near".into(), quote_hash: "c".repeat(64), confidential: true, action: 0, audit_hash: "d".repeat(64) }
}
fn sign<T: borsh::BorshSerialize>(value: &T) -> String { hex::encode(signing_key().sign(&Sha256::digest(borsh::to_vec(value).unwrap())).to_bytes()) }
async fn create(sandbox: &near_sandbox::Sandbox, id: &str) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = id.parse()?;
    sandbox.create_account(account_id.clone()).initial_balance(NearToken::from_near(20)).send().await?;
    Ok(near_api::Account(account_id))
}

#[tokio::test]
async fn real_receipts_enforce_policy_and_reconcile_failed_ft_dispatch() -> testresult::TestResult<()> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let wasm_dir = std::env::var("NESLOS_WASM_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| root.join("artifacts"));
    let vault_wasm = std::fs::read(wasm_dir.join("policy_vault.wasm"))?;
    let token_wasm = std::fs::read(wasm_dir.join("neslos_test_token.wasm"))?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let owner = create(&sandbox, "owner.sandbox").await?;
    let relay = create(&sandbox, "relay.sandbox").await?;
    let recipient = create(&sandbox, "recipient.sandbox").await?;
    let unregistered = create(&sandbox, "unregistered.sandbox").await?;
    let vault = create(&sandbox, "vault.sandbox").await?.as_contract();
    let token = create(&sandbox, "token.sandbox").await?.as_contract();
    let signer = near_api::Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;

    near_api::Contract::deploy(token.account_id().clone()).use_code(token_wasm)
        .with_init_call("new", json!({"holder": vault.account_id(), "registered": [owner.account_id(), recipient.account_id()], "supply": "1000000000"}))?
        .with_signer(signer.clone()).send_to(&network).await?.assert_success();
    near_api::Contract::deploy(vault.account_id().clone()).use_code(vault_wasm)
        .with_init_call("new", json!({"owner_id": owner.account_id(), "token_id": token.account_id(), "network": "testnet", "executor_public_key": hex::encode(signing_key().verifying_key().as_bytes()), "policy": policy()}))?
        .with_signer(signer.clone()).send_to(&network).await?.assert_success();

    let valid = auth(0, 1, recipient.account_id());
    let signature = sign(&valid);
    let payment = vault.call_function("authorize", json!({"authorization": valid, "signature": signature}))
        .transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_millinear(10))
        .with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    let expected_transfer = json!({"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":vault.account_id(),"new_owner_id":recipient.account_id(),"amount":"150000000"}]});
    let transfer_events: Vec<near_sdk::serde_json::Value> = payment.receipt_outcomes().iter()
        .filter(|receipt| receipt.executor_id == *token.account_id() && receipt.is_success())
        .flat_map(|receipt| receipt.logs.iter())
        .filter_map(|line| line.strip_prefix("EVENT_JSON:"))
        .filter_map(|line| near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(line).ok())
        .filter(|event| event["standard"] == "nep141").collect();
    assert_eq!(transfer_events, vec![expected_transfer]);
    let record: Record = vault.call_function("get_record", json!({"nonce":"0"})).read_only().fetch_from(&network).await?.data;
    assert_eq!(record.status, Status::Dispatched);
    let balance: U128 = token.call_function("ft_balance_of", json!({"account_id": recipient.account_id()})).read_only().fetch_from(&network).await?.data;
    assert_eq!(balance.0, 150_000_000);

    // Replaying the same authorization fails inside deployed WASM, even through another relayer.
    vault.call_function("authorize", json!({"authorization": valid, "signature": signature}))
        .transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_millinear(10))
        .with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();

    // Test signed invalid policies and a payload changed after signing.
    for case in ["recipient", "counterparty", "slippage", "network", "amount", "privacy"] {
        let mut invalid = auth(1, 1, recipient.account_id());
        let original_signature = sign(&invalid);
        match case {
            "recipient" => invalid.deposit_account = unregistered.account_id().clone(),
            "counterparty" => invalid.counterparty_commitment = "e".repeat(64),
            "slippage" => invalid.slippage_bps = 51,
            "network" => invalid.network = "mainnet".into(),
            "amount" => invalid.amount = U128(501_000_000),
            "privacy" => invalid.confidential = false,
            _ => unreachable!(),
        }
        let bad_signature = if case == "recipient" { original_signature } else { sign(&invalid) };
        vault.call_function("authorize", json!({"authorization": invalid, "signature": bad_signature}))
            .transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_millinear(10))
            .with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    }
    let before: Budget = vault.call_function("get_budget", ()).read_only().fetch_from(&network).await?.data;
    assert_eq!(before.used.0, 150_000_000); assert_eq!(before.next_nonce.0, 1);

    vault.call_function("set_policy", json!({"policy":policy(), "expected_version":"1"}))
        .transaction().with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    let mut lower = policy(); lower.daily_limit = U128(120_000_000); lower.per_action_limit = U128(120_000_000);
    vault.call_function("set_policy", json!({"policy":lower, "expected_version":"1"}))
        .transaction().with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    let lowered: Budget = vault.call_function("get_budget", ()).read_only().fetch_from(&network).await?.data;
    assert_eq!(lowered.used.0, 150_000_000); assert_eq!(lowered.remaining.0, 0); assert_eq!(lowered.next_nonce.0, 1);
    let mut no_allowance = auth(1, 2, recipient.account_id()); no_allowance.amount = U128(1_000_000);
    vault.call_function("authorize", json!({"signature":sign(&no_allowance), "authorization": no_allowance}))
        .transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_millinear(10))
        .with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    vault.call_function("set_policy", json!({"policy":policy(), "expected_version":"2"}))
        .transaction().with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();

    // The actual FT receipt fails because this receiver has no storage registration.
    let failed = auth(1, 3, unregistered.account_id());
    let failed_payment = vault.call_function("authorize", json!({"signature":sign(&failed), "authorization":failed}))
        .transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_millinear(10))
        .with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    assert!(!failed_payment.logs().iter().any(|line| line.contains("\"standard\":\"nep141\"")), "A failed token receipt must not emit a successful transfer event");
    let failed_record: Record = vault.call_function("get_record", json!({"nonce":"1"})).read_only().fetch_from(&network).await?.data;
    assert_eq!(failed_record.status, Status::DispatchFailed);
    let after: Budget = vault.call_function("get_budget", ()).read_only().fetch_from(&network).await?.data;
    assert_eq!(after.used.0, 150_000_000); assert_eq!(after.next_nonce.0, 2);
    let vault_balance: U128 = token.call_function("ft_balance_of", json!({"account_id":vault.account_id()})).read_only().fetch_from(&network).await?.data;
    assert_eq!(vault_balance.0, 850_000_000);

    // An external caller cannot forge the private callback and refund allowance.
    vault.call_function("on_dispatch", json!({"nonce":"0"})).transaction().gas(NearGas::from_tgas(30))
        .with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    let settlement = Settlement { domain:"neslos:settlement:v1".into(), network:"testnet".into(), vault:vault.account_id().clone(), nonce:U64(0), quote_hash:"c".repeat(64), outcome:1, audit_hash:"e".repeat(64) };
    vault.call_function("record_settlement", json!({"signature":sign(&settlement), "settlement":settlement}))
        .transaction().gas(NearGas::from_tgas(30)).with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    let settled: Record = vault.call_function("get_record", json!({"nonce":"0"})).read_only().fetch_from(&network).await?.data;
    assert_eq!(settled.status, Status::Settled);

    vault.call_function("set_paused", json!({"paused":true})).transaction()
        .with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    // A delayed resume reviewed before this pause must not reopen the newer policy.
    vault.call_function("set_paused", json!({"paused":false, "expected_version":"3"})).transaction()
        .with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    vault.call_function("set_paused", json!({"paused":false})).transaction()
        .with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    let still_paused: Budget = vault.call_function("get_budget", ()).read_only().fetch_from(&network).await?.data;
    assert!(still_paused.paused);
    assert_eq!(still_paused.policy_version.0, 4);
    assert_eq!(still_paused.used.0, 150_000_000);
    assert_eq!(still_paused.next_nonce.0, 2);
    let paused = auth(2, 4, recipient.account_id());
    vault.call_function("authorize", json!({"signature":sign(&paused), "authorization":paused}))
        .transaction().gas(NearGas::from_tgas(100)).deposit(NearToken::from_millinear(10))
        .with_signer(relay.account_id().clone(), signer.clone()).send_to(&network).await?.assert_failure();
    let recovery = vault.call_function("withdraw_owner", json!({"amount":"50000000"})).transaction().gas(NearGas::from_tgas(60))
        .deposit(NearToken::from_yoctonear(1)).with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    let expected_recovery = json!({"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":vault.account_id(),"new_owner_id":owner.account_id(),"amount":"50000000","memo":"Neslos owner recovery"}]});
    assert!(recovery.receipt_outcomes().iter().filter(|receipt| receipt.executor_id == *token.account_id() && receipt.is_success()).flat_map(|receipt| receipt.logs.iter()).filter_map(|line| line.strip_prefix("EVENT_JSON:")).any(|line| near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(line).is_ok_and(|event| event == expected_recovery)));
    let recovered: U128 = token.call_function("ft_balance_of", json!({"account_id":owner.account_id()})).read_only().fetch_from(&network).await?.data;
    assert_eq!(recovered.0, 50_000_000);
    vault.call_function("set_paused", json!({"paused":false, "expected_version":"4"})).transaction()
        .with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    let resumed: Budget = vault.call_function("get_budget", ()).read_only().fetch_from(&network).await?.data;
    assert!(!resumed.paused); assert_eq!(resumed.policy_version.0, 5);
    // An outdated owner view must still be able to stop spending immediately.
    vault.call_function("set_paused", json!({"paused":true, "expected_version":"1"})).transaction()
        .with_signer(owner.account_id().clone(), signer.clone()).send_to(&network).await?.assert_success();
    let final_budget: Budget = vault.call_function("get_budget", ()).read_only().fetch_from(&network).await?.data;
    assert!(final_budget.paused); assert_eq!(final_budget.policy_version.0, 6);
    assert_eq!(final_budget.used.0, 150_000_000); assert_eq!(final_budget.next_nonce.0, 2);
    println!("SANDBOX_EVIDENCE: recipient=150000000; failed_dispatch_restored=true; nonce=2; usage=150000000; paused=true; owner_recovered=50000000; nep141_events_verified=true; failed_transfer_event_absent=true; real_funds=false");
    Ok(())
}
