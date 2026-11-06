use near_api::{AccountId, NearGas, NearToken};
use near_sdk::{json_types::{U128,U64}, serde_json::json};
use policy_vault::{Budget,CommerceRequestV1,Policy,Record,Status};
use sha2::{Digest,Sha256};

const RHEA: &str="contract.1689937928.burrow.testnet";
fn commitment(kind:&str,value:&str,salt:&str)->String {
    hex::encode(Sha256::digest(format!("{{\"domain\":\"neslos:{kind}:v1\",\"salt\":\"{salt}\",\"value\":\"{value}\"}}").as_bytes()))
}
fn policy()->Policy {
    Policy {daily_limit:U128(500_000_000),per_action_limit:U128(200_000_000),max_slippage_bps:50,max_quote_age_ms:U64(60_000),
        venue_commitments:["public-payment","rhea"].iter().map(|v|commitment("venue",v,&"a".repeat(64))).collect(),
        counterparty_commitments:["payee.sandbox","unregistered.sandbox",RHEA].iter().map(|v|commitment("counterparty",v,&"b".repeat(64))).collect(),
        output_assets:vec!["nep141:commerce-token.sandbox".into()],require_confidential:false,paused:false}
}
fn request(action:u8,nonce:u64,amount:u128)->CommerceRequestV1 {
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    CommerceRequestV1 {domain:"neslos:commerce:v1".into(),network:"testnet".into(),vault:"commerce-vault.sandbox".parse().unwrap(),policy_version:U64(1),nonce:U64(nonce),action,amount:U128(amount),
        target:if action==0{"payee.sandbox"}else{RHEA}.parse().unwrap(),venue:if action==0{"public-payment"}else{"rhea"}.into(),venue_salt:"a".repeat(64),counterparty_salt:"b".repeat(64),quoted_at_ms:U64(now),expires_at_ms:U64(now+60_000),quote_hash:"c".repeat(64),audit_hash:"d".repeat(64)}
}
async fn create(sandbox:&near_sandbox::Sandbox,id:&str)->testresult::TestResult<near_api::Account> {
    let id:AccountId=id.parse()?;sandbox.create_account(id.clone()).initial_balance(NearToken::from_near(20)).send().await?;Ok(near_api::Account(id))
}
async fn budget(vault:&near_api::Contract,network:&near_api::NetworkConfig)->testresult::TestResult<Budget> {
    Ok(vault.call_function("get_budget",()).read_only().fetch_from(network).await?.data)
}
async fn record(vault:&near_api::Contract,network:&near_api::NetworkConfig,nonce:u64)->testresult::TestResult<Record> {
    Ok(vault.call_function("get_record",json!({"nonce":nonce.to_string()})).read_only().fetch_from(network).await?.data)
}

