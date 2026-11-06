/** Official @phala/cloud limit for docker_compose_file + pre_launch_script, in UTF-8 bytes.
 * Source: Phala-Network/phala-cloud js/src/types/app_compose.ts.
 */
export const PHALA_MAX_COMPOSE_PAYLOAD_BYTES = 200 * 1024;

export function assertPhalaComposePayloadSize(dockerComposeFile, preLaunchScript = '') {
  if (typeof dockerComposeFile !== 'string' || typeof preLaunchScript !== 'string') throw new Error('PHALA_COMPOSE_PAYLOAD_TYPE');
  const bytes = Buffer.byteLength(dockerComposeFile, 'utf8') + Buffer.byteLength(preLaunchScript, 'utf8');
  if (bytes > PHALA_MAX_COMPOSE_PAYLOAD_BYTES) {
    throw new Error(`PHALA_COMPOSE_PAYLOAD_TOO_LARGE: ${bytes} UTF-8 bytes exceeds the ${PHALA_MAX_COMPOSE_PAYLOAD_BYTES}-byte combined compose/pre-launch-script limit. No deployment bundle was written.`);
  }
  return bytes;
}
