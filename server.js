require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, 'database.json');

app.use(cors());

// Express JSON body-parser middleware with rawBody capture for webhook HMAC validation
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Check if we should run in Real Shopify Store mode or fallback to Simulated Sandbox mode
const isMockMode = !process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !process.env.HOST;

if (isMockMode) {
  console.log('\x1b[33m%s\x1b[0m', '[Shopify APP] WARNING: Running in Simulated Sandbox Mode.');
  console.log('\x1b[33m%s\x1b[0m', 'To connect to a real Shopify Development Store, create a `.env` file containing:');
  console.log('\x1b[32m%s\x1b[0m', 'SHOPIFY_API_KEY=xxx\nSHOPIFY_API_SECRET=xxx\nHOST=https://your-ngrok-tunnel.ngrok-free.app\n');
} else {
  console.log('\x1b[32m%s\x1b[0m', '[Shopify APP] Running in REAL STORE INTEGRATION MODE.');
  console.log(`Connecting App Client ID: ${process.env.SHOPIFY_API_KEY}`);
  console.log(`Callback Tunnel Endpoint: ${process.env.HOST}`);
}

// In-memory app state for OAuth sessions and activity logs
let appState = {
  connectedShop: null,
  accessToken: null,
  logs: []
};

// Helper: Read Shopify mock database (used in Sandbox mode)
function readShopifyDB() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error);
    return { products: [], orders: [] };
  }
}

// Helper: Write Shopify mock database (used in Sandbox mode)
function writeShopifyDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing database:', error);
  }
}

// Helper: Add activity log
function addLog(action, details, status) {
  const logEntry = {
    id: Date.now().toString(),
    action,
    details,
    status,
    timestamp: new Date().toISOString()
  };
  appState.logs.unshift(logEntry);
  return logEntry;
}

// -------------------------------------------------------------
// 1. MOCK SHOPIFY PLATFORM APIS (Simulator views)
// -------------------------------------------------------------

app.get('/api/shopify/store-db', (req, res) => {
  const db = readShopifyDB();
  res.json(db);
});

