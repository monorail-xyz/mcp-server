# Monorail MCP Server

A Model Context Protocol (MCP) server that allows you to get quotes, trade transactions and token information from Monorail's APIs allowing your AI to take advantage our aggregation of 11 exchanges and 7000+ tokens.

We originally shared the API information [in this gist](https://gist.github.com/donovansolms/d6d8a869f7a5095bdd0592c390f47d13) for anyone to use, but thought providing a full MCP server would speed things up for anyone that wants to use our APIs via AI.

### Support

We've opened up a channel in our Discord specifically for this challenge and for anyone that wants to use (or experiment) with our APIs and this MCP server. You can join our Discord at [https://discord.monorail.xyz](https://discord.monorail.xyz). We're always open for feedback if you run into anything that you'd like to see added or improved.

Alternatively, feel free to open an issue here on GitHub.

## Setup

To add this MCP server to Claude Desktop (or similar MCP client), you'll need to:

**1. Clone this repo**

```shell
git clone https://github.com/monorail-xyz/mcp-server.git monorail-mcp-server
```

or

[Download the source](https://github.com/monorail-xyz/mcp-server/archive/refs/heads/main.zip)

**2. Install the dependencies**

```shell
cd monorail-mcp-server
npm install
```

**3. Run `npm run build` to build the project**

```shell
npm run build
```

**4. Add the resulting build to your MCP client**

```json
{
  "mcpServers": {
    "monorail": {
      "command": "node",
      "args": ["C:\\path\\to\\build\\index.js"]
    }
  }
}
```

## Usage

Once the server is available within your MCP client (like Claude Desktop), you can simply ask it for token information, balances and get quotes for trades. The quotes will include the transaction data that you can use to execute the trade, however, this MCP server _DOES NOT_ implement wallet functionality to actually execute the transaction.
