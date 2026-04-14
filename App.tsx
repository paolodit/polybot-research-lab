import React, { useState, useEffect, useRef } from 'react';
import { generateStrategies, analyzeStrategyDeepDive } from './services/aiService';
import StrategyCard from './components/StrategyCard';
import ChatInterface from './components/ChatInterface';
import { Strategy, View } from './types';
import { LayoutDashboard, MessageSquareText, Zap, ChevronLeft, RefreshCw, BookOpen, Loader2, Heart, X, Sparkles, Download, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type SortOption = 'newest' | 'difficulty' | 'category' | 'potential';
type GenerateCountOption = 1 | 3 | 5 | 10 | 20 | 50;
type RuntimeConfig = {
  demoMode: boolean;
  features: {
    strategyImport: boolean;
    strategyGeneration: boolean;
    analystChat: boolean;
  };
};

const GENERATE_COUNT_OPTIONS: GenerateCountOption[] = [1, 3, 5, 10, 20, 50];

const normalizeDeepDiveMarkdown = (content: string) =>
  content
    .replace(/\r\n/g, '\n')
    .replace(/\n(---+)\n?/g, '\n\n$1\n\n')
    .replace(/\n([#]{1,3}\s)/g, '\n\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const App: React.FC = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  
  // Modal State
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateCount, setGenerateCount] = useState<GenerateCountOption>(5);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
    features: {
      strategyImport: false,
      strategyGeneration: true,
      analystChat: false
    }
  });
  
  // Ref to track processing to prevent duplicate loops
  const processingRef = useRef<Set<string>>(new Set());
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // Load from API on mount
  useEffect(() => {
    const fetchRuntimeConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) {
          throw new Error('Failed to load runtime config.');
        }

        const config = await response.json();
        setRuntimeConfig(config);
      } catch (e) {
        console.error("Failed to load runtime config", e);
      }
    };

    fetchRuntimeConfig();
  }, []);

  useEffect(() => {
    const fetchFromDb = async () => {
      try {
        const response = await fetch('/api/strategies');
        const data = await response.json();
        setStrategies(data);
        
        // If empty, fetch initial batch
        if (data.length === 0 && !runtimeConfig.demoMode) {
          fetchStrategies();
        }
      } catch (e) {
        console.error("Failed to load strategies from DB", e);
      }
    };
    fetchFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeConfig.demoMode]);

  useEffect(() => {
    if (runtimeConfig.demoMode) return;
    if (loading) return;
    if (processingRef.current.size > 0) return;

    const nextPending = strategies.find((strategy) => strategy.analysisStatus === 'pending');
    if (nextPending) {
      void processStrategyAnalysis(nextPending);
    }
  }, [strategies, loading]);

  const processStrategyAnalysis = async (item: Strategy) => {
    if (processingRef.current.has(item.id)) return;

    processingRef.current.add(item.id);

    setStrategies(prev => prev.map(s => s.id === item.id ? { ...s, analysisStatus: 'analyzing', deepDiveAnalysis: s.analysisStatus === 'failed' ? '' : s.deepDiveAnalysis } : s));

    try {
      const rawAnalysis = await analyzeStrategyDeepDive(item);
      if (!rawAnalysis || rawAnalysis.trim() === '' || rawAnalysis.trim() === 'Analysis generated an empty response.') {
        throw new Error('OpenAI returned an empty deep-dive response.');
      }

      const analysis = normalizeDeepDiveMarkdown(rawAnalysis);

      setStrategies(prev => prev.map(s =>
        s.id === item.id ? { ...s, deepDiveAnalysis: analysis, analysisStatus: 'completed' } : s
      ));

      await fetch(`/api/strategies/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deepDiveAnalysis: analysis, analysisStatus: 'completed' })
      });
    } catch (error) {
      console.error(`Analysis failed for ${item.title}:`, error);
      const failedAnalysis = `**Analysis Failed**\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}.`;

      setStrategies(prev => prev.map(s =>
        s.id === item.id ? {
            ...s,
            analysisStatus: 'failed',
            deepDiveAnalysis: failedAnalysis
        } : s
      ));

      await fetch(`/api/strategies/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deepDiveAnalysis: failedAnalysis, analysisStatus: 'failed' })
      });
    } finally {
      processingRef.current.delete(item.id);
    }
  };

  const fetchStrategies = async (customInstruction: string = "", count: GenerateCountOption = generateCount) => {
    if (runtimeConfig.demoMode || !runtimeConfig.features.strategyGeneration) return;
    
    setLoading(true);
    const newRawStrategies = await generateStrategies(customInstruction, count);
    setLoading(false);

    const candidates = newRawStrategies.map(s => ({
        ...s,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        analysisStatus: 'pending' as const,
        deepDiveAnalysis: '',
        isFavorite: false
    }));

    const existingTitles = new Set(strategies.map(s => s.title.toLowerCase()));
    const strategiesToAdd = candidates.filter(s => !existingTitles.has(s.title.toLowerCase()));

    if (strategiesToAdd.length === 0) return;

    // Save to DB
    for (const strategy of strategiesToAdd) {
      await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategy)
      });
    }

    setStrategies(prev => [...strategiesToAdd, ...prev]);
  };

  const handleGenerateClick = () => {
      setIsGenerateModalOpen(true);
  };

  const handleGenerateConfirm = () => {
      setIsGenerateModalOpen(false);
      fetchStrategies(generatePrompt, generateCount);
      setGeneratePrompt(""); // Reset after use
  };

  const handleGenerateSurprise = () => {
      setIsGenerateModalOpen(false);
      fetchStrategies("", generateCount);
      setGeneratePrompt("");
  };

  const handleExportStrategies = async () => {
    try {
      const response = await fetch('/api/strategies/export', {
        headers: {
          Accept: 'application/json'
        }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Export failed.');
      }

      const text = await response.text();
      let parsed: { strategies?: unknown[]; exportedAt?: string } | null = null;

      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!parsed || !Array.isArray(parsed.strategies)) {
        throw new Error('Export endpoint did not return a strategy backup JSON file. This usually means the server has not been restarted with the latest code yet.');
      }

      const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `polybot-strategies-${(parsed.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setTransferMessage('Strategy library exported successfully.');
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const handleImportClick = () => {
    if (!runtimeConfig.features.strategyImport) {
      setTransferMessage('Import Library is currently disabled on this deployment. Enable ENABLE_STRATEGY_IMPORT=true on the server to allow restores.');
      return;
    }

    importFileRef.current?.click();
  };

  const handleImportStrategies = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const replaceExisting = window.confirm('Replace the current strategy library with this backup?\n\nPress OK to replace everything, or Cancel to merge the imported strategies into the current library.');

      const response = await fetch('/api/strategies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategies: Array.isArray(parsed) ? parsed : parsed.strategies,
          replaceExisting
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Import failed.');
      }

      const refreshed = await fetch('/api/strategies');
      const refreshedData = await refreshed.json();
      setStrategies(refreshedData);
      setTransferMessage(`Imported ${payload.imported} strategies${replaceExisting ? ' and replaced the existing library' : ' into the current library'}.`);
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      event.target.value = '';
    }
  };

  const handleStrategyClick = (strategy: Strategy) => {
    setSelectedStrategyId(strategy.id);
    setCurrentView(View.STRATEGY_DETAIL);

    if (strategy.analysisStatus === 'failed') {
      void processStrategyAnalysis(strategy);
      return;
    }

    if (strategy.analysisStatus === 'pending' && !strategy.deepDiveAnalysis) {
      processStrategyAnalysis(strategy);
    }
  };

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const strategy = strategies.find(s => s.id === id);
      if (!strategy) return;

      const newFavoriteStatus = !strategy.isFavorite;
      
      // Update local state
      setStrategies(prev => prev.map(s => s.id === id ? { ...s, isFavorite: newFavoriteStatus } : s));

      // Update DB
      try {
        await fetch(`/api/strategies/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isFavorite: newFavoriteStatus })
        });
      } catch (e) {
        console.error("Failed to update favorite status in DB", e);
      }
  };

  const sortedStrategies = [...strategies].sort((a, b) => {
      // 1. Favorites always on top
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;

      // 2. Selected sort option
      switch (sortOption) {
          case 'difficulty':
             const diffMap = { 'Low': 1, 'Medium': 2, 'High': 3 };
             return (diffMap[a.difficulty] || 0) - (diffMap[b.difficulty] || 0);
          case 'category':
              return a.category.localeCompare(b.category);
          case 'potential':
              const potMap = { 'Steady': 1, 'Volatile': 2, 'High': 3 };
               return (potMap[b.profitPotential] || 0) - (potMap[a.profitPotential] || 0);
          case 'newest':
          default:
              // Assuming ID has timestamp or just array order. 
              // Since we append new ones, index is proxy for age.
              // Actually, we prepend new ones in fetchStrategies, so default index order is Newest -> Oldest
              return 0; 
      }
  });

  const selectedStrategy = strategies.find(s => s.id === selectedStrategyId);

  const renderGenerateModal = () => (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative">
              <button 
                onClick={() => setIsGenerateModalOpen(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white"
              >
                  <X size={20} />
              </button>
              
              <div className="p-8">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="bg-blue-600/20 p-3 rounded-xl border border-blue-600/30">
                          <Sparkles className="text-blue-400" size={24} />
                      </div>
                      <h2 className="text-2xl font-bold text-white">Generate Ideas</h2>
                  </div>
                  
                  <p className="text-slate-400 mb-6 leading-relaxed">
                      Direct the AI research lab. You can request specific markets (e.g., "Crypto", "Politics"), trading styles ("High Frequency"), or just let the model brainstorm freely.
                  </p>

                  {!runtimeConfig.features.strategyGeneration && (
                      <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                          <p className="text-sm font-medium text-amber-100">
                              Strategy generation is currently disabled in this demo.
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-amber-50/80">
                              To enable it, set <code className="rounded bg-slate-950 px-1.5 py-0.5 text-xs text-amber-200">ENABLE_STRATEGY_GENERATION=true</code> on the server and restart the app.
                          </p>
                      </div>
                  )}

                  <div className="mb-6">
                      <label className="block text-sm font-medium text-slate-300 mb-2">Focus Area (Optional)</label>
                      <input 
                        type="text" 
                        value={generatePrompt}
                        onChange={(e) => setGeneratePrompt(e.target.value)}
                        placeholder="E.g. Focus on US Elections, NBA Props, or finding Arbitrage..."
                        className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-600 transition-all disabled:opacity-60"
                        onKeyDown={(e) => e.key === 'Enter' && runtimeConfig.features.strategyGeneration && handleGenerateConfirm()}
                        disabled={!runtimeConfig.features.strategyGeneration}
                      />
                  </div>

                  <div className="mb-6">
                      <label className="block text-sm font-medium text-slate-300 mb-2">How Many Ideas?</label>
                      <div className="grid grid-cols-3 gap-2">
                          {GENERATE_COUNT_OPTIONS.map((option) => (
                              <button
                                key={option}
                                onClick={() => setGenerateCount(option)}
                                disabled={!runtimeConfig.features.strategyGeneration}
                                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                                  generateCount === option
                                    ? 'border-blue-500 bg-blue-600 text-white'
                                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500 hover:text-white'
                                }`}
                              >
                                {option}
                              </button>
                          ))}
                      </div>
                  </div>

                  <div className="flex flex-col gap-3">
                      <button 
                        onClick={handleGenerateConfirm}
                        disabled={!runtimeConfig.features.strategyGeneration}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          <Zap size={18} />
                          {generatePrompt.trim() ? 'Run Targeted Research' : 'Run Research'}
                      </button>
                      
                      <button 
                        onClick={handleGenerateSurprise}
                        disabled={!runtimeConfig.features.strategyGeneration}
                        className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white py-3 rounded-xl font-medium transition-colors border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          I'm feeling lucky (Surprise me)
                      </button>
                  </div>
              </div>
          </div>
      </div>
  );

  const renderDashboard = () => (
    <div className="space-y-6 animate-fade-in relative">
      {runtimeConfig.demoMode && (
        <div className="bg-blue-600/20 border border-blue-600/30 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="text-blue-400 shrink-0" size={20} />
            <p className="text-sm text-blue-100">
              <span className="font-bold">Demo Mode Active:</span> New strategy generation is disabled. Deploy with your own OpenAI API key to unlock full research capabilities.
            </p>
          </div>
          <a 
            href="https://github.com" 
            target="_blank" 
            rel="noreferrer"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            Get Repository
          </a>
        </div>
      )}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Strategy Generator</h2>
          <p className="text-slate-400 mt-2">
            AI-generated bot concepts. Deep dives are generated automatically for each new batch.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                {(['newest', 'difficulty', 'category', 'potential'] as SortOption[]).map((option) => (
                    <button
                        key={option}
                        onClick={() => setSortOption(option)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${
                            sortOption === option 
                            ? 'bg-slate-700 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        {option}
                    </button>
                ))}
            </div>
            
            <button 
            onClick={handleGenerateClick}
            disabled={loading || runtimeConfig.demoMode}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shadow-lg shadow-blue-900/20 whitespace-nowrap"
            >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Analyzing Market...' : 'Generate New Ideas'}
            </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportStrategies}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
          >
            <Download size={16} />
            Export Library
          </button>
          <button
            onClick={handleImportClick}
            disabled={runtimeConfig.demoMode}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            <Upload size={16} />
            Import Library
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportStrategies}
          />
        </div>

        {transferMessage && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm text-slate-300">
            {transferMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
          {sortedStrategies.map((strategy) => (
            <StrategyCard 
              key={strategy.id} 
              strategy={strategy} 
              onClick={handleStrategyClick}
              onToggleFavorite={toggleFavorite}
            />
          ))}
          {loading && (
             [1, 2, 3].map((i) => (
                <div key={`skeleton-${i}`} className="h-64 bg-slate-800/30 rounded-xl animate-pulse border border-slate-700/50" />
             ))
          )}
      </div>
    </div>
  );

  const renderDetail = () => {
    if (!selectedStrategy) return null;

    const isAnalyzing = selectedStrategy.analysisStatus === 'pending' || selectedStrategy.analysisStatus === 'analyzing';

    return (
    <div className="h-full flex flex-col animate-fade-in">
      <button 
        onClick={() => setCurrentView(View.DASHBOARD)}
        className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors w-fit"
      >
        <ChevronLeft size={20} />
        Back to Dashboard
      </button>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-6">
           <div className="flex-1 overflow-y-auto pr-2">
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 shadow-xl">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-900/50 text-blue-300 border border-blue-700`}>
                                {selectedStrategy.category}
                            </div>
                            <h1 className="text-3xl font-bold text-white">{selectedStrategy.title}</h1>
                        </div>
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={(e) => toggleFavorite(e, selectedStrategy.id)}
                                className={`p-2 rounded-lg border transition-colors flex items-center gap-2 ${selectedStrategy.isFavorite ? 'border-pink-500/50 bg-pink-500/10 text-pink-400' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-pink-400'}`}
                            >
                                <Heart size={18} fill={selectedStrategy.isFavorite ? "currentColor" : "none"} />
                                <span className="text-sm font-medium">{selectedStrategy.isFavorite ? 'Favorited' : 'Favorite'}</span>
                            </button>

                            {isAnalyzing && (
                                <div className="flex items-center gap-2 text-blue-400 text-sm bg-blue-900/20 px-3 py-2 rounded-lg border border-blue-800/50">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>Analysis in progress...</span>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="prose prose-invert prose-lg max-w-none">
                        <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700/50 mb-8">
                             <h3 className="text-xl font-semibold text-slate-200 mb-2">Concept</h3>
                             <p className="text-slate-300 leading-relaxed">{selectedStrategy.description}</p>
                        </div>

                        {isAnalyzing ? (
                            <div className="space-y-4 py-8">
                                <div className="flex items-center gap-3 text-blue-400">
                                    <Zap className="animate-pulse" />
                                    <span className="font-medium">Generating technical deep dive...</span>
                                </div>
                                <div className="h-4 bg-slate-700 rounded w-3/4 animate-pulse" />
                                <div className="h-4 bg-slate-700 rounded w-full animate-pulse" />
                                <div className="h-4 bg-slate-700 rounded w-5/6 animate-pulse" />
                                <div className="h-4 bg-slate-700 rounded w-4/5 animate-pulse" />
                            </div>
                        ) : (
                            <div className="markdown-content space-y-4">
                                <ReactMarkdown 
                                    components={{
                                        h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-blue-100 mt-10 mb-5 border-b border-slate-700 pb-3" {...props} />,
                                        h2: ({node, ...props}) => <h2 className="text-xl font-bold text-blue-200 mt-8 mb-4 pt-2" {...props} />,
                                        h3: ({node, ...props}) => <h3 className="text-lg font-semibold text-blue-300 mt-6 mb-3" {...props} />,
                                        p: ({node, ...props}) => <p className="mb-4 leading-7 text-slate-300" {...props} />,
                                        ul: ({node, ...props}) => <ul className="list-disc pl-5 space-y-2 mb-5 text-slate-300" {...props} />,
                                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 space-y-2 mb-5 text-slate-300" {...props} />,
                                        li: ({node, ...props}) => <li className="pl-1" {...props} />,
                                        strong: ({node, ...props}) => <strong className="text-blue-400 font-semibold" {...props} />,
                                        hr: ({node, ...props}) => <hr className="my-8 border-slate-700" {...props} />,
                                        blockquote: ({node, ...props}) => <blockquote className="mb-5 border-l-4 border-blue-500/40 pl-4 text-slate-300 italic" {...props} />,
                                        pre: ({node, ...props}) => <pre className="mb-5 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm" {...props} />,
                                        code: ({node, className, ...props}) => {
                                          const isInline = !className;
                                          return isInline
                                            ? <code className="rounded bg-slate-900 px-1.5 py-0.5 text-sm text-pink-300" {...props} />
                                            : <code className="text-slate-200" {...props} />;
                                        },
                                    }}
                                >
                                    {normalizeDeepDiveMarkdown(selectedStrategy.deepDiveAnalysis || "Analysis failed to load.")}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>
                </div>
           </div>
      </div>
    </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col md:flex-row">
      {isGenerateModalOpen && renderGenerateModal()}
      
      <nav className="w-full md:w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col sticky top-0 md:h-screen z-10">
        <div className="flex items-center gap-3 px-2 mb-8 mt-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Zap className="text-white" size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white leading-tight">PolyBot</h1>
            <p className="text-xs text-slate-500 font-medium">Research Lab</p>
          </div>
        </div>

        <div className="space-y-2 flex-1">
          <button 
            onClick={() => setCurrentView(View.DASHBOARD)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all font-medium ${currentView === View.DASHBOARD || currentView === View.STRATEGY_DETAIL ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <LayoutDashboard size={18} />
            Strategies
            <span className="ml-auto bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full">{strategies.length}</span>
          </button>
          <button 
            onClick={() => setCurrentView(View.CHAT)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all font-medium ${currentView === View.CHAT ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <MessageSquareText size={18} />
            Analyst Chat
          </button>
          
          <div className="mt-8 px-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Resources</h3>
            <a href="https://docs.polymarket.com/developers/gamma-markets-api/overview" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-slate-400 hover:text-blue-400 transition-colors mb-3">
              <BookOpen size={14} />
              API Docs
            </a>
          </div>
        </div>
        
        <a
          href="https://www.twoguysonecat.com"
          target="_blank"
          rel="noreferrer"
          className="mt-4 block rounded-2xl border border-pink-500/20 bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 px-4 py-4 shadow-lg shadow-pink-950/20 transition-all hover:border-pink-400/40 hover:shadow-pink-900/20"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pink-300/80">Credit</div>
          <div className="mt-2 text-sm font-semibold text-white">
            Made with <span className="text-pink-400" aria-hidden="true">&hearts;</span>
            <br />
            by Two Guys One Cat
          </div>
        </a>
      </nav>

      <main className="flex-1 h-[calc(100vh-80px)] md:h-screen overflow-hidden">
        <div className="h-full overflow-y-auto p-4 md:p-8">
            <div className="max-w-7xl mx-auto h-full">
                {currentView === View.DASHBOARD && renderDashboard()}
                {currentView === View.STRATEGY_DETAIL && renderDetail()}
                {currentView === View.CHAT && (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 min-h-0">
      <ChatInterface strategies={strategies} analystChatEnabled={runtimeConfig.features.analystChat} demoMode={runtimeConfig.demoMode} />
                        </div>
                    </div>
                )}
            </div>
        </div>
      </main>
    </div>
  );
};

export default App;
