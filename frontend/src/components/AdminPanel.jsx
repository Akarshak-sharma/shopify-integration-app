import React, { useState, useEffect } from 'react';

export default function AdminPanel({ 
  status, 
  logs, 
  refreshLogs, 
  onActionCompleted,
  activeTab,
  setActiveTab
}) {
  // Manual actions states
  const [searchQuery, setSearchQuery] = useState('');
  const [fetchedProducts, setFetchedProducts] = useState([]);
  
  const [createProductForm, setCreateProductForm] = useState({ title: '', price: '', inventory: '' });
  const [updateProductForm, setUpdateProductForm] = useState({ productId: '', title: '', price: '' });
  const [inventoryForm, setInventoryForm] = useState({ productId: '', inventory: '' });
  
  const [fetchedOrders, setFetchedOrders] = useState([]);
  
  // Confirmation states
  const [pendingAction, setPendingAction] = useState(null); // { type, label, data }

  // Load products and orders automatically once installed
  useEffect(() => {
    if (status.installed) {
      handleFetchProducts();
      handleFetchOrders();
    }
  }, [status.installed]);

  const handleFetchProducts = async (e) => {
    if (e) e.preventDefault();
    try {
      const response = await fetch('/api/app/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_products', params: { query: searchQuery } })
      });
      const data = await response.json();
      if (data.success) {
        setFetchedProducts(data.products || []);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    }
  };

  const handleFetchOrders = async () => {
    try {
      const response = await fetch('/api/app/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_orders', params: {} })
      });
      const data = await response.json();
      if (data.success) {
        setFetchedOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  };

  const handleManualActionExecute = async (actionType, params) => {
    try {
      const response = await fetch('/api/app/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionType, params })
      });
      const data = await response.json();
      if (data.success) {
        onActionCompleted();
        refreshLogs();
        setPendingAction(null);
        
        // Refresh local lists
        handleFetchProducts();
        handleFetchOrders();

        // Clear forms
        if (actionType === 'create_product') {
          setCreateProductForm({ title: '', price: '', inventory: '' });
        } else if (actionType === 'update_product') {
          setUpdateProductForm({ productId: '', title: '', price: '' });
        } else if (actionType === 'adjust_inventory') {
          setInventoryForm({ productId: '', inventory: '' });
        }
      } else {
        alert(data.error || 'Failed to execute action.');
      }
    } catch (err) {
      alert('Error communicating with app server');
      console.error(err);
    }
  };

  // Trigger confirmations
  const triggerCreateConfirmation = (e) => {
    e.preventDefault();
    const { title, price, inventory } = createProductForm;
    if (!title || !price || !inventory) {
      alert('Please fill out all fields.');
      return;
    }
    setPendingAction({
      type: 'create_product',
      label: `Create product "${title}" for $${parseFloat(price).toFixed(2)} with ${inventory} initial stock`,
      data: { title, price, inventory }
    });
  };

  const triggerUpdateConfirmation = (e) => {
    e.preventDefault();
    const { productId, title, price } = updateProductForm;
    if (!productId) {
      alert('Please enter a Product ID.');
      return;
    }
    let labelParts = [];
    if (title) labelParts.push(`change title to "${title}"`);
    if (price) labelParts.push(`change price to $${parseFloat(price).toFixed(2)}`);
    if (labelParts.length === 0) {
      alert('Please fill out at least one field to update (Title or Price).');
      return;
    }
    setPendingAction({
      type: 'update_product',
      label: `Update Product ID ${productId}: ${labelParts.join(' and ')}`,
      data: { productId, title: title || undefined, price: price ? parseFloat(price) : undefined }
    });
  };

  const triggerInventoryConfirmation = (e) => {
    e.preventDefault();
    const { productId, inventory } = inventoryForm;
    if (!productId || inventory === '') {
      alert('Please select a product and inventory amount.');
      return;
    }
    setPendingAction({
      type: 'adjust_inventory',
      label: `Adjust inventory of Product ID ${productId} to ${inventory} units`,
      data: { productId, inventory }
    });
  };

  const triggerFulfillConfirmation = (orderId) => {
    setPendingAction({
      type: 'fulfill_order',
      label: `Fulfill Order ID #${orderId}`,
      data: { orderId }
    });
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <h2>🔌 App Admin Panel</h2>
        <div className="status-indicator">
          <span className={`dot ${status.installed ? 'connected' : ''}`}></span>
          {status.installed ? 'Active' : 'Offline'}
        </div>
      </div>

      <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
        {/* Connection status card */}
        <div className="status-card">
          <div className="status-details">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Connection Status</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>
              {status.installed ? `Connected to ${status.shop}` : 'App Not Configured'}
            </span>
            {status.installed && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Access Token: {status.tokenRedacted}
              </span>
            )}
          </div>
          <span style={{
            background: status.installed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.05)',
            color: status.installed ? 'var(--success)' : 'var(--text-muted)',
            fontSize: '0.75rem',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            border: status.installed ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(255,255,255,0.05)'
          }}>
            {status.installed ? 'Verified (HMAC)' : 'Action Required'}
          </span>
        </div>

        {!status.installed ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔌</span>
            <h3 style={{ color: 'var(--text-main)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>App Not Installed</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: '320px' }}>
              Please enter your store address on the left and click **Install App** to authorize this integration.
            </p>
          </div>
        ) : (
          <>
            {/* View Selection Tabs */}
            <div className="app-tabs">
              <button 
                className={`tab-btn ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                Store Actions
              </button>
              <button 
                className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                AI Assistant (MCP)
              </button>
            </div>

            {activeTab === 'actions' ? (
              <div className="actions-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* 1. List Products Card with Search */}
                <div className="action-card">
                  <h3>List & Search Products (Read Action)</h3>
                  <form onSubmit={handleFetchProducts} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      style={{ margin: 0 }}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by title (e.g. Mug)..."
                    />
                    <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>
                      Search
                    </button>
                  </form>

                  {fetchedProducts.length > 0 && (
                    <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid var(--panel-border)' }}>
                      {fetchedProducts.map(p => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <span><strong>{p.title}</strong> (ID: {p.id})</span>
                          <span>${p.price} | {p.inventory} left</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Create Product Card (Write Action) */}
                <div className="action-card">
                  <h3>Create New Product (Write Action)</h3>
                  <form onSubmit={triggerCreateConfirmation} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Product Name</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={createProductForm.title} 
                        onChange={(e) => setCreateProductForm({ ...createProductForm, title: e.target.value })}
                        placeholder="e.g. Eco Friendly Mug"
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Price ($ USD)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          className="form-control" 
                          value={createProductForm.price} 
                          onChange={(e) => setCreateProductForm({ ...createProductForm, price: e.target.value })}
                          placeholder="29.99"
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Initial Stock</label>
                        <input 
                          type="number" 
                          className="form-control" 
                          value={createProductForm.inventory} 
                          onChange={(e) => setCreateProductForm({ ...createProductForm, inventory: e.target.value })}
                          placeholder="50"
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-shopify" style={{ width: '100%' }}>
                      Add Store Product
                    </button>
                  </form>
                </div>

                {/* 3. Update Product Card (Write Action) */}
                <div className="action-card">
                  <h3>Update Product Details (Write Action)</h3>
                  <form onSubmit={triggerUpdateConfirmation} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Product ID</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={updateProductForm.productId} 
                        onChange={(e) => setUpdateProductForm({ ...updateProductForm, productId: e.target.value })}
                        placeholder="e.g. 678901"
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>New Name (Optional)</label>
                        <input 
                          type="text" 
                          className="form-control" 
                          value={updateProductForm.title} 
                          onChange={(e) => setUpdateProductForm({ ...updateProductForm, title: e.target.value })}
                          placeholder="Updated Mug"
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>New Price (Optional)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          className="form-control" 
                          value={updateProductForm.price} 
                          onChange={(e) => setUpdateProductForm({ ...updateProductForm, price: e.target.value })}
                          placeholder="19.99"
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-shopify" style={{ width: '100%' }}>
                      Update Product Details
                    </button>
                  </form>
                </div>

                {/* 4. Adjust Inventory Card (Write Action) */}
                <div className="action-card">
                  <h3>Adjust Product Inventory (Write Action)</h3>
                  <form onSubmit={triggerInventoryConfirmation} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Product ID</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={inventoryForm.productId} 
                        onChange={(e) => setInventoryForm({ ...inventoryForm, productId: e.target.value })}
                        placeholder="e.g. 678901"
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>New Stock Level</label>
                      <input 
                        type="number" 
                        className="form-control" 
                        value={inventoryForm.inventory} 
                        onChange={(e) => setInventoryForm({ ...inventoryForm, inventory: e.target.value })}
                        placeholder="100"
                      />
                    </div>
                    <button type="submit" className="btn btn-shopify" style={{ width: '100%' }}>
                      Update Inventory
                    </button>
                  </form>
                </div>

                {/* 5. List Orders & Fulfill Card */}
                <div className="action-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h3>Manage Orders (Fulfillment Action)</h3>
                    <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} onClick={handleFetchOrders}>
                      Refresh Orders
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    {fetchedOrders.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
                        No orders retrieved.
                      </div>
                    ) : (
                      fetchedOrders.map(order => (
                        <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderRadius: '6px', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--panel-border)' }}>
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Order #{order.id}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Customer: {order.customer}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total: ${order.total_price} | Status: <strong style={{ color: order.fulfillment_status === 'fulfilled' ? 'var(--success)' : '#f59e0b' }}>{order.fulfillment_status}</strong></div>
                          </div>
                          {order.fulfillment_status !== 'fulfilled' && (
                            <button className="btn btn-shopify" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', background: '#f59e0b', color: 'black' }} onClick={() => triggerFulfillConfirmation(order.id)}>
                              Fulfill
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Confirmation Dialogue Modal-in-place */}
                {pendingAction && (
                  <div className="confirm-box">
                    <span className="confirm-text">⚠️ Explicit Human Confirmation Required</span>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                      Are you sure you want to execute: <strong style={{ color: 'white' }}>{pendingAction.label}</strong>?
                    </p>
                    <div className="confirm-actions">
                      <button className="btn btn-secondary" style={{ flex: 1, padding: '0.4rem' }} onClick={() => setPendingAction(null)}>
                        Cancel
                      </button>
                      <button 
                        className="btn btn-shopify" 
                        style={{ flex: 1, padding: '0.4rem', background: 'var(--warning)', color: 'var(--text-dark)' }} 
                        onClick={() => handleManualActionExecute(pendingAction.type, pendingAction.data)}
                      >
                        Confirm Write Action
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Always visible activity logs at bottom */}
            <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>App Activity Log</h3>
                <button className="btn btn-secondary" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={refreshLogs}>
                  Clear/Refresh
                </button>
              </div>

              <div className="logs-list">
                {logs.length === 0 ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    No app actions logged yet.
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className={`log-item ${log.status.toLowerCase()}`}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{ fontWeight: 600 }}>{log.action}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{log.details}</span>
                      </div>
                      <div className="log-meta">
                        <span style={{ 
                          color: log.status === 'Success' ? 'var(--success)' : 'var(--error)',
                          fontWeight: 600,
                          display: 'block'
                        }}>
                          {log.status}
                        </span>
                        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
