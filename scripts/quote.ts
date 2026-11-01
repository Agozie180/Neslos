import { IntentsClient } from '../src/core/intents.js';
const quote = await new IntentsClient().quote({ amount: '150000000', maxSlippageBps: 50, recipient: 'neslos-research.near', refundTo: 'neslos-demo.near', dry: true });
console.log(JSON.stringify({ ...quote, disclosure: 'Live mainnet dry quote only. No deposit address requested and no assets moved.' }, null, 2));
