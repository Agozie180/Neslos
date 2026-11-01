import { rankMarkets, ResearchService } from '../src/core/research.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
const research = await new ResearchService().discover({ referenceOnly: process.argv.includes('--reference') });
console.log(JSON.stringify({ ...research, ranking: rankMarkets(research.markets, DEFAULT_POLICY) }, null, 2));
