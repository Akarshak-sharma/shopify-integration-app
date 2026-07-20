import React, { useState, useRef, useEffect } from 'react';

export default function AgentChat({ 
  refreshLogs, 
  refreshShopifyDb 
}) {
  const [messages, setMessages] = useState([
    { 
      id: 'welcome', 
      sender: 'agent', 
      text: "Hello! I am your AI Assistant integrated via Model Context Protocol (MCP). How can I help you manage your store today?\n\nYou can ask me to:\n• *\"List products\"*\n• *\"Create a product named Eco Mug with price 12.00 and stock 50\"*\n• *\"Set inventory of product 678901 to 10\"*" 
    }
  ]);
  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState(null); // { id, mcpRequest, message }

  const messagesEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingToolCall]);

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!inputVal.trim() || isLoading) return;

    const userText = inputVal;
    setInputVal('');
    
    // Add user message
    const userMsgId = `user_${Date.now()}`;
    setMessages(prev => [...prev, { id: userMsgId, sender: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText })
      });
      const data = await response.json();

      if (response.status === 401) {
        setMessages(prev => [...prev, { 
          id: `agent_${Date.now()}`, 
          sender: 'agent', 
          text: data.error 
        }]);
        setIsLoading(false);
        return;
      }

      const agentMsgId = `agent_${Date.now()}`;

      // If the action requires human confirmation (Write action)
      if (data.requiresConfirmation) {
        setPendingToolCall({
          id: agentMsgId,
          mcpRequest: data.mcpRequest,
          message: data.message,
          thought: data.thought
        });
      } else {
        // Read action or fallback: executed automatically
        setMessages(prev => [...prev, {
          id: agentMsgId,
          sender: 'agent',
          thought: data.thought,
          text: data.response,
          mcpRequest: data.mcpRequest,
          mcpResponse: data.mcpResponse
        }]);
        
        // Refresh Shopify DB & logs in case anything read/logged
        refreshShopifyDb();
        refreshLogs();
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        id: `agent_${Date.now()}`, 
        sender: 'agent', 
        text: "Error communicating with AI Agent backend." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Human confirms the tool call execution
  const handleConfirmTool = async () => {
    if (!pendingToolCall) return;
    const currentToolCall = pendingToolCall;
    setPendingToolCall(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/agent/execute-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpRequest: currentToolCall.mcpRequest })
      });
      const data = await response.json();

      if (data.success) {
        // Add confirmed action details and response to chat
        setMessages(prev => [...prev, {
          id: `agent_${Date.now()}`,
          sender: 'agent',
          thought: currentToolCall.thought,
          text: data.message,
          mcpRequest: currentToolCall.mcpRequest,
          mcpResponse: data.mcpResponse
        }]);

        // Sync store views and logs
        refreshShopifyDb();
        refreshLogs();
      } else {
        alert(data.error || 'Failed to execute tool.');
      }
    } catch (err) {
      console.error(err);
      alert('Error executing confirmed tool');
    } finally {
      setIsLoading(false);
    }
  };

  // Human denies the tool call execution
  const handleDenyTool = () => {
    if (!pendingToolCall) return;
    const currentToolCall = pendingToolCall;
    setPendingToolCall(null);

    setMessages(prev => [...prev, {
      id: `agent_${Date.now()}`,
      sender: 'agent',
      thought: currentToolCall.thought,
      text: "❌ Write action rejected by merchant. The tool call was cancelled.",
      mcpRequest: currentToolCall.mcpRequest,
      mcpResponse: {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Execution cancelled by user confirmation gate' },
        id: currentToolCall.mcpRequest.id
      }
    }]);
    
    // Log the rejection on the app panel
    refreshLogs();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
      <div>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>AI Agent Chat Panel (MCP Server Client)</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          This agent calls store functions via standardized Model Context Protocol JSON-RPC tools.
        </p>
      </div>

      <div className="chat-container">
        {/* Messages feed */}
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg ${msg.sender}`}>
              {/* Show Agent's internal thought process */}
              {msg.thought && (
                <div className="thought-bubble">
                  🧠 <strong>Agent Thought:</strong> {msg.thought}
                </div>
              )}

              {/* Message text */}
              <div style={{ whiteSpace: 'pre-line' }}>{msg.text}</div>

              {/* Visual MCP JSON-RPC protocol logger */}
              {msg.mcpRequest && (
                <div className="mcp-log-block">
                  <div className="mcp-log-header">
                    <span>📡 MCP Tool Call (JSON-RPC)</span>
                    <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>
                      {msg.mcpRequest.params.name}
                    </span>
                  </div>
                  
                  {/* Request */}
                  <div className="mcp-log-content request">
                    👉 REQUEST:<br/>
                    {JSON.stringify(msg.mcpRequest, null, 2)}
                  </div>
                  
                  {/* Response */}
                  {msg.mcpResponse && (
                    <div className="mcp-log-content" style={{ borderTop: '1px dashed rgba(255,255,255,0.05)' }}>
                      👈 RESPONSE:<br/>
                      {JSON.stringify(msg.mcpResponse, null, 2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Pending write action confirmation box inside chat */}
          {pendingToolCall && (
            <div className="chat-msg agent" style={{ borderLeft: '3px solid var(--warning)' }}>
              {pendingToolCall.thought && (
                <div className="thought-bubble">
                  🧠 <strong>Agent Thought:</strong> {pendingToolCall.thought}
                </div>
              )}
              <div style={{ fontWeight: 500, color: '#fde047', marginBottom: '0.5rem' }}>
                ⚠️ Tool Call Confirmation Required
              </div>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{pendingToolCall.message}</p>

              {/* Show raw MCP Tool Call request being blocked */}
              <div className="mcp-log-block" style={{ marginBottom: '0.75rem' }}>
                <div className="mcp-log-header" style={{ color: '#fbbf24' }}>
                  <span>⏳ BLOCKED: MCP Tool Call</span>
                  <span>{pendingToolCall.mcpRequest.params.name}</span>
                </div>
                <div className="mcp-log-content request" style={{ color: '#fbbf24' }}>
                  {JSON.stringify(pendingToolCall.mcpRequest, null, 2)}
                </div>
              </div>

              <div className="confirm-actions">
                <button className="btn btn-secondary" style={{ flex: 1, padding: '0.3rem' }} onClick={handleDenyTool}>
                  Reject
                </button>
                <button 
                  className="btn btn-shopify" 
                  style={{ flex: 1, padding: '0.3rem', background: 'var(--warning)', color: 'var(--text-dark)' }} 
                  onClick={handleConfirmTool}
                >
                  Approve Execution
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="chat-msg agent" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
              Agent is thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <form className="chat-input-form" onSubmit={handleSendChat}>
          <input 
            type="text" 
            className="chat-input" 
            placeholder={pendingToolCall ? "Awaiting write approval..." : "Type e.g., 'list products' or 'add eco mug'..."}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            disabled={isLoading || !!pendingToolCall}
          />
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={isLoading || !inputVal.trim() || !!pendingToolCall}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
