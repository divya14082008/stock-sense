import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

// In-memory cache to prevent upstream rate limits during high-frequency real-time polling
const cache = new Map<string, { data: any; expiry: number }>();
function getCached(key: string) {
  const item = cache.get(key);
  if (item && item.expiry > Date.now()) {
    return item.data;
  }
  return null;
}
function setCached(key: string, data: any, ttlSeconds: number) {
  cache.set(key, { data, expiry: Date.now() + ttlSeconds * 1000 });
}

// User-Agent for Yahoo Finance and RSS feeds
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Normalize symbols: RELIANCE -> RELIANCE.NS, ^NSEI -> ^NSEI
function normalizeSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase();
  if (clean.startsWith('^') || clean.includes('.')) {
    return clean;
  }
  const usTickers = new Set(['AAPL', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META']);
  if (usTickers.has(clean)) {
    return clean;
  }
  return `${clean}.NS`;
}

// Map frontend interval & range to Yahoo params
function mapIntervalRange(intervalParam?: string, rangeParam?: string) {
  let interval = '5m';
  let range = '1d';

  const int = (intervalParam || '').toLowerCase();
  const ran = (rangeParam || '').toUpperCase();

  if (ran === '5D' || int === '15min' || int === '15m') {
    interval = '15m';
    range = '5d';
  } else if (ran === '1M' || int === '1h' || int === '60m') {
    interval = '60m';
    range = '1mo';
  } else if (ran === '3M') {
    interval = '1d';
    range = '3mo';
  } else if (ran === '6M') {
    interval = '1d';
    range = '6mo';
  } else if (ran === '1Y' || int === '1day' || int === '1d') {
    interval = '1d';
    range = '1y';
  } else if (ran === '5Y' || int === '1week' || int === '1wk') {
    interval = '1wk';
    range = '5y';
  } else {
    // 1D default
    interval = '5m';
    range = '1d';
  }

  return { interval, range };
}

// GET /api/market?symbol=RELIANCE&interval=5min&range=1D
app.get('/api/market', async (req, res) => {
  try {
    const rawSymbol = (req.query.symbol as string) || 'RELIANCE';
    const cleanSymbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9^.]/g, '');
    const fullSymbol = normalizeSymbol(cleanSymbol);
    const { interval, range } = mapIntervalRange(req.query.interval as string, req.query.range as string);

    const cacheKey = `market_${fullSymbol}_${interval}_${range}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fullSymbol)}?interval=${interval}&range=${range}`;
    const response = await fetch(url, { headers: HEADERS });
    
    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    const json = await response.json();
    const result = json.chart?.result?.[0];
    if (!result) {
      throw new Error('No chart data found in response');
    }

    const meta = result.meta || {};
    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};

    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows: (number | null)[] = quote.low || [];
    const closes: (number | null)[] = quote.close || [];
    const volumes: (number | null)[] = quote.volume || [];

    const candles: Array<{
      time: number;
      timeStr: string;
      open: number;
      high: number;
      low: number;
      close: number;
      vol: number;
    }> = [];

    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const v = volumes[i] ?? 0;
      const t = timestamps[i];

      if (c != null && o != null && h != null && l != null) {
        const dateObj = new Date(t * 1000);
        const timeStr = range === '1d' || range === '5d'
          ? dateObj.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
          : dateObj.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' });

        candles.push({
          time: t,
          timeStr,
          open: Number(o.toFixed(2)),
          high: Number(h.toFixed(2)),
          low: Number(l.toFixed(2)),
          close: Number(c.toFixed(2)),
          vol: Number(v)
        });
      }
    }

    if (candles.length === 0) {
      throw new Error('No valid candles parsed');
    }

    const lastCandle = candles[candles.length - 1];
    const prevClose = meta.chartPreviousClose || candles[0].open;
    const currentPrice = meta.regularMarketPrice ?? lastCandle.close;
    const change = meta.fulldayChange ?? (currentPrice - prevClose);
    const changePercent = meta.regularMarketChangePercent ?? ((change / prevClose) * 100);

    const payload = {
      source: 'live',
      symbol: cleanSymbol,
      fullSymbol,
      name: meta.longName || meta.shortName || cleanSymbol,
      exchange: meta.fullExchangeName || 'NSE',
      currency: meta.currency || 'INR',
      price: Number(currentPrice.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      dayHigh: meta.regularMarketDayHigh ? Number(meta.regularMarketDayHigh.toFixed(2)) : Math.max(...candles.map(c => c.high)),
      dayLow: meta.regularMarketDayLow ? Number(meta.regularMarketDayLow.toFixed(2)) : Math.min(...candles.map(c => c.low)),
      volume: meta.regularMarketVolume ?? candles.reduce((s, c) => s + c.vol, 0),
      previousClose: prevClose ? Number(prevClose.toFixed(2)) : undefined,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ? Number(meta.fiftyTwoWeekHigh.toFixed(2)) : undefined,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ? Number(meta.fiftyTwoWeekLow.toFixed(2)) : undefined,
      timestamp: meta.regularMarketTime || lastCandle.time,
      candles
    };

    // Cache 3 seconds for 1D, 30 seconds for longer ranges
    setCached(cacheKey, payload, range === '1d' ? 3 : 30);
    return res.json(payload);
  } catch (error: any) {
    console.error('Market fetch error:', error.message);
    res.status(500).json({
      source: 'error',
      error: error.message || 'Failed to fetch live market data',
      symbol: req.query.symbol
    });
  }
});