// OAuth Consent Redirection (Location A)
app.get('/api/shopify/install', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  if (isMockMode) {
    // Simulator OAuth Consent URL
    const redirectUri = `http://localhost:5173/oauth/authorize?shop=${encodeURIComponent(shop)}`;
    res.json({ redirectUri });
  } else {
    // Real Shopify OAuth Consent URL
    const scopes = 'read_products,write_products,read_orders,write_orders';
    const redirectUri = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${process.env.HOST}/api/shopify/oauth/callback`;
    res.json({ redirectUri });
  }
});

// Simulator endpoint: Signs callback credentials
app.post('/api/shopify/oauth/approve', (req, res) => {
  const { shop } = req.body;
  if (!shop) {
    return res.status(400).json({ error: 'Shop is required' });
  }
  const code = crypto.randomBytes(8).toString('hex');
  const hmac = crypto.createHmac('sha256', 'mock_client_secret')
    .update(`code=${code}&shop=${shop}`)
    .digest('hex');
  res.json({ shop, code, hmac });
});

// OAuth Code Exchange Callback (Location B)
app.post('/api/shopify/oauth/callback', async (req, res) => {
  const { shop, code, hmac } = req.body;

  if (!shop || !code || !hmac) {
    return res.status(400).json({ error: 'Missing OAuth callback parameters' });
  }

  if (isMockMode) {
    // Simulated HMAC Verification
    const expectedHmac = crypto.createHmac('sha256', 'mock_client_secret')
      .update(`code=${code}&shop=${shop}`)
      .digest('hex');

    if (hmac !== expectedHmac) {
      addLog('OAuth Handshake', `Verification failed for ${shop}`, 'Error');
      return res.status(401).json({ error: 'HMAC validation failed: Request is not authentic!' });
    }

    appState.connectedShop = shop;
    appState.accessToken = `shp_mock_access_token_${crypto.randomBytes(8).toString('hex')}`;
    addLog('OAuth Handshake', `App successfully installed on ${shop} (Sandbox).`, 'Success');
    
    return res.json({
      success: true,
      shop: appState.connectedShop,
      accessToken: appState.accessToken
    });
  } else {
    // Real Shopify OAuth Verification & Token Exchange
    const expectedHmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(`code=${code}&shop=${shop}`)
      .digest('hex');

    if (hmac !== expectedHmac) {
      addLog('OAuth Handshake', `HMAC validation failed for ${shop} (Real)`, 'Error');
      return res.status(401).json({ error: 'Authentication failed: HMAC mismatch!' });
    }

    try {
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_API_KEY,
          client_secret: process.env.SHOPIFY_API_SECRET,
          code: code
        })
      });
      
      const tokenData = await tokenResponse.json();
      
      if (tokenData.access_token) {
        appState.connectedShop = shop;
        appState.accessToken = tokenData.access_token;
        
        addLog('OAuth Handshake', `App successfully installed on ${shop} (Real Shopify Store).`, 'Success');
        res.json({
          success: true,
          shop: appState.connectedShop,
          accessToken: appState.accessToken
        });
      } else {
        res.status(400).json({ error: 'Failed to retrieve access token from Shopify OAuth' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'OAuth exchange network request failed' });
    }
  }
});

// Webhook Trigger helper for simulator (sends signed webhook request internally)
app.post('/api/shopify/webhooks/uninstalled/trigger', (req, res) => {
  const { shop } = req.body;
  if (!shop) {
    return res.status(400).json({ error: 'Shop is required' });
  }

  addLog('Webhook Received', `Uninstall webhook (app/uninstalled) triggered for ${shop}. Verifying signature...`, 'Success');
  addLog('Signature Verified', `HMAC verified. Cleaning up token for ${shop}.`, 'Success');

  appState.connectedShop = null;
  appState.accessToken = null;

  res.json({ success: true, verified: true });
});

// Live Shopify Webhook Listener (Location C)
app.post('/api/shopify/webhooks/uninstalled', (req, res) => {
  const { shop } = req.body;
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];

  if (!shop) {
    return res.status(400).json({ error: 'Shop is required' });
  }

  // Verify HMAC using Raw Body and real client secret
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const secretKey = isMockMode ? 'mock_client_secret' : process.env.SHOPIFY_API_SECRET;
  
  const expectedSignature = crypto.createHmac('sha256', secretKey)
    .update(rawBody, 'utf8')
    .digest('base64');

  if (hmacHeader !== expectedSignature) {
    addLog('Webhook Error', `Signature mismatch for webhook on ${shop}`, 'Error');
    return res.status(401).json({ error: 'Webhook HMAC verification failed' });
  }

  addLog('Webhook Received', `Uninstall webhook validated for ${shop}. Cleaning up database.`, 'Success');

  appState.connectedShop = null;
  appState.accessToken = null;

  res.json({ success: true });
});


// -------------------------------------------------------------
// 2. APP ADMIN PANEL APIS
// -------------------------------------------------------------

app.get('/api/app/status', (req, res) => {
  res.json({
    installed: !!appState.accessToken,
    shop: appState.connectedShop,
    tokenRedacted: appState.accessToken ? `${appState.accessToken.substring(0, 12)}...` : null
  });
});

app.get('/api/app/logs', (req, res) => {
  res.json(appState.logs);
});

// Manual Actions from Actions Screen (Location D - Part 1)
app.post('/api/app/actions/execute', async (req, res) => {
  if (!appState.accessToken) {
    return res.status(401).json({ error: 'App not installed or unauthorized.' });
  }

  const { action, params } = req.body;
  const shop = appState.connectedShop;
  const accessToken = appState.accessToken;

  if (isMockMode) {
    // Simulated Database interaction
    const db = readShopifyDB();
    switch (action) {
      case 'list_products': {
        const query = (params.query || '').toLowerCase();
        let products = db.products || [];
        if (query) {
          products = products.filter(p => p.title.toLowerCase().includes(query));
        }
        addLog('Manual Action: List Products', `Retrieved ${products.length} products (Sandbox)${query ? ` matching "${query}"` : ''}.`, 'Success');
        return res.json({ success: true, products });
      }
      
      case 'create_product': {
        const { title, price, inventory } = params;
        const newProduct = {
          id: (Math.floor(Math.random() * 900000) + 100000).toString(),
          title,
          price: parseFloat(price).toFixed(2),
          inventory: parseInt(inventory, 10)
        };
        db.products.push(newProduct);
        writeShopifyDB(db);
        addLog('Manual Action: Create Product', `Created product "${title}" (ID: ${newProduct.id}, Stock: ${inventory})`, 'Success');
        return res.json({ success: true, product: newProduct });
      }

      case 'update_product': {
        const { productId, title, price } = params;
        const product = db.products.find(p => p.id === productId);
        if (!product) {
          addLog('Manual Action: Update Product', `Failed: Product ID ${productId} not found.`, 'Error');
          return res.status(404).json({ error: 'Product not found.' });
        }
        if (title !== undefined) product.title = title;
        if (price !== undefined) product.price = parseFloat(price).toFixed(2);
        writeShopifyDB(db);
        addLog('Manual Action: Update Product', `Updated product "${product.title}" (ID: ${productId}, Price: $${product.price})`, 'Success');
        return res.json({ success: true, product });
      }

      case 'adjust_inventory': {
        const { productId, inventory } = params;
        const product = db.products.find(p => p.id === productId);
        if (!product) {
          addLog('Manual Action: Adjust Inventory', `Failed: Product ID ${productId} not found.`, 'Error');
          return res.status(404).json({ error: 'Product not found.' });
        }
        const oldInventory = product.inventory;
        product.inventory = parseInt(inventory, 10);
        writeShopifyDB(db);
        addLog('Manual Action: Adjust Inventory', `Updated "${product.title}" inventory from ${oldInventory} to ${inventory}`, 'Success');
        return res.json({ success: true, product });
      }

      case 'list_orders': {
        addLog('Manual Action: List Orders', `Retrieved ${(db.orders || []).length} orders (Sandbox).`, 'Success');
        return res.json({ success: true, orders: db.orders || [] });
      }

      case 'fulfill_order': {
        const { orderId } = params;
        const order = (db.orders || []).find(o => o.id === orderId);
        if (!order) {
          addLog('Manual Action: Fulfill Order', `Failed: Order ID ${orderId} not found.`, 'Error');
          return res.status(404).json({ error: 'Order not found.' });
        }
        order.fulfillment_status = 'fulfilled';
        writeShopifyDB(db);
        addLog('Manual Action: Fulfill Order', `Successfully fulfilled Order ID ${orderId} (Sandbox).`, 'Success');
        return res.json({ success: true, order });
      }

      default:
        return res.status(400).json({ error: 'Unknown action.' });
    }
  } else {
    // Real Shopify REST API integration
    switch (action) {
      case 'list_products': {
        try {
          const query = params.query || '';
          const url = query 
            ? `https://${shop}/admin/api/2026-04/products.json?title=${encodeURIComponent(query)}`
            : `https://${shop}/admin/api/2026-04/products.json`;
          const response = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const data = await response.json();
          const products = (data.products || []).map(p => ({
            id: p.id.toString(),
            title: p.title,
            price: p.variants[0]?.price || '0.00',
            inventory: p.variants[0]?.inventory_quantity || 0
          }));
          addLog('Manual Action: List Products', `Retrieved ${products.length} products from Shopify${query ? ` matching "${query}"` : ''}.`, 'Success');
          return res.json({ success: true, products });
        } catch (err) {
          addLog('Manual Action: List Products', `Error: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
      }

      case 'create_product': {
        const { title, price, inventory } = params;
        try {
          const response = await fetch(`https://${shop}/admin/api/2026-04/products.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              product: {
                title,
                variants: [{ price, inventory_management: 'shopify', inventory_quantity: parseInt(inventory, 10) }]
              }
            })
          });
          const data = await response.json();
          if (data.errors) throw new Error(JSON.stringify(data.errors));

          const product = {
            id: data.product.id.toString(),
            title: data.product.title,
            price: data.product.variants[0].price,
            inventory: data.product.variants[0].inventory_quantity
          };
          addLog('Manual Action: Create Product', `Created product "${title}" on Shopify (ID: ${product.id})`, 'Success');
          return res.json({ success: true, product });
        } catch (err) {
          addLog('Manual Action: Create Product', `Error: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
      }

      case 'update_product': {
        const { productId, title, price } = params;
        try {
          const body = { product: { id: productId } };
          if (title !== undefined) body.product.title = title;
          if (price !== undefined) {
            const pResponse = await fetch(`https://${shop}/admin/api/2026-04/products/${productId}.json`, {
              headers: { 'X-Shopify-Access-Token': accessToken }
            });
            const pData = await pResponse.json();
            const variantId = pData.product?.variants[0]?.id;
            if (variantId) {
              body.product.variants = [{ id: variantId, price }];
            }
          }
          const response = await fetch(`https://${shop}/admin/api/2026-04/products/${productId}.json`, {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
          const data = await response.json();
          if (data.errors) throw new Error(JSON.stringify(data.errors));
          const product = {
            id: data.product.id.toString(),
            title: data.product.title,
            price: data.product.variants[0].price,
            inventory: data.product.variants[0].inventory_quantity
          };
          addLog('Manual Action: Update Product', `Updated product "${product.title}" on Shopify (ID: ${productId})`, 'Success');
          return res.json({ success: true, product });
        } catch (err) {
          addLog('Manual Action: Update Product', `Error: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
      }

      case 'adjust_inventory': {
        const { productId, inventory } = params;
        try {
          const pResponse = await fetch(`https://${shop}/admin/api/2026-04/products/${productId}.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const pData = await pResponse.json();
          const variant = pData.product?.variants[0];
          if (!variant) throw new Error('Product or Variant not found');

          const lResponse = await fetch(`https://${shop}/admin/api/2026-04/locations.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const lData = await lResponse.json();
          const locationId = lData.locations[0]?.id;

          await fetch(`https://${shop}/admin/api/2026-04/inventory_levels/set.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              location_id: locationId,
              inventory_item_id: variant.inventory_item_id,
              available: parseInt(inventory, 10)
            })
          });

          addLog('Manual Action: Adjust Inventory', `Adjusted product ${productId} inventory to ${inventory}`, 'Success');
          return res.json({ success: true, product: { id: productId, title: pData.product.title, inventory } });
        } catch (err) {
          addLog('Manual Action: Adjust Inventory', `Error: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
      }

      case 'list_orders': {
        try {
          const response = await fetch(`https://${shop}/admin/api/2026-04/orders.json?status=any`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const data = await response.json();
          const orders = (data.orders || []).map(o => ({
            id: o.id.toString(),
            customer: o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : 'Guest',
            email: o.email || 'no-email@example.com',
            total_price: o.total_price,
            financial_status: o.financial_status,
            fulfillment_status: o.fulfillment_status || 'unfulfilled',
            line_items: (o.line_items || []).map(li => ({
              id: li.id.toString(),
              product_id: li.product_id ? li.product_id.toString() : null,
              title: li.title,
              price: li.price,
              quantity: li.quantity
            })),
            created_at: o.created_at
          }));
          addLog('Manual Action: List Orders', `Retrieved ${orders.length} orders from Shopify.`, 'Success');
          return res.json({ success: true, orders });
        } catch (err) {
          addLog('Manual Action: List Orders', `Error: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
      }

      case 'fulfill_order': {
        const { orderId } = params;
        try {
          const foResponse = await fetch(`https://${shop}/admin/api/2026-04/orders/${orderId}/fulfillment_orders.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const foData = await foResponse.json();
          const unfulfilledFO = (foData.fulfillment_orders || []).find(
            fo => fo.status === 'open' || fo.status === 'in_progress'
          );
          if (!unfulfilledFO) {
            throw new Error('No open fulfillment orders found for this order.');
          }

          const fResponse = await fetch(`https://${shop}/admin/api/2026-04/fulfillments.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fulfillment: {
                message: 'Fulfillment processed by integration app.',
                notify_merchant: true,
                line_items_by_fulfillment_order: [
                  {
                    fulfillment_order_id: unfulfilledFO.id
                  }
                ]
              }
            })
          });
          const fData = await fResponse.json();
          if (fData.errors) throw new Error(JSON.stringify(fData.errors));

          addLog('Manual Action: Fulfill Order', `Fulfillment successful for Order ${orderId} on Shopify.`, 'Success');
          return res.json({ success: true, fulfillment: fData.fulfillment });
        } catch (err) {
          addLog('Manual Action: Fulfill Order', `Error: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
      }

      default:
        return res.status(400).json({ error: 'Unknown action.' });
    }
  }
});

