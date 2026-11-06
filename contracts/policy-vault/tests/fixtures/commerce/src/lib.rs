//! Sandbox-only receipts fixture. No production Rhea code or yield is simulated as real.
use near_sdk::{env, near, store::LookupMap, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, json_types::U128, serde_json::{json, Value}};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Fixture {
    balances: LookupMap<AccountId, u128>,
    token: AccountId,
    mode: u8,
    extra_decimals: u8,
    can_deposit: bool,
    can_withdraw: bool,
    debt: u128,
    supplied_limit: u128,
}
#[near]
impl Fixture {
    #[init]
    pub fn new(token: AccountId, holder: AccountId, registered: Vec<AccountId>, supply: U128) -> Self {
        let mut balances = LookupMap::new(b"b");
        for account in registered { balances.insert(account, 0); }
        balances.insert(holder, supply.0);
        Self { balances, token, mode: 0, extra_decimals: 12, can_deposit: true, can_withdraw: true, debt: 0, supplied_limit: u128::MAX }
    }
    // Deliberately unrestricted test configuration. This WASM must never be a real asset.
    pub fn configure(&mut self, mode: u8, extra_decimals: u8, can_deposit: bool, can_withdraw: bool, debt: U128, supplied_limit: U128) {
        self.mode = mode; self.extra_decimals = extra_decimals; self.can_deposit = can_deposit;
        self.can_withdraw = can_withdraw; self.debt = debt.0; self.supplied_limit = supplied_limit.0;
    }
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 { U128(self.balances.get(&account_id).copied().unwrap_or(0)) }
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto(); let _ = memo;
        self.transfer(env::predecessor_account_id(), receiver_id, amount.0);
    }
    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, msg: String) -> Promise {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.transfer(sender.clone(), receiver_id.clone(), amount.0);
        call(receiver_id.clone(), "ft_on_transfer", json!({"sender_id":sender,"amount":amount,"msg":msg}), 0, 100)
            .then(call(env::current_account_id(), "resolve", json!({"sender":sender,"receiver":receiver_id,"amount":amount}), 0, 15))
    }
    #[private]
    pub fn resolve(&mut self, sender: AccountId, receiver: AccountId, amount: U128) -> U128 {
        let unused = env::promise_result_checked(0, 64).ok().and_then(|bytes| near_sdk::serde_json::from_slice::<U128>(&bytes).ok()).map(|x| x.0.min(amount.0)).unwrap_or(amount.0);
        if unused > 0 { self.transfer(receiver, sender, unused); }
        U128(amount.0 - unused)
    }
    pub fn get_asset(&self, token_id: AccountId) -> Value {
        assert_eq!(token_id, self.token);
        json!({"token_id":self.token,"supplied":{"balance":"0","shares":"0"},"config":{"extra_decimals":self.extra_decimals,"can_deposit":self.can_deposit,"can_withdraw":self.can_withdraw,"supplied_limit":U128(self.supplied_limit)}})
    }
    pub fn get_account(&self, account_id: AccountId) -> Value {
        let amount = self.balances.get(&account_id).copied().unwrap_or(0);
        json!({"account_id":account_id,"supplied":[{"token_id":self.token,"balance":U128(amount * 10u128.pow(self.extra_decimals.into())),"shares":U128(amount)}],"borrowed":[{"token_id":self.token,"balance":U128(self.debt),"shares":U128(self.debt)}]})
    }
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        assert_eq!(env::predecessor_account_id(), self.token);
        assert!(msg.is_empty());
        if self.mode == 1 { return PromiseOrValue::Value(amount); }
        if self.mode == 2 { env::panic_str("FIXTURE_RECEIVER_FAILURE"); }
        let used = if self.mode == 3 { amount.0 / 2 } else { amount.0 };
        let old = self.balances.get(&sender_id).copied().unwrap_or(0);
        self.balances.insert(sender_id, old + used);
        PromiseOrValue::Value(U128(amount.0 - used))
    }
    #[payable]
    pub fn execute(&mut self, actions: Vec<Value>) {
        near_sdk::assert_one_yocto();
        assert_eq!(actions.len(), 1);
        let withdraw = actions[0].as_object().unwrap(); assert_eq!(withdraw.len(), 1);
        let args = withdraw.get("Withdraw").unwrap().as_object().unwrap(); assert_eq!(args.len(), 2);
        assert_eq!(args["token_id"].as_str().unwrap(), self.token.as_str());
        let protocol: U128 = near_sdk::serde_json::from_value(args["max_amount"].clone()).unwrap();
        let amount = protocol.0 / 10u128.pow(self.extra_decimals.into());
        let sender = env::predecessor_account_id();
        let old = *self.balances.get(&sender).unwrap(); assert!(amount > 0 && amount <= old);
        self.balances.insert(sender.clone(), old - amount);
        // Published Rhea execute returns before its separately scheduled FT receipt.
        call(self.token.clone(), "ft_transfer", json!({"receiver_id":sender,"amount":U128(amount)}), 1, 30).detach();
    }
}
impl Fixture {
    fn transfer(&mut self, sender: AccountId, receiver: AccountId, amount: u128) {
        assert!(sender != receiver && amount > 0);
        let previous = self.balances.get(&sender).copied().expect("SENDER_NOT_REGISTERED");
        let received = self.balances.get(&receiver).copied().expect("RECEIVER_NOT_REGISTERED");
        self.balances.insert(sender, previous.checked_sub(amount).expect("INSUFFICIENT_BALANCE"));
        self.balances.insert(receiver, received.checked_add(amount).unwrap());
    }
}
fn call(target: AccountId, method: &str, args: Value, deposit: u128, gas: u64) -> Promise {
    Promise::new(target).function_call(method.to_owned(), near_sdk::serde_json::to_vec(&args).unwrap(), NearToken::from_yoctonear(deposit), Gas::from_tgas(gas))
}
