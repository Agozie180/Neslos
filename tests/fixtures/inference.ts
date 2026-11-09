/** Synthetic approval values used only at mocked hardware/provider boundaries. */
import { canonical, sha256 } from '../../src/core/crypto.js';
export const inferenceBootFixture = { mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48) };
export const gatewayAppComposeFixture = JSON.stringify({ docker_compose_file: JSON.stringify({ services: {
  api: { image: 'nearaidev/cloud-api@sha256:' + 'a'.repeat(64) },
  ingress: { image: 'nearaidev/cvm-ingress@sha256:' + 'b'.repeat(64) },
} }) });
export const modelDeploymentFixture = { commit: 'a'.repeat(40), file: 'prod/test.yaml', fileSha256: 'b'.repeat(64), managerImage: `nearaidev/compose-manager@sha256:${'c'.repeat(64)}`, services: ['test-proxy'], actionsSha256: '' };
export const composeManagerFixture = { actions: [
  { timestamp: '2026-11-06T00:00:00Z', action: 'compose_up', commit: modelDeploymentFixture.commit, file: modelDeploymentFixture.file, file_sha256: modelDeploymentFixture.fileSha256, services: modelDeploymentFixture.services },
  { timestamp: '2026-11-06T00:00:01Z', action: 'compose_manager_started', image: modelDeploymentFixture.managerImage },
], tcbStatus: 'UpToDate' as const, advisoryIds: [], runtimeMeasurements: {} };
modelDeploymentFixture.actionsSha256 = sha256(canonical(composeManagerFixture.actions));
