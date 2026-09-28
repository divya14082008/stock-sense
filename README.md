# StockSense India 📈

> Real-time Indian stock market intelligence, live NSE/BSE price charts, technical analysis, research X-Ray, alerts, and strategy lab.

[![Live Demo](https://img.shields.io/badge/Live_App-StockSense_India-29d69a?style=for-the-badge&logo=google-chrome&logoColor=white)](https://ais-dev-ndhdzse2zfve4kysvt6axz-75631974551.asia-east1.run.app)

- **Development Preview (Active Now):** [https://ais-dev-ndhdzse2zfve4kysvt6axz-75631974551.asia-east1.run.app](https://ais-dev-ndhdzse2zfve4kysvt6axz-75631974551.asia-east1.run.app)
- **Public Shared URL (Active once you click "Deploy"):** [https://ais-pre-ndhdzse2zfve4kysvt6axz-75631974551.asia-east1.run.app](https://ais-pre-ndhdzse2zfve4kysvt6axz-75631974551.asia-east1.run.app)

---

## 🚀 Key Features

- **Live Market Feeds (NSE/BSE)**: Real-time price tracking, 52-week highs/lows, daily turnover volume, and day ranges for Indian equities (`RELIANCE`, `TCS`, `INFY`, `HDFCBANK`, `TATAMOTORS`, etc.).
- **Live Market Pulse**: Real-time index tracker for **NIFTY 50**, **BANK NIFTY**, **INDIA VIX**, **SENSEX**, and **NIFTY MIDCAP**.
- **Interactive Multi-Timeframe Charts**: Responsive SVG candlestick and area line charts with timeframe switching (`1D`, `5D`, `1M`, `3M`, `6M`, `1Y`, `5Y`), hover crosshair, and volume histograms.
- **Technical Overlays & Indicators**:
  - Exponential Moving Averages (EMA 20, EMA 50)
  - Bollinger Bands
  - Relative Strength Index (RSI 14)
  - Moving Average Convergence Divergence (MACD)
- **Stock X-Ray & Research Engine**: Scenario mapping (Continuation, Consolidation, Breakdown), fundamental metrics, and automated "Why is it moving?" diagnoses.
- **Real-Time News**: Live financial news and regulatory filings fetched for the selected ticker.
- **Algorithmic Strategy Lab**: Historical backtesting simulator (EMA crossover, RSI mean-reversion, 20-period breakout) with net return, win rate, and drawdown metrics.
- **Custom Price Alerts**: Set targets (price above/below, RSI, volume surge) with in-browser notifications.
- **StockSense AI Assistant**: Data-grounded technical analysis powered by Gemini 2.5 Flash and algorithmic momentum models.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion
- **Backend / Proxy**: Express, Node.js (v22), Tsx
- **Build Tool**: Vite 8
- **AI Intelligence**: `@google/genai` (Gemini 2.5 Flash)

---

## 📦 Getting Started

### 1. Clone & Install Dependencies

```bash
git clone <your-github-repo-url>
cd stocksense-india
npm install
```

### 2. Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Set your Gemini API key (optional for enhanced AI decision support):
```env
GEMINI_API_KEY="your-gemini-api-key"
PORT=3000
```

### 3. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Production Build

```bash
npm run build
npm start
```

---

## ⚖️ Disclaimer

*StockSense India is developed strictly for educational and market research purposes. It does not constitute investment advice, financial planning, or recommendations to buy or sell securities.*
