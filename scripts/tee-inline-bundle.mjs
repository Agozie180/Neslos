/** Build a measured, self-contained application bundle without a private registry.
 * The full bootstrap and compressed application bytes are inside appCompose.
 * Dependencies are fetched with package-lock integrity and no lifecycle scripts.
 * A reproduced Linux dependency digest is embedded in measured startup. Every
 * launch verifies dependencies and rejects extra application-resolution paths.
 */
import { parseArgs } from 'node:util';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { sourceIdentity } from './evidence.mjs';
import { assertPhalaComposePayloadSize } from './phala-compose.mjs';
import { TEE_NODE_IMAGE, installedApplicationGuard, validateDependencyManifest } from './tee-dependency-tree.mjs';
import { validateTeeBuild } from './tee-build.mjs';
const { values } = parseArgs({ options: { out: { type: 'string' }, dependencies: { type: 'string' }, compact: { type: 'boolean' }, 'testnet-vault': { type: 'string' }, 'attestation-only': { type: 'boolean' } }, strict: true });
if (!values.out) throw new Error('Use --out NEW_DIRECTORY after npm run build.');
const vault = values['testnet-vault'];
if (vault !== undefined && (vault.length > 64 || vault.trim() !== vault || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(vault))) throw new Error('TESTNET_VAULT_REQUIRED: use a valid named .testnet account.');
if (!values.dependencies) throw Error('DEPENDENCY_MANIFEST_REQUIRED: run scripts/tee-dependencies.mjs and pass --dependencies MANIFEST_JSON.');
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
const dependencyBytes = await readFile(values.dependencies);
if (dependencyBytes.length > 16000) throw Error('DEPENDENCY_MANIFEST_MISMATCH');
const dependencyManifest = JSON.parse(dependencyBytes.toString('utf8'));
const dependencyTreeSha256 = validateDependencyManifest(dependencyManifest, Buffer.from(files[0].content, 'base64'), Buffer.from(files[1].content, 'base64'));
const buildReceipt = validateTeeBuild(process.cwd());
await collect('dist/server'); await collect('fixtures');
if (!files.some(f => f.path === 'dist/server/tee/index.js')) throw new Error('BUILD_REQUIRED');
// Preserve every file byte, including the complete original npm lockfile. Text
// needs no inner base64 layer; binary files retain lossless base64 encoding.
// Compact packaging repairs the documented size limit, not provider policy.
const encodedFiles = values.compact ? files.map(file => {
  const original = Buffer.from(file.content, 'base64'), text = original.toString('utf8');
  return Buffer.from(text, 'utf8').equals(original) ? { path: file.path, encoding: 'utf8', content: text } : { ...file, encoding: 'base64' };
}) : files;
const archive = Buffer.from(JSON.stringify(encodedFiles));
const bytes = values.compact ? brotliCompressSync(archive, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }) : gzipSync(archive, { level: 9 });
const hash = sha(bytes), payload = bytes.toString('base64');
const verify = installedApplicationGuard(files.map(f => [f.path, sha(Buffer.from(f.content, 'base64'))]), dependencyTreeSha256) + "import('./dist/server/tee/index.js');";
const setup = `const fs=require('node:fs'),z=require('node:zlib'),c=require('node:crypto'),cp=require('node:child_process');
const b=Buffer.from(process.argv.slice(1).join(''),'base64');
if(c.createHash('sha256').update(b).digest('hex')!=='${hash}')throw Error('BUNDLE_HASH');
for(const f of JSON.parse(z.${values.compact ? 'brotliDecompressSync' : 'gunzipSync'}(b))){if(!/^(package(-lock)?\\.json|dist\\/server\\/[a-zA-Z0-9_./-]+|fixtures\\/[a-zA-Z0-9_./-]+)$/.test(f.path)||f.path.includes('..'))throw Error('BUNDLE_PATH');${values.compact ? "if(!['utf8','base64'].includes(f.encoding))throw Error('BUNDLE_ENCODING');" : ''}fs.mkdirSync(require('node:path').dirname('/app/'+f.path),{recursive:true});fs.writeFileSync('/app/'+f.path,Buffer.from(f.content,${values.compact ? 'f.encoding' : "'base64'"}));}
const r=cp.spawnSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:'/app',stdio:'inherit',env:{...process.env,npm_config_cache:'/tmp/npm'}});if(r.status!==0)process.exit(1);
fs.chownSync('/data',1000,1000);console.log('Neslos measured bundle ready: ${hash}');`;
const chunks = payload.match(/.{1,60000}/g);
const image = TEE_NODE_IMAGE;
const common = { image, platform: 'linux/amd64', read_only: true, security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,noexec,nosuid,size=256m'], logging: { driver: 'json-file', options: { 'max-size': '5m', 'max-file': '2' } } };
const compose = YAML.stringify({services:{
  setup: {...common, user:'0:0', restart:'no', cap_drop:['ALL'], cap_add:['CHOWN'], command:['node','-e',setup,...chunks], volumes:['neslos-app:/app','neslos-journal:/data']},
  neslos: {...common,user:'1000:1000',group_add:['0'],restart:'unless-stopped',cap_drop:['ALL'],working_dir:'/app',stop_grace_period:'140s',depends_on:{setup:{condition:'service_completed_successfully'}},
    command:['node','-e',verify],ports:['8443:8443'],volumes:['neslos-app:/app:ro','neslos-journal:/data','/var/run/dstack.sock:/var/run/dstack.sock:ro'],
    environment:{NODE_ENV:'production',HOST:'0.0.0.0',PORT:'8443',NESLOS_JOURNAL:'/data/neslos-audit.json',NESLOS_RUNTIME_MODE:values['attestation-only'] ? 'attestation-only' : '${NESLOS_RUNTIME_MODE:-attestation-only}',NESLOS_NETWORK:vault ? 'testnet' : '${NESLOS_NETWORK:-testnet}',NESLOS_VAULT_ACCOUNT:vault ?? '${NESLOS_VAULT_ACCOUNT:-vault.neslos.testnet}',NESLOS_TEE_POLICY_JSON:values['attestation-only'] ? '' : '${NESLOS_TEE_POLICY_JSON:-}',NESLOS_INFERENCE_ENABLED:values['attestation-only'] ? 'false' : '${NESLOS_INFERENCE_ENABLED:-true}',NESLOS_INFERENCE_POLICY_JSON:values['attestation-only'] ? '' : '${NESLOS_INFERENCE_POLICY_JSON:-}',NESLOS_OWNER_TOKEN:values['attestation-only'] ? '' : '${NESLOS_OWNER_TOKEN:-}',NEARAI_API_KEY:values['attestation-only'] ? '' : '${NEARAI_API_KEY:-}',ONECLICK_JWT:values['attestation-only'] ? '' : '${ONECLICK_JWT:-}',NESLOS_DSTACK_SOCKET:'/var/run/dstack.sock'},
    healthcheck:{test:['CMD','node','-e','fetch("http://127.0.0.1:8443/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'],interval:'30s',timeout:'5s',start_period:'120s',retries:3}
  }
},volumes:{'neslos-app':{},'neslos-journal':{}}},{lineWidth:0});
const composePayloadBytes = assertPhalaComposePayloadSize(compose);
// Recheck after reading the archive so a concurrent rebuild cannot silently mix
// sources. Also compare the collected bytes to the authenticated build output.
const currentBuild = validateTeeBuild(process.cwd());
if (currentBuild.inputsSha256 !== buildReceipt.inputsSha256 || currentBuild.outputsSha256 !== buildReceipt.outputsSha256) throw Error('TEE_BUILD_CHANGED_DURING_BUNDLE');
for (const file of files.filter(file => file.path.startsWith('dist/server/'))) {
  if (buildReceipt.files.find(expected => expected.path === file.path)?.sha256 !== sha(Buffer.from(file.content, 'base64'))) throw Error('TEE_BUILD_CHANGED_DURING_BUNDLE');
}
const directory = resolve(values.out); await mkdir(directory,{recursive:true,mode:0o700});
const manifest={format:'neslos-tee-inline-deployment-v3',generatedAt:new Date().toISOString(),image,compression:values.compact ? 'brotli' : 'gzip',dependencyTreeSha256,dependencyManifestSha256:sha(dependencyBytes),build:{inputsSha256:buildReceipt.inputsSha256,outputsSha256:buildReceipt.outputsSha256,nodeVersion:buildReceipt.nodeVersion,compilerVersion:buildReceipt.compilerVersion},bundleSha256:hash,composeSha256:sha(compose),composePayloadBytes,compressedBytes:bytes.length,fileCount:files.length,files:files.map(f=>({path:f.path,sha256:sha(Buffer.from(f.content,'base64'))})),source:sourceIdentity(),...(vault ? {target:{network:'testnet',vault}} : {}),...(values['attestation-only'] ? {runtimeMode:'attestation-only'} : {}),status:'prepared-not-deployed'};
await writeFile(resolve(directory,'compose.yaml'),compose,{flag:'wx',mode:0o600});
await writeFile(resolve(directory,'deployment.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({directory,image,bundleSha256:hash,composeSha256:manifest.composeSha256,compressedBytes:bytes.length,fileCount:files.length},null,2));
