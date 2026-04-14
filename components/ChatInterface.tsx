import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatSession, Strategy } from '../types';
import { chatWithResearcher } from '../services/aiService';
import { Send, User, Bot, Plus, MessageSquare, Edit2, Trash2, Search, Zap, Heart } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ChatInterfaceProps {
    strategies: Strategy[];
    analystChatEnabled: boolean;
    demoMode: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ strategies, analystChatEnabled, demoMode }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load from local storage
  useEffect(() => {
    const savedSessions = localStorage.getItem('polybot_chat_sessions');
    if (savedSessions) {
      try {
        const parsed = JSON.parse(savedSessions);
        setSessions(parsed);
        if (parsed.length > 0) {
            setActiveSessionId(parsed[0].id);
        } else {
            createNewSession();
        }
      } catch (e) {
        createNewSession();
      }
    } else {
      createNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to local storage
  useEffect(() => {
    if (sessions.length > 0) {
        localStorage.setItem('polybot_chat_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  const createNewSession = () => {
      const newSession: ChatSession = {
          id: Date.now().toString(),
          title: 'New Discussion',
          messages: [{
            id: 'welcome',
            role: 'model',
            text: "I'm your Quantitative Research Assistant. Use '/' to reference a strategy context. What's on your mind?",
            timestamp: new Date()
          }],
          createdAt: Date.now()
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const newSessions = sessions.filter(s => s.id !== id);
      setSessions(newSessions);
      if (activeSessionId === id) {
          if (newSessions.length > 0) {
              setActiveSessionId(newSessions[0].id);
          } else {
              createNewSession();
          }
      }
      // Update storage immediately
      localStorage.setItem('polybot_chat_sessions', JSON.stringify(newSessions));
  };

  const startRenaming = (e: React.MouseEvent, session: ChatSession) => {
      e.stopPropagation();
      setEditingSessionId(session.id);
      setEditTitle(session.title);
  };

  const saveRename = () => {
      if (editingSessionId) {
          setSessions(prev => prev.map(s => s.id === editingSessionId ? { ...s, title: editTitle } : s));
          setEditingSessionId(null);
      }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [activeSession?.messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInput(val);
      if (val.endsWith('/')) {
          setShowSlashMenu(true);
      } else if (val === '' || val.indexOf('/') === -1) {
          setShowSlashMenu(false);
      }
  };

  const handleSlashSelect = (strategy: Strategy) => {
      const lastSlashIndex = input.lastIndexOf('/');
      const prefix = input.substring(0, lastSlashIndex);
      // We append a hidden marker or just readable text. 
      // Readable text is better for user experience.
      setInput(`${prefix}[Ref: ${strategy.title}] `);
      setShowSlashMenu(false);
      inputRef.current?.focus();
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !activeSessionId) return;

    if (!analystChatEnabled) {
      return;
    }

    const currentInput = input;
    
    // Check for references to inject context
    let contextInjection = "";
    const refMatch = currentInput.match(/\[Ref: (.*?)\]/);
    if (refMatch) {
        const strategyTitle = refMatch[1];
        const strategy = strategies.find(s => s.title === strategyTitle);
        if (strategy) {
            contextInjection = `\n\n[SYSTEM CONTEXT: User is referencing strategy "${strategy.title}". Description: ${strategy.description}. Deep Dive Analysis: ${strategy.deepDiveAnalysis || "Not available yet"}]`;
        }
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: currentInput,
      timestamp: new Date()
    };

    // Update local state immediately
    setSessions(prev => prev.map(s => 
        s.id === activeSessionId 
        ? { ...s, messages: [...s.messages, userMsg], updatedAt: Date.now() } 
        : s
    ));
    
    setInput('');
    setIsLoading(true);

    // Prepare history
    // We filter out system context messages from previous history to avoid token bloat, or keep them if relevant.
    // For simplicity, we send text as is.
    const history = activeSession?.messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
    })) || [];

    const fullPrompt = currentInput + contextInjection;

    if (demoMode) {
        const botMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: "I'm sorry, but the Analyst Chat is disabled in Demo Mode. To unlock full research capabilities and chat with the AI, deploy the app with your own OpenAI API key.",
            timestamp: new Date()
        };
        setSessions(prev => prev.map(s => 
            s.id === activeSessionId 
            ? { ...s, messages: [...s.messages, botMsg], updatedAt: Date.now() } 
            : s
        ));
        setIsLoading(false);
        return;
    }

    const responseText = await chatWithResearcher(history, fullPrompt);

    const botMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'model',
      text: responseText || "Sorry, I couldn't process that.",
      timestamp: new Date()
    };

    setSessions(prev => prev.map(s => 
        s.id === activeSessionId 
        ? { ...s, messages: [...s.messages, botMsg], updatedAt: Date.now() } 
        : s
    ));
    setIsLoading(false);
  };

  // Sort strategies for the menu: Favorites first
  const sortedSlashStrategies = [...strategies].sort((a, b) => {
      if (a.isFavorite === b.isFavorite) return 0;
      return a.isFavorite ? -1 : 1;
  });

  return (
    <div className="flex h-full gap-4 overflow-hidden">
        {/* Sessions Sidebar */}
        <div className="w-64 bg-slate-900 rounded-xl border border-slate-700 flex flex-col overflow-hidden shrink-0">
            <div className="p-4 border-b border-slate-700">
                <button 
                    onClick={createNewSession}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus size={16} /> New Chat
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sessions.map(session => (
                    <div 
                        key={session.id}
                        onClick={() => setActiveSessionId(session.id)}
                        className={`group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${activeSessionId === session.id ? 'bg-slate-800 text-blue-400 border border-slate-700' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'}`}
                    >
                        <MessageSquare size={16} className="shrink-0" />
                        <div className="flex-1 min-w-0">
                            {editingSessionId === session.id ? (
                                <input 
                                    autoFocus
                                    className="w-full bg-slate-950 text-white px-1 py-0.5 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    onBlur={saveRename}
                                    onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <p className="text-sm font-medium truncate">{session.title}</p>
                            )}
                        </div>
                        {activeSessionId === session.id && !editingSessionId && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => startRenaming(e, session)} className="p-1 hover:text-white"><Edit2 size={12} /></button>
                                <button onClick={(e) => deleteSession(e, session.id)} className="p-1 hover:text-red-400"><Trash2 size={12} /></button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-slate-900 rounded-xl border border-slate-700 overflow-hidden relative">
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {activeSession?.messages.map((msg) => (
                <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                    <div
                    className={`max-w-[85%] rounded-2xl p-4 ${
                        msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm'
                    }`}
                    >
                    <div className="flex items-center gap-2 mb-2 opacity-75">
                        {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                        <span className="text-xs font-medium uppercase">{msg.role === 'user' ? 'You' : 'Analyst'}</span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                    </div>
                </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-slate-800 p-4 rounded-2xl rounded-bl-sm border border-slate-700 flex items-center space-x-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            
            {/* Slash Menu */}
            {showSlashMenu && (
                <div className="absolute bottom-20 left-4 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl max-h-60 overflow-y-auto z-20">
                    <div className="p-2 text-xs text-slate-500 font-medium uppercase border-b border-slate-700 mb-1">Select Strategy</div>
                    {sortedSlashStrategies.map(s => (
                        <button
                            key={s.id}
                            onClick={() => handleSlashSelect(s)}
                            className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2 group"
                        >
                            <Zap size={14} className={s.isFavorite ? "text-pink-400 fill-pink-400" : "text-slate-400"} />
                            <span className="truncate">{s.title}</span>
                            {s.isFavorite && <Heart size={10} className="ml-auto text-pink-500 fill-pink-500" />}
                        </button>
                    ))}
                    {sortedSlashStrategies.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-500 italic">No strategies found</div>
                    )}
                </div>
            )}

            <div className="p-4 bg-slate-800 border-t border-slate-700">
                {demoMode && (
                    <div className="mb-3 p-3 bg-blue-600/10 border border-blue-600/20 rounded-lg flex items-center justify-between gap-4">
                        <p className="text-xs text-blue-200">
                            <span className="font-bold">Demo Mode:</span> Chat is restricted. Download the repo to enable.
                        </p>
                        <a href="https://github.com" target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-400 hover:text-blue-300 underline">Get Repo</a>
                    </div>
                )}
                {!demoMode && !analystChatEnabled && (
                    <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                        This feature is currently disabled. You will need to enable <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-amber-200">ENABLE_ANALYST_CHAT=true</code> on the server to send messages.
                    </div>
                )}
                <div className="flex items-center gap-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={
                        demoMode
                            ? "Chat disabled in Demo Mode..."
                            : !analystChatEnabled
                                ? "Type your message here, then enable Analyst Chat in env vars to send..."
                                : "Type '/' to reference a strategy, or ask a question..."
                    }
                    className="flex-1 bg-slate-900 border border-slate-700 text-white placeholder-slate-500 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                />
                <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim() || demoMode || !analystChatEnabled}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white p-3 rounded-lg transition-colors"
                >
                    <Send size={20} />
                </button>
                </div>
            </div>
        </div>
    </div>
  );
};

export default ChatInterface;