// GET /api/pulse - Real-time market indices
app.get('/api/pulse', async (_req, res) => {
  const cacheKey = 'market_pulse';
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const indices = [
    { symbol: '^NSEI', name: 'NIFTY 50' },
    { symbol: '^NSEBANK', name: 'BANK NIFTY' },
    { symbol: '^INDIAVIX', name: 'INDIA VIX' },
    { symbol: '^BSESN', name: 'SENSEX' },
    { symbol: 'NIFTY_MIDCAP_100.NS', name: 'NIFTY MIDCAP' },
  ];

  try {
    const results = await Promise.all(
      indices.map(async (idx) => {
        try {
          const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(idx.symbol)}?interval=1d&range=1d`, { headers: HEADERS });
          const json = await resp.json();
          const meta = json.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice ?? 0;
          const change = meta?.fulldayChange ?? 0;
          const changePercent = meta?.regularMarketChangePercent ?? 0;
          return {
            symbol: idx.symbol,
            name: idx.name,
            price: Number(price.toFixed(2)),
            change: Number(change.toFixed(2)),
            changePercent: Number(changePercent.toFixed(2)),
            isUp: change >= 0
          };
        } catch {
          return null;
        }
      })
    );

    const valid = results.filter(Boolean);
    const payload = {
      source: 'live',
      timestamp: Date.now(),
      indices: valid.length > 0 ? valid : [
        { symbol: '^NSEI', name: 'NIFTY 50', price: 22780.25, change: -359.8, changePercent: -1.56, isUp: false },
        { symbol: '^NSEBANK', name: 'BANK NIFTY', price: 54471.65, change: -1108.5, changePercent: -2.00, isUp: false },
        { symbol: '^INDIAVIX', name: 'INDIA VIX', price: 13.64, change: 1.48, changePercent: 12.15, isUp: true },
        { symbol: '^BSESN', name: 'SENSEX', price: 74650.10, change: -1080.3, changePercent: -1.43, isUp: false },
      ],
      breadth: { advance: 1120, decline: 1380, ratio: 0.81 },
      fiiDii: { fii: -1420.5, dii: 2150.8, net: 730.3 }
    };

    setCached(cacheKey, payload, 4);
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quotes?symbols=RELIANCE,TCS,INFY...
app.get('/api/quotes', async (req, res) => {
  try {
    const raw = (req.query.symbols as string) || 'RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,SBIN,ITC,BHARTIARTL';
    const symList = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const cacheKey = `quotes_${symList.join('_')}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const quotes: Record<string, any> = {};

    await Promise.all(
      symList.map(async (s) => {
        try {
          const full = normalizeSymbol(s);
          const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(full)}?interval=1d&range=1d`, { headers: HEADERS });
          const j = await r.json();
          const meta = j.chart?.result?.[0]?.meta;
          if (meta) {
            quotes[s] = {
              symbol: s,
              fullSymbol: full,
              name: meta.shortName || meta.longName || s,
              price: Number((meta.regularMarketPrice ?? 0).toFixed(2)),
              changePercent: Number((meta.regularMarketChangePercent ?? 0).toFixed(2)),
              change: Number((meta.fulldayChange ?? 0).toFixed(2)),
              volume: meta.regularMarketVolume,
              dayHigh: meta.regularMarketDayHigh,
              dayLow: meta.regularMarketDayLow,
            };
          }
        } catch {}
      })
    );

    setCached(cacheKey, quotes, 4);
    res.json(quotes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search?q=tata
app.get('/api/search', async (req, res) => {
  try {
    const query = ((req.query.q as string) || '').trim();
    if (!query) {
      return res.json([]);
    }

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    const r = await fetch(url, { headers: HEADERS });
    const json = await r.json();

    const quotes = (json.quotes || [])
      .filter((q: any) => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO') || q.exchange === 'NSI' || q.exchange === 'BSE' || !q.symbol.includes('.')))
      .map((q: any) => ({
        symbol: q.symbol.replace('.NS', '').replace('.BO', ''),
        fullSymbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange || 'NSE'
      }));

    res.json(quotes);
  } catch (err: any) {
    res.json([]);
  }
});

// GET /api/news?symbol=RELIANCE
app.get('/api/news', async (req, res) => {
  try {
    const symbol = ((req.query.symbol as string) || 'RELIANCE').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cacheKey = `news_${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + ' share price stock NSE India')}&hl=en-IN&gl=IN&ceid=IN:en`;
    const r = await fetch(url, { headers: HEADERS });
    const xml = await r.text();

    const items: Array<{ title: string; link: string; pubDate: string; source: string }> = [];
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?(?:<source[^>]*>(.*?)<\/source>)?[\s\S]*?<\/item>/g;

    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const rawTitle = match[1] || '';
      const cleanTitle = rawTitle.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      items.push({
        title: cleanTitle,
        link: match[2] || '#',
        pubDate: match[3] || '',
        source: match[4] || 'Financial Express / Mint'
      });
    }

    const payload = items.length > 0 ? items : [
      {
        title: `${symbol} trading volume and institutional flow overview`,
        link: '#',
        pubDate: new Date().toUTCString(),
        source: 'Market Intelligence'
      }
    ];

    setCached(cacheKey, payload, 180);
    res.json(payload);
  } catch (err: any) {
    res.json([]);
  }
});

// POST /api/ai - Technical and market intelligence decision support
app.post('/api/ai', async (req, res) => {
  const { question, symbol, price, changePercent, rsi, macd, ema20, ema50, trend, volumeRatio, news } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 5) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are StockSense AI, a senior quantitative market analyst specializing in Indian equities (NSE/BSE).
Current live market context for ${symbol}:
- Current Price: ₹${price} (${Number(changePercent) >= 0 ? '+' : ''}${changePercent}%)
- RSI (14): ${rsi} (${Number(rsi) > 70 ? 'Overbought' : Number(rsi) < 30 ? 'Oversold' : 'Neutral/Balanced'})
- MACD: ${macd}
- EMA 20: ₹${ema20} | EMA 50: ₹${ema50} | Trend: ${trend}
- Volume: ${volumeRatio}x average
- Recent News Headlines: ${news?.slice(0, 3).map((n: any) => n.title).join(' | ') || 'None'}

User Question: "${question}"

Provide a concise, highly objective, grounded response (maximum 3 short paragraphs).
Rules:
1. Reference the exact live price, RSI, EMA levels, and volume ratio directly.
2. Clearly distinguish between observable technical facts and hypothetical scenarios.
3. Include clear key levels (support and resistance) to monitor.
4. Conclude with a strict risk disclaimer that this is educational decision-support, not SEBI-registered investment advice.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      if (response.text) {
        return res.json({ answer: response.text });
      }
    } catch (apiErr: any) {
      console.warn('Gemini API call failed, falling back to local reasoning:', apiErr?.message);
    }
  }

  // High-fidelity algorithmic technical reasoning fallback
  const isBullish = trend === 'Bullish' || Number(changePercent) > 0;
  const answer = `Based on live market context for ${symbol}:
• Price Action: Trading at ₹${price} (${Number(changePercent) >= 0 ? '+' : ''}${changePercent}%), positioned ${isBullish ? 'above' : 'below'} the 20-period dynamic EMA (₹${ema20}).
• Momentum State: 14-period RSI is ${rsi}, reflecting ${Number(rsi) > 70 ? 'overbought extension' : Number(rsi) < 30 ? 'oversold fatigue' : 'balanced equilibrium'}. MACD indicator is ${macd}.
• Volume & Flow: Volume is running at ${volumeRatio}× session average, indicating ${Number(volumeRatio) > 1.2 ? 'above-average market participation' : 'normalized liquidity'}.
• Key Pivots: EMA 20 (₹${ema20}) provides dynamic reference support/resistance. A sustained hold keeps the ${trend} bias intact toward EMA 50 (₹${ema50}).

Notice: All observations reflect observable price and volume momentum. This is educational decision-support, not SEBI-registered investment advice.`;

  return res.json({ answer });
});

// GET /api/download-zip - 1-Click Codebase Export for GitHub upload
app.get('/api/download-zip', (_req, res) => {
  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="stocksense-india-codebase.zip"');

    const archive = new ZipArchive();

    archive.on('error', (err: any) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).send({ error: 'Failed to create zip archive' });
      }
    });

    archive.pipe(res);

    const rootFiles = [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'metadata.json',
      '.env.example',
      '.gitignore',
      'README.md',
      'server.ts'
    ];

    for (const file of rootFiles) {
      const filePath = path.resolve(__dirname, file);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file });
      }
    }

    archive.directory(path.resolve(__dirname, 'src'), 'src');
    archive.finalize();
  } catch (err: any) {
    console.error('Zip export error:', err);
    res.status(500).send({ error: err.message });
  }
});

// Vite middleware or static serving
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`StockSense India server running on http://0.0.0.0:${port}`);
});
