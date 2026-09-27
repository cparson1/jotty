import { NextRequest, NextResponse } from "next/server";
import { verifyMcpToken } from "@/app/_utils/mcp-auth";
import { readJsonFile } from "@/app/_server/actions/file";
import { USERS_FILE } from "@/app/_consts/files";
import { createList, getListById } from "@/app/_server/actions/checklist";
import { createItem } from "@/app/_server/actions/checklist-item";
import { User } from "@/app/_types";

export const dynamic = "force-dynamic";

const SERVER_NAME = "jotty-mcp";
const SERVER_VERSION = "1.0.0";
const TOOL_NAME = "upload_grocery_list";

type GroceryItemInput = {
  name: string;
  quantity?: string | null;
  section: string;
  tags?: string[];
};

function unauthorized(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

// Single-user instance: whichever account has an API key (created via the
// normal Profile -> Settings flow) is the owner every MCP-uploaded
// checklist gets created under.
async function getMcpUser(): Promise<User | null> {
  const users = ((await readJsonFile(USERS_FILE)) || []) as User[];
  return users.find((u: any) => !!u.apiKey) || users[0] || null;
}

function toItemText(item: GroceryItemInput): string {
  let text = item.quantity ? `${item.name} (${item.quantity})` : item.name;
  text += ` @${item.section}`;
  for (const tag of item.tags || []) {
    text += ` #${tag}`;
  }
  return text;
}

async function uploadGroceryList(args: {
  week_of?: string;
  items?: GroceryItemInput[];
}) {
  const user = await getMcpUser();
  if (!user) {
    throw new Error("No jotty user available to own the checklist");
  }

  const weekOf = args.week_of || new Date().toISOString().slice(0, 10);
  const title = `Groceries - Week of ${weekOf}`;

  const createFormData = new FormData();
  createFormData.append("title", title);
  createFormData.append("category", "Groceries");
  createFormData.append("type", "simple");
  createFormData.append("user", JSON.stringify(user));

  const createResult = await createList(createFormData);
  if (createResult.error || !createResult.data) {
    throw new Error(createResult.error || "Failed to create checklist");
  }

  const createdId = createResult.data.uuid || createResult.data.id;
  const list = await getListById(createdId, user.username);
  if (!list) {
    throw new Error("Checklist was created but could not be reloaded");
  }

  const items = args.items || [];
  let created = 0;
  const failures: string[] = [];

  for (const item of items) {
    try {
      const itemFormData = new FormData();
      itemFormData.append("listId", list.id);
      itemFormData.append("text", toItemText(item));
      itemFormData.append("category", list.category || "Groceries");
      const result: any = await createItem(list, itemFormData, user.username, true);
      if (result?.error) {
        failures.push(`${item.name}: ${result.error}`);
      } else {
        created++;
      }
    } catch (error) {
      failures.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { title, created, total: items.length, failures };
}

export async function POST(request: NextRequest) {
  const payload = await verifyMcpToken(request.headers.get("authorization"));
  if (!payload) {
    return unauthorized(request);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const { id, method, params } = body || {};

  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
  }

  if (method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Creates a new jotty checklist for a week's grocery list, grouped by store section and tagged by meal (breakfast/lunch/staple).",
            inputSchema: {
              type: "object",
              properties: {
                week_of: {
                  type: "string",
                  description: "ISO date for the shopping trip, e.g. 2026-09-27",
                },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      quantity: { type: ["string", "null"] },
                      section: { type: "string" },
                      tags: { type: "array", items: { type: "string" } },
                    },
                    required: ["name", "section"],
                  },
                },
              },
              required: ["week_of", "items"],
            },
          },
        ],
      },
    });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    if (toolName !== TOOL_NAME) {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      });
    }
    try {
      const summary = await uploadGroceryList(params?.arguments || {});
      const text =
        `Created checklist "${summary.title}" with ${summary.created}/${summary.total} items.` +
        (summary.failures.length ? ` Failures: ${summary.failures.join("; ")}` : "");
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
          isError: summary.failures.length > 0,
        },
      });
    } catch (error) {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: error instanceof Error ? error.message : String(error) },
          ],
          isError: true,
        },
      });
    }
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method: ${method}` },
  });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
