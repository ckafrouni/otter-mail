/**
 * Hermes handoff over Slack. OtterMail posts the user's question (plus
 * mail-context pointers) into their existing DM with the assistant bot via
 * the Slack Web API — as the user, with their own user token — then opens a
 * slack:// deep link to that conversation. Slack deep links can't carry
 * message text, which is why the post happens API-side first.
 *
 * Token: safeStorage-encrypted (userData/assistant-slack.enc). Non-secret
 * routing (bot id, team id, DM channel id, workspace name): assistant.json.
 */

import fs from "fs/promises";
import path from "path";
import { app, safeStorage, shell } from "@glaze/core/backend";

export type AssistantStatus = {
  configured: boolean;
  botUserId: string | null;
  teamName: string | null;
};

type AssistantConfig = {
  botUserId: string;
  teamId: string;
  teamName: string;
  channelId: string;
};

async function tokenPath(): Promise<string> {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "assistant-slack.enc");
}

async function configPath(): Promise<string> {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "assistant.json");
}

async function getToken(): Promise<string> {
  try {
    const hex = await fs.readFile(await tokenPath(), "utf-8");
    return await safeStorage.decryptString(Buffer.from(hex.trim(), "hex"));
  } catch {
    return "";
  }
}

async function getConfig(): Promise<AssistantConfig | null> {
  try {
    const raw = await fs.readFile(await configPath(), "utf-8");
    const parsed = JSON.parse(raw) as AssistantConfig;
    return parsed.botUserId && parsed.teamId && parsed.channelId ? parsed : null;
  } catch {
    return null;
  }
}

type SlackResponse = { ok: boolean; error?: string } & Record<string, unknown>;

async function slackApi(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<SlackResponse> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: params ? JSON.stringify(params) : undefined,
  });
  const data = (await response.json()) as SlackResponse;
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error ?? "unknown error"}`);
  }
  return data;
}

export async function getStatus(): Promise<AssistantStatus> {
  const config = await getConfig();
  const token = await getToken();
  return {
    configured: config != null && token.length > 0,
    botUserId: config?.botUserId ?? null,
    teamName: config?.teamName ?? null,
  };
}

/**
 * Validates the token, resolves the workspace and the DM channel with the
 * bot, and persists everything. Throws with a Slack error string on bad
 * token/scopes/bot id so Settings can surface it.
 */
export async function configure(token: string, botUserId: string): Promise<AssistantStatus> {
  const auth = await slackApi(token, "auth.test");
  const im = await slackApi(token, "conversations.open", { users: botUserId });
  const channelId = (im.channel as { id?: string } | undefined)?.id;
  if (!channelId) throw new Error("Could not open a DM with that bot user.");

  const config: AssistantConfig = {
    botUserId,
    teamId: String(auth.team_id ?? ""),
    teamName: String(auth.team ?? ""),
    channelId,
  };
  const encrypted = await safeStorage.encryptString(token);
  await fs.writeFile(await tokenPath(), encrypted.toString("hex"), "utf-8");
  await fs.writeFile(await configPath(), JSON.stringify(config, null, 2), "utf-8");
  return { configured: true, botUserId, teamName: config.teamName };
}

/** Posts into the assistant DM as the user, then brings Slack to that conversation. */
export async function send(text: string): Promise<{ ok: true }> {
  const token = await getToken();
  const config = await getConfig();
  if (!token || !config) throw new Error("Assistant is not configured.");
  await slackApi(token, "chat.postMessage", {
    channel: config.channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  await shell.openExternal(`slack://channel?team=${config.teamId}&id=${config.channelId}`);
  return { ok: true };
}
