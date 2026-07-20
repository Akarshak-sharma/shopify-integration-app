import React, { useState, useEffect } from 'react';
import ShopifySimulator from './components/ShopifySimulator';
import AdminPanel from './components/AdminPanel';
import AgentChat from './components/AgentChat';

function App() {
  const [status, setStatus] = useState({ installed: false, shop: null, tokenRedacted: null });
  const [logs, setLogs] = useState([]);
  const [shopifyDb, setShopifyDb] = useState([]);
  const [shopifyOrders, setShopifyOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('actions');

  // Sync App Status
  const refreshStatus = async () => {
    try {
      const response = await fetch('/api/app/status');
      const data = await response.json();
      setStatus(data);
      if (!data.installed) {
        setActiveTab('actions'); // reset tab on uninstall
      }
    } catch (err) {
      console.error('Error fetching connection status:', err);
    }
  };

  // Sync Logs
  const refreshLogs = async () => {
    try {
      const response = await fetch('/api/app/logs');
      const data = await response.json();
      setLogs(data);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  // Sync Shopify Store database
  const refreshShopifyDb = async () => {
    try {
      const response = await fetch('/api/shopify/store-db');
      const data = await response.json();
      setShopifyDb(data.products || []);
      setShopifyOrders(data.orders || []);
    } catch (err) {
      console.error('Error fetching Shopify database:', err);
    }
  };

  useEffect(() => {
    refreshStatus();
    refreshLogs();
    refreshShopifyDb();
  }, []);

  const handleInstallSuccess = (shop) => {
    refreshStatus();
    refreshShopifyDb();
  };

  const handleUninstallSuccess = () => {
    refreshStatus();
    refreshShopifyDb();
  };

  const handleActionCompleted = () => {
    refreshShopifyDb();
    refreshLogs();
  };

  return (
    <>
      <header className="app-header">
        <div className="header-logo">
          <div className="logo-icon">S</div>
          <div className="logo-text">Shopify Integration Engine</div>
          <span className="logo-badge">Prototype</span>
        </div>
        <div className="tech-info">
          <span className="tech-tag">React 18</span>
          <span className="tech-tag">Node.js + Express</span>
          <span className="tech-tag">MCP JSON-RPC Server</span>
        </div>
      </header>

      <main className="main-layout">
        {/* Left Panel: Simulated Shopify Core (consent, db viewer, webhook triggers) */}
        <ShopifySimulator 
          status={status} 
          onInstallSuccess={handleInstallSuccess} 
          onUninstallSuccess={handleUninstallSuccess}
          refreshLogs={refreshLogs}
          shopifyDb={shopifyDb}
          shopifyOrders={shopifyOrders}
          refreshShopifyDb={refreshShopifyDb}
        />

        {/* Right Panel: Our App Admin Panel dashboard & AI agent client */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%', overflow: 'hidden' }}>
          {activeTab === 'chat' ? (
            <div className="glass-panel" style={{ flex: 1 }}>
              <div className="panel-header">
                <h2>🤖 Secondary AI Agent</h2>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setActiveTab('actions')}>
                  Back to Dashboard
                </button>
              </div>
              <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 60px)', overflow: 'hidden' }}>
                <AgentChat 
                  refreshLogs={refreshLogs} 
                  refreshShopifyDb={refreshShopifyDb} 
                />
              </div>
            </div>
          ) : (
            <AdminPanel 
              status={status} 
              logs={logs} 
              refreshLogs={refreshLogs} 
              onActionCompleted={handleActionCompleted}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          )}
        </div>
      </main>
    </>
  );
}

export default App;