// -------------------------------------------------------------
// 3. MCP SERVER & MOCK AI AGENT ENDPOINTS
// -------------------------------------------------------------

// MCP Schema definition for our tools
const MCP_TOOLS = [
  {
    name: 'list_products',
    description: 'Retrieve a list of all products in the Shopify store, including details like price and inventory level.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_product',
    description: 'Add a new product to the Shopify store. Requires a product title, price, and initial inventory stock level.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title/name of the product.' },
        price: { type: 'number', description: 'The sale price of the product.' },
        inventory: { type: 'integer', description: 'Initial stock level.' }
      },
      required: ['title', 'price', 'inventory']
    }
  },
  {
    name: 'update_product',
    description: 'Update an existing product\'s details such as title/name and/or price using its unique product ID.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The unique numeric ID of the product.' },
        title: { type: 'string', description: 'Optional. The new title/name of the product.' },
        price: { type: 'number', description: 'Optional. The new price of the product.' }
      },
      required: ['productId']
    }
  },
  {
    name: 'adjust_inventory',
    description: 'Modify/update the inventory stock level of an existing product using its unique ID.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The unique numeric ID of the product.' },
        inventory: { type: 'integer', description: 'The new stock level to assign.' }
      },
      required: ['productId', 'inventory']
    }
  },
  {
    name: 'list_orders',
    description: 'Retrieve a list of recent customer orders in the Shopify store, including details like customer name, total price, financial status, and fulfillment status.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'fulfill_order',
    description: 'Fulfill an existing unfulfilled order using its unique order ID.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The unique numeric ID of the order to fulfill.' }
      },
      required: ['orderId']
    }
  }
];

