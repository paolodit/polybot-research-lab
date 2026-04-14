export interface Strategy {
  id: string;
  title: string;
  category: 'Arbitrage' | 'Sentiment' | 'Market Making' | 'Correlation' | 'Technical' | 'Whale Tracking';
  difficulty: 'Low' | 'Medium' | 'High';
  profitPotential: 'Steady' | 'High' | 'Volatile';
  description: string;
  implementationHint: string;
  // New fields for background processing
  deepDiveAnalysis?: string;
  analysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  isFavorite?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  relatedStrategyId?: string; // Optional link to a strategy
}

export enum View {
  DASHBOARD = 'DASHBOARD',
  STRATEGY_DETAIL = 'STRATEGY_DETAIL',
  SIMULATOR = 'SIMULATOR',
  CHAT = 'CHAT'
}