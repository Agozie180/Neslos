//! Deliberately minimal receipt-test fixture used by local sandboxes and public testnet vault proofs.
//! It is not a production, standards-complete or Rhea-compatible token implementation.
//! Implements only the transfer behavior needed to exercise real cross-contract receipts.
use near_sdk::{env, near, store::LookupMap, AccountId, PanicOnDefault, json_types::U128};
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken { balances: LookupMap<AccountId, u128> }
#[near]
impl TestToken {
    #[init]
    pub fn new(holder: AccountId, registered: Vec<AccountId>, supply: U128) -> Self {
        let mut balances = LookupMap::new(b"b");
        for account in registered { balances.insert(account, 0); }
        balances.insert(holder, supply.0);
        Self { balances }
    }
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 { U128(self.balances.get(&account_id).copied().unwrap_or(0)) }
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        assert!(sender != receiver_id && amount.0 > 0, "INVALID_TRANSFER");
        let previous = self.balances.get(&sender).copied().expect("SENDER_NOT_REGISTERED");
        let received = self.balances.get(&receiver_id).copied().expect("RECEIVER_NOT_REGISTERED");
        assert!(previous >= amount.0, "INSUFFICIENT_BALANCE");
        self.balances.insert(sender.clone(), previous - amount.0);
        self.balances.insert(receiver_id.clone(), received.checked_add(amount.0).expect("OVERFLOW"));
        let mut data = near_sdk::serde_json::json!({"old_owner_id":sender,"new_owner_id":receiver_id,"amount":amount});
        if let Some(memo) = memo { data["memo"] = near_sdk::serde_json::Value::String(memo); }
        env::log_str(&format!("EVENT_JSON:{}", near_sdk::serde_json::json!({"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[data]})));
    }
}
