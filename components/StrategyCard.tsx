import React from 'react';
import { Strategy } from '../types';
import { TrendingUp, Activity, ShieldAlert, DollarSign, Cpu, BarChart3, CheckCircle2, Loader2, Clock, AlertCircle, Heart } from 'lucide-react';

interface StrategyCardProps {
  strategy: Strategy;
  onClick: (strategy: Strategy) => void;
  onToggleFavorite: (e: React.MouseEvent, id: string) => void;
}

const StrategyCard: React.FC<StrategyCardProps> = ({ strategy, onClick, onToggleFavorite }) => {
  const getIcon = () => {
    switch (strategy.category) {
      case 'Arbitrage': return <TrendingUp className="text-emerald-400" />;
      case 'Sentiment': return <Activity className="text-blue-400" />;
      case 'Market Making': return <DollarSign className="text-yellow-400" />;
      case 'Correlation': return <BarChart3 className="text-purple-400" />;
      case 'Whale Tracking': return <ShieldAlert className="text-red-400" />;
      default: return <Cpu className="text-slate-400" />;
    }
  };

  const getDifficultyColor = (diff: string) => {
    switch (diff) {
      case 'Low': return 'bg-green-900/50 text-green-300 border-green-700';
      case 'Medium': return 'bg-yellow-900/50 text-yellow-300 border-yellow-700';
      case 'High': return 'bg-red-900/50 text-red-300 border-red-700';
      default: return 'bg-slate-800 text-slate-300';
    }
  };

  const renderStatus = () => {
    if (strategy.analysisStatus === 'failed') {
      return (
        <div className="flex items-center gap-1.5 text-red-400 text-xs font-medium" title="Analysis Failed">
          <AlertCircle size={16} />
        </div>
      );
    }

    if (strategy.analysisStatus === 'completed' || (strategy.deepDiveAnalysis && strategy.deepDiveAnalysis.length > 0)) {
      return (
        <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium" title="Deep Dive Ready">
          <CheckCircle2 size={18} />
        </div>
      );
    }

    if (strategy.analysisStatus === 'analyzing') {
      return (
        <div className="flex items-center gap-1.5 text-blue-400 text-xs font-medium">
          <Loader2 size={14} className="animate-spin" />
          <span>Analyzing...</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">
        <Clock size={14} />
        <span>Queued</span>
      </div>
    );
  };

  return (
    <div
      onClick={() => onClick(strategy)}
      className={`bg-slate-800/50 border hover:border-blue-500/50 p-6 rounded-xl cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-900/20 group backdrop-blur-sm relative overflow-hidden flex flex-col h-full ${strategy.analysisStatus === 'failed' ? 'border-red-900/30' : 'border-slate-700'}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-900 rounded-lg border border-slate-700 group-hover:border-blue-500/30 transition-colors shrink-0">
            {getIcon()}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-base text-slate-100 group-hover:text-blue-400 transition-colors leading-snug break-words">{strategy.title}</h3>
            <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">{strategy.category}</span>
          </div>
        </div>

        <button
          onClick={(e) => onToggleFavorite(e, strategy.id)}
          className={`p-1.5 rounded-full transition-colors ${strategy.isFavorite ? 'text-pink-500 bg-pink-500/10' : 'text-slate-600 hover:text-pink-400 hover:bg-slate-700'}`}
        >
          <Heart size={18} fill={strategy.isFavorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getDifficultyColor(strategy.difficulty)} whitespace-nowrap`}>
          {strategy.difficulty}
        </div>
        {strategy.profitPotential === 'High' && (
          <div className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-purple-900/50 text-purple-300 border-purple-700">
            High Profit
          </div>
        )}
      </div>

      <p className="text-slate-400 text-sm leading-relaxed mb-4 line-clamp-3 flex-grow">
        {strategy.description}
      </p>

      <div className="flex items-center justify-between pt-4 border-t border-slate-700/50 mt-auto">
        {renderStatus()}

        <button className="ml-auto flex items-center text-sm font-medium text-blue-400 hover:text-blue-300">
          View Details
        </button>
      </div>

      {strategy.analysisStatus === 'analyzing' && (
        <div className="absolute bottom-0 left-0 h-0.5 bg-blue-500/50 w-full animate-pulse" />
      )}
    </div>
  );
};

export default StrategyCard;