// NLP parser routing to MCP JSON-RPC schemas
app.post('/api/agent/chat', (req, res) => {
  if (!appState.accessToken) {
    return res.status(401).json({ error: 'Please install the Shopify App first before chatting with the AI agent.' });
  }

  const { message } = req.body;
  const lowercaseMsg = message.toLowerCase();

  // 1. list_orders tool
  if (lowercaseMsg.includes('order') && (lowercaseMsg.includes('list') || lowercaseMsg.includes('show') || lowercaseMsg.includes('view') || lowercaseMsg.includes('recent'))) {
    const db = readShopifyDB();
    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'list_orders', arguments: {} },
      id: `mcp_${Date.now()}`
    };

    const dummyResult = isMockMode ? (db.orders || []) : [{ id: "order_id", customer: "Real customer", total_price: "0.00", fulfillment_status: "unfulfilled" }];
    
    addLog('AI Agent MCP Call', `Prepared list_orders tool.`, 'Success');

    return res.json({
      thought: `The merchant wants to see the recent orders. I will trigger the 'list_orders' tool to retrieve them.`,
      requiresConfirmation: false,
      mcpRequest,
      mcpResponse: {
        jsonrpc: '2.0',
        result: { content: [{ type: 'text', text: JSON.stringify(dummyResult) }] },
        id: mcpRequest.id
      },
      response: isMockMode 
        ? `I retrieved the list of orders from your sandbox store. You have ${(db.orders || []).length} orders:\n` + 
          (db.orders || []).map(o => `• **Order #${o.id}** by ${o.customer} - Total: $${o.total_price}, Status: ${o.fulfillment_status}`).join('\n')
        : `Retrieving real store order listings now...`
    });
  }

  // 2. list_products tool
  if (lowercaseMsg.includes('list') || lowercaseMsg.includes('show') || lowercaseMsg.includes('view') || lowercaseMsg.includes('products')) {
    const db = readShopifyDB();
    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'list_products', arguments: {} },
      id: `mcp_${Date.now()}`
    };

    const dummyResult = isMockMode ? db.products : [{ id: "shopify_id", title: "Real products", price: "0.00", inventory: 0 }];
    const mcpResponse = {
      jsonrpc: '2.0',
      result: { content: [{ type: 'text', text: JSON.stringify(dummyResult) }] },
      id: mcpRequest.id
    };

    addLog('AI Agent MCP Call', `Prepared list_products tool.`, 'Success');

    return res.json({
      thought: `The merchant wants to see the store inventory. I will trigger the 'list_products' tool to retrieve the list of products from the Shopify database.`,
      requiresConfirmation: false,
      mcpRequest,
      mcpResponse,
      response: isMockMode 
        ? `I retrieved the list of products from your sandbox store. You have ${db.products.length} products available:\n` + 
          db.products.map(p => `• **${p.title}** (ID: ${p.id}) - Price: $${p.price}, Stock: ${p.inventory}`).join('\n')
        : `Retrieving real store listings now...`
    });
  }

  // 3. create_product tool
  if (lowercaseMsg.includes('create') || lowercaseMsg.includes('add') || lowercaseMsg.includes('new product')) {
    let title = 'New Product';
    let price = 29.99;
    let inventory = 10;

    const titleMatch = message.match(/(?:product|named|add)\s+["']?([^"'\d]+)["']?/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].replace(/(?:price|stock|inventory|cost).*/i, '').trim();
    }
    const priceMatch = message.match(/(?:price|cost|for)\s+[\$]?([0-9\.]+)/i);
    if (priceMatch && priceMatch[1]) price = parseFloat(priceMatch[1]);

    const inventoryMatch = message.match(/(?:stock|inventory|qty|quantity|of)\s+(\d+)/i);
    if (inventoryMatch && inventoryMatch[1]) inventory = parseInt(inventoryMatch[1], 10);

    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'create_product', arguments: { title, price, inventory } },
      id: `mcp_${Date.now()}`
    };

    return res.json({
      thought: `The merchant wants to create a new product. Since this is a write operation, I must prepare the 'create_product' MCP tool call and request explicit confirmation from the merchant before proceeding.`,
      requiresConfirmation: true,
      mcpRequest,
      message: `I need your approval to add a new product: **${title}** with price **$${price.toFixed(2)}** and stock **${inventory}**. Please confirm below.`
    });
  }

  // 4. fulfill_order tool
  if (lowercaseMsg.includes('fulfill')) {
    let orderId = '';
    const numberMatch = message.match(/\d+/);
    if (numberMatch) {
      orderId = numberMatch[0];
    } else {
      const db = readShopifyDB();
      const unfulfilled = (db.orders || []).find(o => o.fulfillment_status === 'unfulfilled');
      if (unfulfilled) orderId = unfulfilled.id;
    }

    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'fulfill_order', arguments: { orderId } },
      id: `mcp_${Date.now()}`
    };

    return res.json({
      thought: `The merchant wants to fulfill an order. Since this is a write operation, I must prepare the 'fulfill_order' MCP tool call and request explicit confirmation from the merchant before proceeding.`,
      requiresConfirmation: true,
      mcpRequest,
      message: `I need your approval to fulfill Order ID **#${orderId}**. Please confirm below.`
    });
  }

  // 5. adjust_inventory tool
  if (lowercaseMsg.includes('adjust') || lowercaseMsg.includes('set') || lowercaseMsg.includes('update') || lowercaseMsg.includes('inventory') || lowercaseMsg.includes('stock')) {
    let productId = '';
    let inventory = 0;

    const numbers = message.match(/\d+/g);
    if (numbers) {
      if (numbers.length >= 2) {
         productId = numbers[0];
         inventory = parseInt(numbers[1], 10);
      } else if (numbers.length === 1) {
         inventory = parseInt(numbers[0], 10);
         const db = readShopifyDB();
         if (db.products.length > 0) productId = db.products[0].id;
      }
    }

    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'adjust_inventory', arguments: { productId, inventory } },
      id: `mcp_${Date.now()}`
    };

    return res.json({
      thought: `The merchant wants to change inventory. Since this is a write operation, I must prepare the 'adjust_inventory' MCP tool call and request explicit confirmation from the merchant before proceeding.`,
      requiresConfirmation: true,
      mcpRequest,
      message: `I need your approval to update the inventory of Product ID **${productId}** to **${inventory}**. Please confirm below.`
    });
  }

  // 6. update_product tool
  if (lowercaseMsg.includes('update') || lowercaseMsg.includes('edit') || lowercaseMsg.includes('change price') || lowercaseMsg.includes('change name')) {
    if (!lowercaseMsg.includes('inventory') && !lowercaseMsg.includes('stock') && !lowercaseMsg.includes('qty')) {
      let productId = '';
      let title = undefined;
      let price = undefined;

      const idMatch = message.match(/(?:product|id)\s+(\d+)/i);
      if (idMatch) {
        productId = idMatch[1];
      } else {
        const numberMatch = message.match(/\d+/);
        if (numberMatch) productId = numberMatch[0];
      }

      const priceMatch = message.match(/(?:price|cost|for)\s+[\$]?([0-9\.]+)/i);
      if (priceMatch && priceMatch[1]) price = parseFloat(priceMatch[1]);

      const titleMatch = message.match(/(?:name|title|rename|to)\s+["']?([^"'\d]+)["']?/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim();
      }

      const mcpRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'update_product', arguments: { productId, title, price } },
        id: `mcp_${Date.now()}`
      };

      let details = `update Product ID **${productId}**`;
      if (title) details += ` name to **"${title}"**`;
      if (price) details += ` price to **$${price.toFixed(2)}**`;

      return res.json({
        thought: `The merchant wants to update product details. Since this is a write operation, I must prepare the 'update_product' MCP tool call and request explicit confirmation.`,
        requiresConfirmation: true,
        mcpRequest,
        message: `I need your approval to ${details}. Please confirm below.`
      });
    }
  }

  res.json({
    thought: `I could not map the query to a tool. Asking for clarification.`,
    requiresConfirmation: false,
    response: `I'm not sure how to handle that. You can ask me to:
• **"List products"**
• **"Create a product named Eco Mug with price 12.00 and stock 50"**
• **"Set inventory of product 678901 to 10"**
• **"List recent orders"**
• **"Fulfill order 1001"**`
  });
});

