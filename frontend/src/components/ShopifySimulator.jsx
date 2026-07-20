import React, { useState, useEffect } from 'react';

export default function ShopifySimulator({ 
  status, 
  onInstallSuccess, 
  onUninstallSuccess, 
  refreshLogs,
  shopifyDb,
  shopifyOrders = [],
  refreshShopifyDb
}) {
  const [shopName, setShopName] = useState('my-dev-store.myshopify.com');
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize or fetch Shopify Database
  useEffect(() => {
    refreshShopifyDb();
  }, []);

  const handleInstallClick = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/shopify/install?shop=${encodeURIComponent(shopName)}`);
      const data = await response.json();
      if (data.redirectUri) {
        // Show simulated consent modal instead of a real redirect
        setShowConsentModal(true);
      }
    } catch (err) {
      alert('Error connecting to simulated Shopify core server');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveConsent = async () => {
    setShowConsentModal(false);
    setIsLoading(true);
    try {
      // 1. Get signed auth code and hmac from Shopify
      const approveRes = await fetch('/api/shopify/oauth/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: shopName })
      });
      const authParams = await approveRes.json();

      // 2. Send code and hmac to app callback URL
      const callbackRes = await fetch('/api/shopify/oauth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop: authParams.shop,
          code: authParams.code,
          hmac: authParams.hmac
        })
      });
      const callbackData = await callbackRes.json();

      if (callbackData.success) {
        onInstallSuccess(callbackData.shop);
        refreshLogs();
      } else {
        alert(callbackData.error || 'OAuth verification failed.');
      }
    } catch (err) {
      alert('Error completing OAuth callback');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUninstallClick = async () => {
    setIsLoading(true);
    try {
      // Trigger the mock uninstalled webhook (signed with simulated HMAC)
      const response = await fetch('/api/shopify/webhooks/uninstalled/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: status.shop || shopName })
      });
      const data = await response.json();
      if (data.success) {
        onUninstallSuccess();
        refreshLogs();
      }
    } catch (err) {
      alert('Error triggering uninstall webhook');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <h2>
          <span className="logo-icon">S</span> Shopify Platform (Simulated Core)
        </h2>
        <span className="shopify-icon-badge">API Version: 2026-04</span>
      </div>

      <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
        {/* Connection Control Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--panel-border)' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Shopify Store Address</label>
            <input 
              type="text" 
              className="form-control" 
              value={shopName} 
              onChange={(e) => setShopName(e.target.value)}
              disabled={status.installed}
              placeholder="store-name.myshopify.com"
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            {!status.installed ? (
              <button 
                className="btn btn-shopify" 
                style={{ flex: 1 }}
                onClick={handleInstallClick}
                disabled={isLoading || !shopName}
              >
                {isLoading ? 'Connecting...' : 'Install App'}
              </button>
            ) : (
              <button 
                className="btn btn-danger" 
                style={{ flex: 1 }}
                onClick={handleUninstallClick}
                disabled={isLoading}
              >
                {isLoading ? 'Uninstalling...' : 'Uninstall App (Webhook)'}
              </button>
            )}
          </div>
        </div>

        {/* Shopify Database Viewer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Shopify Products Database</h3>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={refreshShopifyDb}>
              Refresh DB
            </button>
          </div>

          <div className="db-table-container" style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {shopifyDb.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No products found in the Shopify database.
              </div>
            ) : (
              <table className="db-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Product Title</th>
                    <th>Price</th>
                    <th style={{ textAlign: 'right' }}>Stock Level</th>
                  </tr>
                </thead>
                <tbody>
                  {shopifyDb.map((p) => (
                    <tr key={p.id}>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.id}</td>
                      <td style={{ fontWeight: 500 }}>{p.title}</td>
                      <td style={{ color: 'var(--shopify-green-light)', fontWeight: 500 }}>${p.price}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`badge-stock ${p.inventory < 15 ? 'low' : 'normal'}`}>
                          {p.inventory} units
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Shopify Orders Viewer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--panel-border)', paddingTop: '1.25rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Shopify Orders Database</h3>
          <div className="db-table-container" style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {shopifyOrders.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No orders found in the Shopify database.
              </div>
            ) : (
              <table className="db-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th style={{ textAlign: 'right' }}>Fulfillment Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shopifyOrders.map((o) => (
                    <tr key={o.id}>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>#{o.id}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{o.customer}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.email}</div>
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {o.line_items.map(item => `${item.title} (x${item.quantity})`).join(', ')}
                      </td>
                      <td style={{ fontWeight: 500, color: 'var(--shopify-green-light)' }}>${o.total_price}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`badge-stock ${o.fulfillment_status === 'fulfilled' ? 'normal' : 'low'}`} style={{
                          background: o.fulfillment_status === 'fulfilled' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: o.fulfillment_status === 'fulfilled' ? 'var(--success)' : '#f59e0b',
                          border: o.fulfillment_status === 'fulfilled' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)'
                        }}>
                          {o.fulfillment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Simulated OAuth Consent Modal */}
      {showConsentModal && (
        <div className="oauth-overlay">
          <div className="oauth-modal">
            <div className="oauth-header">
              <div className="oauth-title">App Authorization Request</div>
              <div className="oauth-subtitle">{shopName}</div>
            </div>
            <div className="oauth-body">
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                The merchant app is requesting permission to access your Shopify store. It requires the following API scopes:
              </p>
              
              <div className="oauth-scopes" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                <div className="scope-item">
                  <span className="scope-bullet">✓</span>
                  <div>
                    <strong style={{ fontSize: '0.85rem' }}>read_products, write_products</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Allows the app to read/create products and update inventory stock levels.</div>
                  </div>
                </div>
                <div style={{ height: '1px', background: 'var(--panel-border)' }}></div>
                <div className="scope-item">
                  <span className="scope-bullet">✓</span>
                  <div>
                    <strong style={{ fontSize: '0.85rem' }}>read_orders, write_orders</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Allows the app to view customer orders and process fulfillments.</div>
                  </div>
                </div>
              </div>

              <div style={{ background: 'rgba(109,40,217,0.1)', border: '1px solid rgba(109,40,217,0.2)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--primary-accent-light)' }}>
                <strong>Technical Details:</strong> This simulates a standard Shopify OAuth Handshake. Approving will generate a signed authorization code using HMAC SHA-256 for secure app configuration.
              </div>

              <div className="oauth-actions">
                <button className="btn btn-secondary" onClick={() => setShowConsentModal(false)}>Cancel</button>
                <button className="btn btn-shopify" onClick={handleApproveConsent}>Approve & Install</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
