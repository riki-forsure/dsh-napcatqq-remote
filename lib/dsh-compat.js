import { randomUUID } from "node:crypto";

/**
 * Keep the QQ message shape independent from a particular DSH package copy.
 * DSH has kept this wire shape stable while helper export locations evolved.
 */
export function createUserMessageCompat(input, api = {}, idFactory = randomUUID) {
  if (typeof api?.createUserMessage === "function") return api.createUserMessage(input);
  return {
    ...input,
    role: "user",
    id: idFactory(),
  };
}

/**
 * Model selection is an enhancement: agent creation still receives provider
 * and model options when an older/newer host does not expose this helper.
 */
export async function installModelSelectionCompat(agentCtx, selection, api) {
  let hostApi = api;
  if (hostApi === undefined) {
    try {
      hostApi = await import("@deepseek-ai/dsh-agent");
    } catch {
      return false;
    }
  }
  if (typeof hostApi?.installModelSelection !== "function") return false;
  hostApi.installModelSelection(agentCtx, selection);
  return true;
}