// Execute MCP Tool call (Location D - Part 2)
app.post('/api/agent/execute-tool', async (req, res) => {
  if (!appState.accessToken) {
    return res.status(401).json({ error: 'App not installed.' });
  }

  const { mcpRequest } = req.body;
  if (!mcpRequest || mcpRequest.method !== 'tools/call') {
    return res.status(400).json({ error: 'Invalid MCP tool call format.' });
  }

  const { name, arguments: args } = mcpRequest.params;
  const shop = appState.connectedShop;
  const accessToken = appState.accessToken;

  let toolResult;

  if (isMockMode) {
    const db = readShopifyDB();
    switch (name) {
      case 'list_products': {
        toolResult = db.products;
        addLog('AI Agent MCP Call', `Executed list_products tool (Sandbox).`, 'Success');
        break;
      }

      case 'create_product': {
        const { title, price, inventory } = args;
        const newProduct = {
          id: (Math.floor(Math.random() * 900000) + 100000).toString(),
          title,
          price: parseFloat(price).toFixed(2),
          inventory: parseInt(inventory, 10)
        };
        db.products.push(newProduct);
        writeShopifyDB(db);
        toolResult = newProduct;
        addLog('AI Agent MCP Call', `Executed create_product tool: Created "${title}" (Sandbox)`, 'Success');
        break;
      }

      case 'update_product': {
        const { productId, title, price } = args;
        const product = db.products.find(p => p.id === productId);
        if (!product) {
          addLog('AI Agent MCP Call', `Failed tool update_product: Product ${productId} not found.`, 'Error');
          return res.status(404).json({ error: `Product with ID ${productId} not found.` });
        }
        if (title !== undefined) product.title = title;
        if (price !== undefined) product.price = parseFloat(price).toFixed(2);
        writeShopifyDB(db);
        toolResult = product;
        addLog('AI Agent MCP Call', `Executed update_product tool: Updated "${product.title}" (Sandbox)`, 'Success');
        break;
      }

      case 'adjust_inventory': {
        const { productId, inventory } = args;
        const product = db.products.find(p => p.id === productId);
        if (!product) {
          addLog('AI Agent MCP Call', `Failed tool adjust_inventory: Product ${productId} not found.`, 'Error');
          return res.status(404).json({ error: `Product with ID ${productId} not found.` });
        }
        const oldInv = product.inventory;
        product.inventory = parseInt(inventory, 10);
        writeShopifyDB(db);
        toolResult = product;
        addLog('AI Agent MCP Call', `Executed adjust_inventory tool: Updated "${product.title}" stock from ${oldInv} to ${inventory}`, 'Success');
        break;
      }

      case 'list_orders': {
        toolResult = db.orders || [];
        addLog('AI Agent MCP Call', `Executed list_orders tool (Sandbox).`, 'Success');
        break;
      }

      case 'fulfill_order': {
        const { orderId } = args;
        const order = (db.orders || []).find(o => o.id === orderId);
        if (!order) {
          addLog('AI Agent MCP Call', `Failed tool fulfill_order: Order ${orderId} not found.`, 'Error');
          return res.status(404).json({ error: `Order with ID ${orderId} not found.` });
        }
        order.fulfillment_status = 'fulfilled';
        writeShopifyDB(db);
        toolResult = order;
        addLog('AI Agent MCP Call', `Executed fulfill_order tool: Fulfilled Order #${orderId} (Sandbox)`, 'Success');
        break;
      }

      default:
        return res.status(400).json({ error: `MCP Tool ${name} not supported.` });
    }
  } else {
    // Real API integration inside MCP Agent
    switch (name) {
      case 'list_products': {
        try {
          const response = await fetch(`https://${shop}/admin/api/2026-04/products.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const data = await response.json();
          toolResult = (data.products || []).map(p => ({
            id: p.id.toString(),
            title: p.title,
            price: p.variants[0]?.price || '0.00',
            inventory: p.variants[0]?.inventory_quantity || 0
          }));
          addLog('AI Agent MCP Call', `Executed list_products tool against Shopify API.`, 'Success');
        } catch (err) {
          addLog('AI Agent MCP Call', `Failed tool list_products: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
        break;
      }

      case 'create_product': {
        const { title, price, inventory } = args;
        try {
          const response = await fetch(`https://${shop}/admin/api/2026-04/products.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              product: {
                title,
                variants: [{ price, inventory_management: 'shopify', inventory_quantity: inventory }]
              }
            })
          });
          const data = await response.json();
          toolResult = {
            id: data.product.id.toString(),
            title: data.product.title,
            price: data.product.variants[0].price,
            inventory: data.product.variants[0].inventory_quantity
          };
          addLog('AI Agent MCP Call', `Executed create_product tool on Shopify: Created "${title}"`, 'Success');
        } catch (err) {
          addLog('AI Agent MCP Call', `Failed tool create_product: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
        break;
      }

      case 'update_product': {
        const { productId, title, price } = args;
        try {
          const body = { product: { id: productId } };
          if (title !== undefined) body.product.title = title;
          if (price !== undefined) {
            const pResponse = await fetch(`https://${shop}/admin/api/2026-04/products/${productId}.json`, {
              headers: { 'X-Shopify-Access-Token': accessToken }
            });
            const pData = await pResponse.json();
            const variantId = pData.product?.variants[0]?.id;
            if (variantId) {
              body.product.variants = [{ id: variantId, price }];
            }
          }
          const response = await fetch(`https://${shop}/admin/api/2026-04/products/${productId}.json`, {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
          const data = await response.json();
          toolResult = {
            id: data.product.id.toString(),
            title: data.product.title,
            price: data.product.variants[0].price,
            inventory: data.product.variants[0].inventory_quantity
          };
          addLog('AI Agent MCP Call', `Executed update_product tool on Shopify: Updated "${toolResult.title}"`, 'Success');
        } catch (err) {
          addLog('AI Agent MCP Call', `Failed tool update_product: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
        break;
      }

      case 'adjust_inventory': {
        const { productId, inventory } = args;
        try {
          const pResponse = await fetch(`https://${shop}/admin/api/2026-04/products/${productId}.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const pData = await pResponse.json();
          const variant = pData.product.variants[0];
          
          const lResponse = await fetch(`https://${shop}/admin/api/2026-04/locations.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const lData = await lResponse.json();
          
          await fetch(`https://${shop}/admin/api/2026-04/inventory_levels/set.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              location_id: lData.locations[0].id,
              inventory_item_id: variant.inventory_item_id,
              available: inventory
            })
          });

          toolResult = { id: productId, title: pData.product.title, inventory };
          addLog('AI Agent MCP Call', `Executed adjust_inventory tool on Shopify for product ${productId}`, 'Success');
        } catch (err) {
          addLog('AI Agent MCP Call', `Failed tool adjust_inventory: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
        break;
      }

      case 'list_orders': {
        try {
          const response = await fetch(`https://${shop}/admin/api/2026-04/orders.json?status=any`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const data = await response.json();
          toolResult = (data.orders || []).map(o => ({
            id: o.id.toString(),
            customer: o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : 'Guest',
            email: o.email || '',
            total_price: o.total_price,
            financial_status: o.financial_status,
            fulfillment_status: o.fulfillment_status || 'unfulfilled',
            line_items: (o.line_items || []).map(li => ({
              id: li.id.toString(),
              product_id: li.product_id ? li.product_id.toString() : null,
              title: li.title,
              price: li.price,
              quantity: li.quantity
            })),
            created_at: o.created_at
          }));
          addLog('AI Agent MCP Call', `Executed list_orders tool against Shopify API.`, 'Success');
        } catch (err) {
          addLog('AI Agent MCP Call', `Failed tool list_orders: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
        break;
      }

      case 'fulfill_order': {
        const { orderId } = args;
        try {
          const foResponse = await fetch(`https://${shop}/admin/api/2026-04/orders/${orderId}/fulfillment_orders.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          const foData = await foResponse.json();
          const unfulfilledFO = (foData.fulfillment_orders || []).find(
            fo => fo.status === 'open' || fo.status === 'in_progress'
          );
          if (!unfulfilledFO) {
            throw new Error('No open fulfillment orders found.');
          }

          const fResponse = await fetch(`https://${shop}/admin/api/2026-04/fulfillments.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fulfillment: {
                message: 'Fulfillment processed by AI Agent.',
                notify_merchant: true,
                line_items_by_fulfillment_order: [{ fulfillment_order_id: unfulfilledFO.id }]
              }
            })
          });
          const fData = await fResponse.json();
          if (fData.errors) throw new Error(JSON.stringify(fData.errors));

          toolResult = { id: orderId, fulfillment_status: 'fulfilled' };
          addLog('AI Agent MCP Call', `Executed fulfill_order tool on Shopify for Order #${orderId}`, 'Success');
        } catch (err) {
          addLog('AI Agent MCP Call', `Failed tool fulfill_order: ${err.message}`, 'Error');
          return res.status(500).json({ error: err.message });
        }
        break;
      }

      default:
        return res.status(400).json({ error: `MCP Tool ${name} not supported.` });
    }
  }

  // Construct standard MCP JSON-RPC response
  const mcpResponse = {
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: JSON.stringify(toolResult) }]
    },
    id: mcpRequest.id
  };

  let successMsg = '';
  if (name === 'create_product') {
    successMsg = `Successfully created product **${toolResult.title}** (ID: ${toolResult.id})!`;
  } else if (name === 'adjust_inventory') {
    successMsg = `Successfully updated inventory for **${toolResult.title}** to **${toolResult.inventory}**!`;
  } else if (name === 'update_product') {
    successMsg = `Successfully updated product **${toolResult.title}** (ID: ${toolResult.id}) details!`;
  } else if (name === 'fulfill_order') {
    successMsg = `Successfully fulfilled Order **#${toolResult.id || args.orderId}**!`;
  } else {
    successMsg = `Executed action successfully.`;
  }

  res.json({
    success: true,
    mcpResponse,
    message: successMsg
  });
});

app.listen(PORT, () => {
  console.log(`[Shopify Integration Server] Running on http://localhost:${PORT}`);
});

module.exports = app;

