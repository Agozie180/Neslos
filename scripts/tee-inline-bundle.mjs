/** Build a measured, self-contained application bundle without a private registry.
 * The full bootstrap and compressed application bytes are inside appCompose.
 * Dependencies are fetched with package-lock integrity and no lifecycle scripts.
 * Installed dependencies rely on trusted application-volume initialization and
 * integrity across runtime-only restarts; see docs/TDX-DEPLOYMENT-STATUS.md.
 */
import { parseArgs } from 'node:util';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { sourceIdentity } from './evidence.mjs';
const { values } = parseArgs({ options: { out: { type: 'string' } }, strict: true });
if (!values.out) throw new Error('Use --out NEW_DIRECTORY after npm run build.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
async function collect(path) {
  for (const row of (await readdir(path, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    const name = path + '/' + row.name;
    if (row.isDirectory()) await collect(name);
    else if (row.isFile() && !/\.(map|ts)$/.test(name)) files.push({ path: name, content: (await readFile(name)).toString('base64') });
  }
}
for (const path of ['package.json', 'package-lock.json']) files.push({ path, content: (await readFile(path)).toString('base64') });
await collect('dist/server'); await collect('fixtures');
if (!files.some(f => f.path === 'dist/server/tee/index.js')) throw new Error('BUILD_REQUIRED');
const bytes = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 });
const hash = sha(bytes), payload = bytes.toString('base64');
const verify = "const fs=require('node:fs'),c=require('node:crypto');for(const [p,h] of "+JSON.stringify(files.map(f=>[f.path,sha(Buffer.from(f.content,'base64'))]))+"){if(!fs.lstatSync(p).isFile()||c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw Error('APP_INTEGRITY');}import('./dist/server/tee/index.js');";
const setup = `const fs=require('node:fs'),z=require('node:zlib'),c=require('node:crypto'),cp=require('node:child_process');
const b=Buffer.from(process.argv.slice(1).join(''),'base64');
if(c.createHash('sha256').update(b).digest('hex')!=='${hash}')throw Error('BUNDLE_HASH');
for(const f of JSON.parse(z.gunzipSync(b))){if(!/^(package(-lock)?\\.json|dist\\/server\\/[a-zA-Z0-9_./-]+|fixtures\\/[a-zA-Z0-9_./-]+)$/.test(f.path)||f.path.includes('..'))throw Error('BUNDLE_PATH');fs.mkdirSync(require('node:path').dirname('/app/'+f.path),{recursive:true});fs.writeFileSync('/app/'+f.path,Buffer.from(f.content,'base64'));}
const r=cp.spawnSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:'/app',stdio:'inherit',env:{...process.env,npm_config_cache:'/tmp/npm'}});if(r.status!==0)process.exit(1);
fs.chownSync('/data',1000,1000);console.log('Neslos measured bundle ready: ${hash}');`;
const chunks = payload.match(/.{1,60000}/g);
const image = 'node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c';
const common = { image, platform: 'linux/amd64', read_only: true, security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,noexec,nosuid,size=256m'], logging: { driver: 'json-file', options: { 'max-size': '5m', 'max-file': '2' } } };
const compose = YAML.stringify({services:{
  setup: {...common, user:'0:0', restart:'no', cap_drop:['ALL'], cap_add:['CHOWN'], command:['node','-e',setup,...chunks], volumes:['neslos-app:/app','neslos-journal:/data']},
  neslos: {...common,user:'1000:1000',group_add:['0'],restart:'unless-stopped',cap_drop:['ALL'],working_dir:'/app',stop_grace_period:'140s',depends_on:{setup:{condition:'service_completed_successfully'}},
    command:['node','-e',verify],ports:['8443:8443'],volumes:['neslos-app:/app:ro','neslos-journal:/data','/var/run/dstack.sock:/var/run/dstack.sock:ro'],
    environment:{NODE_ENV:'production',HOST:'0.0.0.0',PORT:'8443',NESLOS_JOURNAL:'/data/neslos-audit.json',NESLOS_RUNTIME_MODE:'${NESLOS_RUNTIME_MODE:-attestation-only}',NESLOS_NETWORK:'${NESLOS_NETWORK:-testnet}',NESLOS_VAULT_ACCOUNT:'${NESLOS_VAULT_ACCOUNT:-vault.neslos.testnet}',NESLOS_TEE_POLICY_JSON:'${NESLOS_TEE_POLICY_JSON:-}',NESLOS_INFERENCE_POLICY_JSON:'${NESLOS_INFERENCE_POLICY_JSON:-}',NESLOS_OWNER_TOKEN:'${NESLOS_OWNER_TOKEN:-}',NEARAI_API_KEY:'${NEARAI_API_KEY:-}',ONECLICK_JWT:'${ONECLICK_JWT:-}',NESLOS_DSTACK_SOCKET:'/var/run/dstack.sock'},
    healthcheck:{test:['CMD','node','-e','fetch("http://127.0.0.1:8443/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'],interval:'30s',timeout:'5s',start_period:'120s',retries:3}
  }
},volumes:{'neslos-app':{},'neslos-journal':{}}},{lineWidth:0});
const directory = resolve(values.out); await mkdir(directory,{recursive:true,mode:0o700});
const manifest={format:'neslos-tee-inline-deployment-v1',generatedAt:new Date().toISOString(),image,bundleSha256:hash,composeSha256:sha(compose),compressedBytes:bytes.length,fileCount:files.length,files:files.map(f=>({path:f.path,sha256:sha(Buffer.from(f.content,'base64'))})),source:sourceIdentity(),status:'prepared-not-deployed'};
await writeFile(resolve(directory,'compose.yaml'),compose,{flag:'wx',mode:0o600});
await writeFile(resolve(directory,'deployment.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({directory,image,bundleSha256:hash,composeSha256:manifest.composeSha256,compressedBytes:bytes.length,fileCount:files.length},null,2));