#[tokio::test]
async fn real_commerce_receipts_keep_vault_custody_and_shared_allowance()->testresult::TestResult<()> {
    let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir=std::env::var("NESLOS_WASM_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_|root.join("artifacts"));
    let code=std::fs::read(dir.join("policy_vault.wasm"))?;
    let fixture=std::fs::read(dir.join("neslos_commerce_fixture.wasm"))?;
    let sandbox=near_sandbox::Sandbox::start_sandbox().await?;
    let network=near_api::NetworkConfig::from_rpc_url("sandbox",sandbox.rpc_addr.parse()?);
    let owner=create(&sandbox,"commerce-owner.sandbox").await?;
    let relay=create(&sandbox,"commerce-relay.sandbox").await?;
    let payee=create(&sandbox,"payee.sandbox").await?;
    let _unregistered=create(&sandbox,"unregistered.sandbox").await?;
    let vault=create(&sandbox,"commerce-vault.sandbox").await?.as_contract();
    let token=create(&sandbox,"commerce-token.sandbox").await?.as_contract();
    let rhea=create(&sandbox,RHEA).await?.as_contract();
    let signer=near_api::Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
    near_api::Contract::deploy(token.account_id().clone()).use_code(fixture.clone()).with_init_call("new",json!({"token":token.account_id(),"holder":vault.account_id(),"registered":[payee.account_id(),rhea.account_id()],"supply":"1000000000"}))?.with_signer(signer.clone()).send_to(&network).await?.assert_success();
    near_api::Contract::deploy(rhea.account_id().clone()).use_code(fixture).with_init_call("new",json!({"token":token.account_id(),"holder":vault.account_id(),"registered":[],"supply":"0"}))?.with_signer(signer.clone()).send_to(&network).await?.assert_success();
    near_api::Contract::deploy(vault.account_id().clone()).use_code(code.clone()).with_init_call("new",json!({"owner_id":owner.account_id(),"token_id":token.account_id(),"network":"testnet","executor_public_key":"a".repeat(64),"policy":policy()}))?.with_signer(signer.clone()).send_to(&network).await?.assert_success();

    // A relayer cannot turn the public owner method into an unsigned agent method.
    vault.call_function("execute_commerce_v1",json!({"request":request(0,0,100_000_000)})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(relay.account_id().clone(),signer.clone()).send_to(&network).await?.assert_failure();
    for case in ["amount","payee","venue","nonce","domain"] {
        let mut invalid=request(0,0,100_000_000);
        match case {"amount"=>invalid.amount=U128(200_000_001),"payee"=>invalid.target=owner.account_id().clone(),"venue"=>invalid.venue="attacker".into(),"nonce"=>invalid.nonce=U64(1),_=>invalid.domain="wrong".into()}
        vault.call_function("execute_commerce_v1",json!({"request":invalid})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_failure();
    }
    assert_eq!(budget(&vault,&network).await?.used.0,0);
    let mut nonce=0;
    for (action,amount) in [(0,100_000_000),(1,100_000_000),(2,50_000_000)] {
        vault.call_function("execute_commerce_v1",json!({"request":request(action,nonce,amount)})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_success();
        assert_eq!(record(&vault,&network,nonce).await?.status,Status::Dispatched);nonce+=1;
    }
    let position:near_sdk::serde_json::Value=rhea.call_function("get_account",json!({"account_id":vault.account_id()})).read_only().fetch_from(&network).await?.data;
    assert_eq!(position["supplied"][0]["shares"],"50000000");
    let balance:U128=token.call_function("ft_balance_of",json!({"account_id":vault.account_id()})).read_only().fetch_from(&network).await?.data;
    assert_eq!(balance.0,850_000_000);assert_eq!(budget(&vault,&network).await?.used.0,250_000_000);
    // Even a validly opened but unregistered payment consumes a nonce, and restores quota only on actual FT failure.
    let mut failure=request(0,nonce,50_000_000);failure.target="unregistered.sandbox".parse()?;
    vault.call_function("execute_commerce_v1",json!({"request":failure})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_success();
    assert_eq!(record(&vault,&network,nonce).await?.status,Status::DispatchFailed);nonce+=1;
    assert_eq!(budget(&vault,&network).await?.used.0,250_000_000);

    for (mode,enabled,debt,cap,expected) in [(0,false,0,u128::MAX,Status::DispatchFailed),(0,true,1,u128::MAX,Status::DispatchFailed),(0,true,0,1,Status::DispatchFailed),(1,true,0,u128::MAX,Status::Refunded),(3,true,0,u128::MAX,Status::Unknown)] {
        rhea.call_function("configure",json!({"mode":mode,"extra_decimals":12,"can_deposit":enabled,"can_withdraw":true,"debt":debt.to_string(),"supplied_limit":cap.to_string()})).transaction().with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_success();
        vault.call_function("execute_commerce_v1",json!({"request":request(1,nonce,100_000_000)})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_success();
        assert_eq!(record(&vault,&network,nonce).await?.status,expected);nonce+=1;
    }
    assert_eq!(budget(&vault,&network).await?.used.0,450_000_000);
    // Shared daily quota stops another otherwise valid request before consuming its nonce.
    vault.call_function("execute_commerce_v1",json!({"request":request(0,nonce,100_000_000)})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_failure();
    assert_eq!(budget(&vault,&network).await?.next_nonce.0,nonce);
    // Re-deployment preserves live balances, record map, usage, policy and nonce.
    near_api::Contract::deploy(vault.account_id().clone()).use_code(code).without_init_call().with_signer(signer.clone()).send_to(&network).await?.assert_success();
    assert_eq!(budget(&vault,&network).await?.used.0,450_000_000);assert_eq!(budget(&vault,&network).await?.next_nonce.0,nonce);
    assert_eq!(record(&vault,&network,0).await?.status,Status::Dispatched);
    let mut private=policy();private.require_confidential=true;
    vault.call_function("set_policy",json!({"policy":private,"expected_version":"1"})).transaction().with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_success();
    for action in 0..=2 {
        let mut blocked=request(action,nonce,1);blocked.policy_version=U64(2);
        vault.call_function("execute_commerce_v1",json!({"request":blocked})).transaction().gas(NearGas::from_tgas(300)).deposit(NearToken::from_millinear(10)).with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_failure();
    }
    vault.call_function("on_commerce_dispatch_v1",json!({"nonce":"0","action":0})).transaction().with_signer(owner.account_id().clone(),signer.clone()).send_to(&network).await?.assert_failure();
    println!("COMMERCE_SANDBOX_EVIDENCE: payment=100000000; supply=100000000; withdrawal_to_vault=50000000; refunded_and_partial_quota_retained=true; used=450000000; nonce={nonce}; private_actions_rejected=3; virtual_fixture_assets_only=true");
    Ok(())
}
