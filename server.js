// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (error) {
    console.log('No .env file found, using environment variables from the system');
}

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const HttpsProxyAgent = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 5000;

// Configure proxy if available
const PROXY = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
const axiosInstance = axios.create({
    timeout: 30000, // 30 seconds timeout
    httpsAgent: new https.Agent({ 
        rejectUnauthorized: false,
        keepAlive: true,
        timeout: 30000
    }),
    ...(PROXY && {
        proxy: false,
        httpsAgent: new HttpsProxyAgent(PROXY)
    })
});

// Configure CORS with environment variables
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000', 'https://st-backend-8j0f.onrender.com'];

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Store cookies and last request time
let cookies = '';
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // Increase to 2 seconds between requests

// Required headers for NSE API
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.nseindia.com',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

// Function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to ensure minimum time between requests
async function throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await delay(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }
    lastRequestTime = Date.now();
}

// Function to get cookies with retry logic
async function getCookies(retries = 5, backoff = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            await throttleRequest();
            
            const response = await axiosInstance.get('https://www.nseindia.com', {
                headers: headers,
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 303;
                }
            });

            if (response.headers['set-cookie']) {
                return response.headers['set-cookie'];
            }
            
            // If we got a response but no cookies, wait before retrying
            await delay(backoff);
            throw new Error('No cookies received');
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error.message);
            if (i === retries - 1) throw error;
            
            // Longer backoff for deployment environment
            const waitTime = backoff * Math.pow(2, i);
            console.log(`Waiting ${waitTime}ms before next attempt...`);
            await delay(waitTime);
        }
    }
}

// Middleware to refresh cookies
async function refreshCookies(req, res, next) {
    try {
        if (!cookies) {
            cookies = await getCookies();
        }
        next();
    } catch (error) {
        console.error('Error refreshing cookies:', error);
        cookies = '';
        res.status(503).json({ 
            error: 'Service temporarily unavailable',
            message: 'NSE services are currently unavailable. Please try again in a few moments.'
        });
    }
}

// Helper function to make NSE API requests
async function makeNSERequest(url, options = {}) {
    await throttleRequest();
    
    try {
        const response = await axiosInstance.get(url, {
            headers: {
                ...headers,
                Cookie: cookies.join('; ')
            },
            ...options
        });
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 403) {
            // Clear cookies on forbidden response
            cookies = '';
        }
        throw error;
    }
}

app.use(refreshCookies);

// Proxy endpoint for NIFTY 50 data
app.get('/api/nifty50', async (req, res) => {
    try {
        const data = await makeNSERequest(
            'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050'
        );
        res.json(data);
    } catch (error) {
        console.error('Error fetching NIFTY 50 data:', error.message);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            message: 'Unable to fetch NIFTY 50 data. Please try again later.'
        });
    }
});

// Proxy endpoint for individual stock data
app.get('/api/stock/:symbol', async (req, res) => {
    try {
        const [quoteData, tradeInfo] = await Promise.all([
            makeNSERequest(
                `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(req.params.symbol)}`
            ),
            makeNSERequest(
                `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(req.params.symbol)}&section=trade_info`
            )
        ]);
        
        res.json({
            quote: quoteData,
            tradeInfo: tradeInfo
        });
    } catch (error) {
        console.error('Error fetching stock data:', error.message);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            message: 'Unable to fetch stock data. Please try again later.'
        });
    }
});

// Test endpoint for Vercel deployment
app.get('/', (req, res) => {
    res.json({ message: 'Hello from Vercel Server!' });
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});