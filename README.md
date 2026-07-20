# Shopify Integration App (Simulated Core + Admin Panel + MCP AI Agent)

This project is a high-fidelity, beginner-friendly prototype of a Shopify Integration application. It implements a fully functional local simulator for Shopify's platform, including OAuth handshakes, HMAC validation, uninstallation webhooks, store action panels, and a secondary AI Agent connected via standard Model Context Protocol (MCP) tool-calling schemas.

## Tech Stack
- **Backend**: Node.js + Express (serving simulated Shopify core features and the MCP Agent JSON-RPC endpoints)
- **Frontend**: React (Vite) + Premium Glassmorphic Vanilla CSS (completely responsive, dual-pane view)
- **Database**: Local JSON-file storage (`database.json`) simulating a real store's inventory
- **MCP Protocol**: Standard JSON-RPC 2.0 schemas for tools (`list_products`, `create_product`, `adjust_inventory`)

---

## Features

1. **Dual-Pane Simulator UI**:
   - **Left Panel (Shopify Simulated Core)**: Acts as the Shopify platform. Manage store domain, trigger installation redirect, approve scopes in a simulated consent screen, watch the live product database, or trigger `app/uninstalled` webhooks.
   - **Right Panel (App Admin Dashboard)**: The integration dashboard itself. Shows connection status, active tokens, logs of operations, and a selector to toggle between manual actions and the AI Agent.
2. **Robust OAuth Simulation**:
   - Executes standard OAuth redirection and consent flow.
   - Implements **HMAC signature generation and verification** using Node's native `crypto` module during token exchanges.
3. **Webhook Verification**:
   - Simulates the Shopify `app/uninstalled` webhook, complete with signature validation headers, cleanly wiping session tokens.
4. **Action Handlers**:
   - **Read Action**: Fetch all products and display stock levels.
   - **Write Actions**: Create new products and adjust inventory levels.
   - **Safety Feature**: All write actions (creation & inventory adjustments) require explicit human confirmation before executing, safeguarding the database.
5. **Secondary AI Agent with MCP Tools**:
   - A custom chatbot client that reasons about queries and triggers actions using the Model Context Protocol (JSON-RPC).
   - If you tell the agent to list products, it fetches them automatically.
   - If you tell the agent to add a product or adjust inventory, the chat intercepts the tool call, showcases the raw JSON-RPC payload, and requests explicit **Approve/Reject confirmation** from you before firing.

---

## How to Set Up and Run Locally

### Prerequisites
- Node.js installed (v18 or above recommended)
- Git (if pulling or committing changes)

### Installation
1. Clone the repository and navigate to the project directory:
   ```bash
   git clone https://github.com/Akarshak-sharma/Shopify-Integration.git
   cd Shopify-Integration
   ```

2. Install all dependencies for both the backend and frontend with a single command:
   ```bash
   npm run install-all
   ```
   *(This runs `npm install` in the root and in the `frontend/` directory).*

### Running the App
1. Start both the backend Express server and Vite frontend concurrently:
   ```bash
   npm run dev
   ```
2. Open your browser and navigate to:
   **[http://localhost:5173](http://localhost:5173)**

3. Start experimenting!
   - Type a store name (e.g., `my-dev-store.myshopify.com`) and click **Install App**.
   - Approve the requested permissions on the consent screen.
   - Run manual actions (fetch products, create a product, or modify stock levels) and watch the Shopify Database update on the left.
   - Switch to the **AI Assistant** tab and ask the chatbot to execute actions. Observe how it uses JSON-RPC MCP commands, and confirm/deny write actions.
   - Click **Uninstall App** on the left to fire the uninstalled webhook, verifying that the tokens are deleted.

---

## Architecture & Design Trade-Offs

- **Simulated Shopify Core**: In production, Shopify apps require a public HTTPS tunnel (such as ngrok) and a real Shopify Partner dashboard to test OAuth. By simulating the Shopify Core and OAuth endpoints directly on our Express backend, we make the codebase **entirely self-contained and run-from-anywhere** without dependencies on external networks or accounts. This is highly beginner-friendly and perfect for demonstrations.
- **Vanilla CSS**: We chose standard CSS variables, flexbox, and grid layouts to ensure clean style rules without importing heavy frameworks (like Tailwind). The aesthetics leverage a high-fidelity glassmorphic dark theme, Outift fonts, and micro-transitions.
- **In-Memory + JSON Database**: Using a JSON file for the store product database keeps the code easy to explain, easy to reset, and easy to run without database server installations (Postgres, MongoDB, etc.).
- **Mock NLP Router for AI Agent**: Instead of requiring a paid OpenAI or Anthropic API key, we designed a lightweight regex and keyword-based NLP parser on the backend to route queries to correct MCP tools. This makes the agent functional immediately, although it can easily be swapped with a real LLM SDK if an API key is provided.

---

## What We'd Improve with More Time

1. **Real LLM SDK Integration**: Connect the chat backend to a real Gemini or Claude model using `@google/generative-ai` or `@anthropic-ai/sdk`, passing the MCP schemas dynamically.
2. **Persistent DB**: Use a database like SQLite or MongoDB with Prisma ORM for production-grade reliability.
3. **Session Store**: Move app sessions and tokens from memory to Redis or database persistence.
4. **Unit Tests**: Implement Jest/Supertest suite for the express OAuth callback validation and webhook signing logic.
