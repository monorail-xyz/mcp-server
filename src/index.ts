#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import axios from "axios";

// API endpoints
const API_ENDPOINTS = {
    QUOTE_API: "https://testnet-pathfinder-v2.monorail.xyz",
    DATA_API: "https://testnet-api.monorail.xyz",
};

// Define the API response types based on the Swagger documentation
interface ErrorResponse {
    message: string;
}

interface TokenDetails {
    address: string;
    categories: string[];
    decimals: number;
    name: string;
    symbol: string;
}

interface TokenBalance {
    address: string;
    balance: string;
    categories: string[];
    decimals: number;
    id: string;
    name: string;
    symbol: string;
}

interface TokenResult {
    address: string;
    balance: string;
    categories: string[];
    decimals: string; // Note: API returns this as string
    id: string;
    name: string;
    symbol: string;
}

// Token categories as defined in the API
type TokenCategory = 'wallet' | 'verified' | 'stable' | 'lst' | 'bridged' | 'meme';

// Schema definitions for tool arguments
const GetTokenArgsSchema = z.object({
    contractAddress: z.string().describe("Token contract address"),
});

const GetTokensArgsSchema = z.object({
    find: z.string().optional().describe("The partial name or ticker of the token to find"),
    offset: z.union([z.string(), z.number()]).optional().describe("The offset to start the list from"),
    limit: z.union([z.string(), z.number()]).optional().describe("The maximum amount of tokens to return"),
});

const GetTokensByCategoryArgsSchema = z.object({
    category: z.enum([
        "wallet", "verified", "stable", "lst", "bridged", "meme"
    ]).describe("Category of tokens to fetch, verified and wallet must be preferred, ask for confirmation when using any other"),
    address: z.string().optional().describe("Monad address to include token balances for (required for wallet category)"),
    offset: z.number().optional().default(0).describe("Pagination offset"),
    limit: z.number().optional().default(500).describe("Maximum number of results to return"),
});

const GetWalletBalancesArgsSchema = z.object({
    address: z.string().describe("The address to fetch balances for"),
});

// Quote schema
const GetQuoteArgsSchema = z.object({
    amount: z.union([z.string(), z.number()]).describe("Human readable amount to swap"),
    from: z.string().describe("Token address to swap from, use the data API verified category to get the address from the name or symbol"),
    to: z.string().describe("Token address to swap to, use the data API verified category to get the address from the name symbol"),
    sender: z.string().optional().describe("Address of the wallet that will execute the transaction"),
    slippage: z.number().optional().describe("Slippage tolerance in basis points (default: 50)"),
    deadline: z.number().optional().describe("Deadline in seconds (default: 60)"),
    max_hops: z.number().optional().describe("Maximum number of hops (1-5, default: 3)"),
    excluded: z.string().optional().describe("Comma separated list of protocols to exclude"),
    source: z.string().optional().describe("Source of the request (for fee sharing)"),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

/**
 * Monorail Data API client
 */
class MonorailDataApi {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    /**
     * Get a token by contract address
     * @param contractAddress The token contract address
     */
    async getToken(contractAddress: string): Promise<TokenDetails> {
        try {
            const response = await axios.get(`${this.baseUrl}/v1/token/${contractAddress}`);
            return response.data;
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Get a list of all available tokens
     * @param options Optional parameters for filtering and pagination
     */
    async getTokens(options?: {
        find?: string;
        offset?: string | number;
        limit?: string | number;
    }): Promise<TokenResult[]> {
        try {
            const response = await axios.get(`${this.baseUrl}/v1/tokens`, {
                params: options
            });
            return response.data;
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Get tokens by category
     * @param category Category of tokens to fetch
     * @param options Optional parameters for filtering and pagination
     */
    async getTokensByCategory(
        category: TokenCategory,
        options?: {
            address?: string;
            offset?: number;
            limit?: number;
        }
    ): Promise<TokenResult[]> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/v1/tokens/category/${category}`,
                { params: options }
            );
            return response.data;
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Get a count of all available tokens
     */
    async getTokenCount(): Promise<number> {
        try {
            const response = await axios.get(`${this.baseUrl}/v1/tokens/count`);
            return response.data;
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Get wallet balances for an address
     * @param address The wallet address to fetch balances for
     */
    async getWalletBalances(address: string): Promise<TokenBalance[]> {
        try {
            const response = await axios.get(
                `${this.baseUrl}/v1/wallet/${address}/balances`
            );
            return response.data;
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Handle API errors
     */
    private handleError(error: any): void {
        if (axios.isAxiosError(error) && error.response) {
            const errorData = error.response.data as ErrorResponse;
            console.error(`API Error: ${errorData.message || error.message}`);
        } else {
            console.error(`Error: ${error.message}`);
        }
    }
}

/**
 * Monorail Quote API client
 */
class MonorailQuoteApi {
    private baseUrl: string;
    private dataApi: MonorailDataApi;

    constructor(baseUrl: string, dataApi: MonorailDataApi) {
        this.baseUrl = baseUrl + "/v1/quote";
        this.dataApi = dataApi;
    }

    /**
     * Resolves a token identifier (symbol or address) to its address
     * @param tokenIdentifier Token symbol or address
     */
    async resolveTokenAddress(tokenIdentifier: string): Promise<string> {
        // If it looks like an address already, return it
        if (tokenIdentifier.startsWith("0x") && tokenIdentifier.length >= 40) {
            return tokenIdentifier;
        }

        // Check if it's native token
        if (tokenIdentifier.toLowerCase() === "mon") {
            return "0x0000000000000000000000000000000000000000";
        }

        // Find the token by symbol
        try {
            // Get verified tokens first
            const verifiedTokens = await this.dataApi.getTokensByCategory("verified");

            // Look for a matching symbol (case insensitive)
            const token = verifiedTokens.find(t =>
                t.symbol.toLowerCase() === tokenIdentifier.toLowerCase()
            );

            if (token) {
                return token.address;
            }

            // If not found in verified tokens, search all tokens
            const tokenResults = await this.dataApi.getTokens({ find: tokenIdentifier });

            if (tokenResults.length > 0) {
                // Find exact match by symbol first
                const exactMatch = tokenResults.find(t =>
                    t.symbol.toLowerCase() === tokenIdentifier.toLowerCase()
                );

                if (exactMatch) {
                    return exactMatch.address;
                }

                // Otherwise return the first result
                return tokenResults[0].address;
            }
        } catch (error: any) {
            console.error(`Error resolving token: ${error.message}`);
        }

        throw new Error(`Token not found: ${tokenIdentifier}`);
    }

    /**
     * Get a quote for a token swap
     * @param args Quote parameters
     */
    async getQuote(args: {
        amount: string | number;
        from: string;
        to: string;
        sender?: string;
        slippage?: number;
        deadline?: number;
        max_hops?: number;
        excluded?: string;
        source?: string;
    }) {
        try {
            // Resolve token addresses from symbols if provided
            const fromAddress = await this.resolveTokenAddress(args.from);
            const toAddress = await this.resolveTokenAddress(args.to);

            // Build query params
            const params = new URLSearchParams();
            params.append("amount", args.amount.toString());
            params.append("from", fromAddress);
            params.append("to", toAddress);

            if (args.sender) params.append("sender", args.sender);
            if (args.slippage !== undefined) params.append("slippage", args.slippage.toString());
            if (args.deadline !== undefined) params.append("deadline", args.deadline.toString());
            if (args.max_hops !== undefined) params.append("max_hops", args.max_hops.toString());
            if (args.excluded) params.append("excluded", args.excluded);
            // Set the source to this MCP server
            params.append("source", "monorail-mcp");

            // Make API request
            const response = await axios.get(`${this.baseUrl}?${params.toString()}`);

            if (response.status !== 200) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                const errorData = error.response.data as ErrorResponse;
                throw new Error(`Quote API Error: ${errorData.message || error.message}`);
            } else {
                throw new Error(`Failed to get quote: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}

// Create API instances
const dataApi = new MonorailDataApi(API_ENDPOINTS.DATA_API);
const quoteApi = new MonorailQuoteApi(API_ENDPOINTS.QUOTE_API, dataApi);

// Server setup
const server = new Server(
    {
        name: "monorail-api-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

// Register tools with the server
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_token",
                description: "Get a token based on the contract address, you must provide a contract address for a token. The contract address must be on Monad and come from this API",
                inputSchema: zodToJsonSchema(GetTokenArgsSchema) as ToolInput,
            },
            {
                name: "get_tokens",
                description: "Get a list of all available tokens with optional filtering and pagination. Use this to find tokens by name or ticker.",
                inputSchema: zodToJsonSchema(GetTokensArgsSchema) as ToolInput,
            },
            {
                name: "get_tokens_by_category",
                description:
                    "Get a list of tokens in a specific category. " +
                    "Categories include wallet, verified, stable, lst, bridged, and meme. " +
                    "When using the 'wallet' category, an address parameter is required. Verified and wallet must be preferred, ask for confirmation when using any other",
                inputSchema: zodToJsonSchema(GetTokensByCategoryArgsSchema) as ToolInput,
            },
            {
                name: "get_token_count",
                description: "Get the total count of available tokens",
                inputSchema: zodToJsonSchema(z.object({})) as ToolInput,
            },
            {
                name: "get_wallet_balances",
                description: "Get the balances of all tokens for an address",
                inputSchema: zodToJsonSchema(GetWalletBalancesArgsSchema) as ToolInput,
            },
            {
                name: "get_quote",
                description:
                    "Get a quote for a token swap from the Monorail API. " +
                    "Retrieve the best available price and transaction details for swapping one token to another. " +
                    "You must provide an address to get transaction information." +
                    "You should resolve the token name or symbol to address using the data API, Verified and wallet must be preferred, ask for confirmation when using any other." +
                    "Once resolved, use the information to get a quote using this quote call" +
                    "You must alert the user if the price impact is higher than 20%" +
                    "It is advised to check the user wallet balance for the input token and aler them if the balance is too low to complete the swap",
                inputSchema: zodToJsonSchema(GetQuoteArgsSchema) as ToolInput,
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: args } = request.params;

        switch (name) {
            case "get_token": {
                const parsed = GetTokenArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for get_token: ${parsed.error}`);
                }
                const result = await dataApi.getToken(parsed.data.contractAddress);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            case "get_tokens": {
                const parsed = GetTokensArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for get_tokens: ${parsed.error}`);
                }
                const result = await dataApi.getTokens(parsed.data);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            case "get_tokens_by_category": {
                const parsed = GetTokensByCategoryArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for get_tokens_by_category: ${parsed.error}`);
                }
                const result = await dataApi.getTokensByCategory(
                    parsed.data.category,
                    {
                        address: parsed.data.address,
                        offset: parsed.data.offset,
                        limit: parsed.data.limit
                    }
                );
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            case "get_token_count": {
                const result = await dataApi.getTokenCount();
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            case "get_wallet_balances": {
                const parsed = GetWalletBalancesArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for get_wallet_balances: ${parsed.error}`);
                }
                const result = await dataApi.getWalletBalances(parsed.data.address);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            case "get_quote": {
                const parsed = GetQuoteArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for get_quote: ${parsed.error}`);
                }
                const result = await quoteApi.getQuote(parsed.data);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        console.error("Tool call error:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            isError: true,
        };
    }
});

// Start server
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});